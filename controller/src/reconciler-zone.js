const { setIntervalAsync, clearIntervalAsync } = require('set-interval-async');
const getDifferingFieldNames = require('./util/differing-field-names.js')
const { ResourceEventType } = require('@dot-i/k8s-operator');
const randomWords = require('./util/randomwords.js')


class DnsReconcilerData {
	constructor(crs, zoneDomainNames, logger) {
		this.logger = logger
		this.crs = crs
		this.crDomainNames = crs.map(el => el.spec.domainName)
		this.zoneDomainNames = zoneDomainNames
	}

	difference(a1, a2) {
		return a1.filter(x => !a2.includes(x));
	}

	getDispensableZoneDomainNames() {
		return this.difference(this.zoneDomainNames, this.crDomainNames);
	}

	getMissingZoneDomainNames() {
		return this.difference(this.crDomainNames, this.zoneDomainNames);
	}

	getZoneDomainNamesWithoutProperStatus() {
		let zones = []

		for (let cr of this.crs) {
			//Check if a status exists
			if (!cr.status) {
				this.logger.debug(`getZoneDomainNamesWithoutProperStatus: Zone ${cr.spec.domainName} does not have a status`)
				zones.push(cr.spec.domainName)
				continue
			}

			//Check that certain fields are present
			for (const field of ["dnssecAlgorithm", "dnssecKey", "keyName"]) {
				if (!cr.status[field]) {
					this.logger.debug(`getZoneDomainNamesWithoutProperStatus: Status of zone ${cr.spec.domainName} is missing status field ${field}, the status is: `, cr.status)
					zones.push(cr.spec.domainName)
				}
			}
		}

		return zones
	}

	getCrForName(name) {
		return this.crs.filter(el => el.spec.domainName === name)[0]
	}

	//TODO: check, if this is really required
	/** Get a Set of upstream zones of the requested domains
	 * @returns Set of upstream zones (e.g.,  {'b.c.de', 'c.de'})
	 */
	// getUpstreamDelegationZones() {

	// 	/** Get upstream zones w/o the top level domain for a single domain name
	// 	 * @param domainName The domain name (e.g., "a.b.c.de")
	// 	 * @returns Array of upstream zones (e.g., ['b.c.de', 'c.de'])
	// 	 */
	// 	function getSuperDomains(domainName) {
	// 		const split = domainName.split(".")
	// 		const { topLevelDomains } = parseDomain(domainName)
	// 		//Remove the top-level domain
	// 		const d_wo_tld = split.slice(0, split.length - topLevelDomains.length)
	// 		//Remove the host part (i.e., "a" in above's example)
	// 		const d_wo_host = d_wo_tld.slice(1)

	// 		let result = []
	// 		//Generate b.c.de and c.de
	// 		for (let i = 0; i < d_wo_host.length; ++i) {
	// 			let r = d_wo_host.slice(i).concat(topLevelDomains)
	// 			result.push(r.join("."))
	// 		}
	// 		return result
	// 	}

	// 	//Compile a set of upstream zones
	// 	let result = new Set()
	// 	for (let domain of this.crDomainNames) {
	// 		getSuperDomains(domain)
	// 			.forEach(el => result.add(el))
	// 	}
	// 	return result
	// }
}

class DnsZoneReconciler {

	constructor(options) {
		this.options = options
		this.dnssecZoneWatcher = options.dnssecZoneWatcher
		this.bindConfigGen = options.bindConfigGen
		this.bindRestartRequestCallback = options.bindRestartRequestCallback
		this.logger = options.logger("DnsZoneReconciler");

		this.addQueue = new Map()
		this.deleteQueue = new Map()

		let eventHandler = event => {
			let q = event.type === ResourceEventType.Deleted ? this.deleteQueue : this.addQueue

			if (this.enque(q, event.object))
				this.logger.debug(`on:${event.type}: Event for zone `, event.object.spec.domainName)
			else
				this.logger.debug(`on:${event.type}: Ignoring invalid event:`, event)
		}

		this.dnssecZoneWatcher.events.on(ResourceEventType.Added, eventHandler);
		this.dnssecZoneWatcher.events.on(ResourceEventType.Modified, eventHandler);
		this.dnssecZoneWatcher.events.on(ResourceEventType.Deleted, eventHandler);

		this.reconcileInterval = options.reconcileInterval;
		this.setupReconcileTimer(this.reconcileInterval);
		this.bindRestartRequested = false

		this.logger.debug("constructor: New instance");
	}

	enque(q, cr) {
		if (cr && cr.spec && cr.spec.domainName) {
			q.set(cr.spec.domainName, cr)
			return true
		} else
			return false
	}

	setupReconcileTimer() {
		// Cancel existing timer
		if (this.reconcileTimer) {
			this.logger.debug(`setupReconcileTimer: Clearing existing timer`, this.reconcileTimer)
			clearIntervalAsync(this.reconcileTimer)
		}

		// Setup new timer
		this.reconcileTimer = setIntervalAsync(async () => {
			//this.logger.debug(`setupReconcileTimer: Running reconcile from timer`)
			await this.reconcile();
		}, this.reconcileInterval)
	}

	async add(cr) {
		let result = this.bindConfigGen.addOrUpdateZone(cr.spec, cr.status)

		if (result.changed) {
			this.logger.debug(`add: Result of addOrUpdateZone for zone ${cr.spec.domainName}:`, result);
			this.logger.debug("add: Requesting bind restart due to changes to zone", cr.spec.domainName)
			this.bindRestartRequested = true;
		} else {
			this.logger.debug(`add: zone ${cr.spec.domainName} is unchanged`);
		}

		const changedStatusFields = getDifferingFieldNames(result.status, cr.status);
		if (changedStatusFields.length > 0) {
			let statusPatch = {}
			for (let field of changedStatusFields) {
				this.logger.debug(`${cr.spec.domainName}, ${field} changed from ${cr.status ? cr.status[field] : "<nonexistent>"} to ${result.status[field]}`)
				statusPatch[field] = result.status[field]
			}

			try {
				this.logger.debug(`add: Patching status of zone: ${cr.spec.domainName}: patch = `, statusPatch)
				let result = await this.dnssecZoneWatcher.updateResourceStatus(cr, statusPatch)
				this.logger.debug(`add: Patching result for zone ${cr.spec.domainName}: `, result)

			} catch (e) {
				this.logger.warn(`add: Error while patching status of custom resource (zone: ${cr.spec.domainName}): `, e)
			}
		}

		return result
	}

	async remove(cr) {
		this.logger.debug(`remove: Removing zone with object`, cr.spec)

		let result = this.bindConfigGen.deleteZone(cr.spec)

		if (result.changed) {
			this.logger.debug("remove: Requesting bind restart due to changes to zone", cr.spec.domainName)
			this.bindRestartRequested = true
		}

		return result
	}

	async runQueues() {
		//Run delete queue
		for (const key_value of this.deleteQueue)
			this.remove(key_value[1])
		this.deleteQueue.clear()

		//Run add queue
		for (const key_value of this.addQueue)
			this.add(key_value[1])
		this.addQueue.clear();
	}

	async reconcile() {
		this.logger.trace(`reconcile: Starting`)

		const zones = await this.bindConfigGen.getZones();

		const customResources = Array.from(this.dnssecZoneWatcher.listItems())
		const data = new DnsReconcilerData(customResources, zones, this.logger)

		// Zones that exist in bind but no matching CR exists in K8s
		for (const name of data.getDispensableZoneDomainNames()) {
			this.logger.debug(`reconcile: Deleting disposable zone = `, name)
			const fakeCr = { "spec": { "domainName": name } }
			this.enque(this.deleteQueue, fakeCr)
		}

		// Zones that are missing in Bind's config files
		for (const name of data.getMissingZoneDomainNames()) {
			this.logger.debug(`reconcile: Adding missing zone = `, name)
			this.enque(this.addQueue, data.getCrForName(name))
		}

		//Zone that have no proper status -> forcefully recreate them
		for (const name of data.getZoneDomainNamesWithoutProperStatus()) {
			this.logger.warn(`reconcile: Forcefully re-running zone ${name} because no proper status exists`)
			this.enque(this.addQueue, data.getCrForName(name))
		}

		// Process all events that are queued
		await this.runQueues()

		//Restart if changes require a restart of bind
		if (this.bindRestartRequested) {
			this.logger.info("reconcile: Changes occured, bind reload requested")
			this.options.bindRestartRequestCallback();
			this.bindRestartRequested = false
		}

		this.logger.trace(`reconcile: Done`)
	}


	dummyDnsZoneGenerator() {
		const name = randomWords(2).join('.')
		const meta_name = `domain-${name}`
		return {
			"apiVersion": "dnsseczone.farberg.de/v1",
			"kind": "DnssecZone",
			"metadata": { "name": meta_name },
			"spec": {
				"domainName": name,
				"adminContact": `admin.${name}`,
				"ttlSeconds": 60,
				"refreshSeconds": 60,
				"retrySeconds": 60,
				"expireSeconds": 60,
				"minimumSeconds": 60
			}
		}
	}

}

module.exports = { DnsZoneReconciler, DnsReconcilerData }