const { fixed: { setIntervalAsync: setIntervalAsync }, clearIntervalAsync } = require('set-interval-async')

class ReconcilerData {
	constructor(crds, zones) {
		this.crds = crds
		this.zones = zones
	}

	difference(a1, a2) {
		return a1.filter(x => !a2.includes(x));
	}

	getDispensableZones() {
		return this.difference(this.zones, this.crds);
	}

	getMissingZones() {
		return this.difference(this.crds, this.zones);
	}

}

class Reconciler {

	constructor(options) {
		this.options = options
		this.crdWatcher = options.crdWatcher
		this.bindConfigGen = options.bindConfigGen
		this.bindRestartRequestCallback = options.bindRestartRequestCallback
		this.logger = options.logger("Reconciler");

		this.crdWatcher.events.on('added', event => {
			this.logger.debug("on:added: Added event for zone ", event.object.spec.domainName)
			this.logger.debug(event)
			this.add(event.object)
		})

		this.crdWatcher.events.on('modified', event => {
			this.logger.debug("on:modified: Modified event for zone ", event.object.spec.domainName)
			this.add(event.object)
		})

		this.crdWatcher.events.on('deleted', event => {
			this.logger.debug("on:deleted: Deleted event for zone ", event.object.spec.domainName)
			this.remove(event.object)
		})

		this.reconcileInterval = options.reconcileInterval;
		this.setupReconcileTimer(this.reconcileInterval);
		this.bindRestartRequested = false

		this.logger.debug("constructor: New instance with options: ", options);
	}

	setupReconcileTimer() {
		// Cancel existing timer
		if (this.reconcileTimer) {
			this.logger.debug(`setupReconcileTimer: Clearing existing timer`, this.reconcileTimer)
			clearIntervalAsync(this.reconcileTimer)
		}

		// Setup new timer
		this.reconcileTimer = setIntervalAsync(async () => {
			this.logger.debug(`setupReconcileTimer: Running reconcile from timer`)
			await this.reconcile();
		}, this.reconcileInterval)
	}


	async add(cr) {
		let spec = cr.spec
		let result = this.bindConfigGen.addOrUpdateZone(spec)

		this.logger.debug(`add: Result of running addOrUpdateZone for zone ${spec.domainName}:`, result);

		if (result.changed) {
			this.logger.debug("add: Requesting bind restart due to changes to zone", spec.domainName)
			this.bindRestartRequested = true;
		}

		if (result.status) {
			await this.crdWatcher.updateResourceStatus(cr, result.status)
		}

		return result
	}

	async remove(cr) {
		let spec = cr.spec
		this.logger.debug(`remove: Removing zone with object`, spec)

		let result = this.bindConfigGen.deleteZone(spec);

		if (result.changed) {
			this.logger.debug("remove: Requesting bind restart due to changes to zone", spec.domainName)
			this.bindRestartRequested = true;
		}

		return result
	}

	getZonesWithoutProperStatus(crds) {
		let zones = []

		for (let crd of crds) {

			if (!crd.status) {
				this.logger.debug(`getZonesWithoutProperStatus: Zone ${crd.spec.domainName} does not have a status`)
				zones.push(crd.spec.domainName)
				continue
			}

			for (const field of ["dnssecAlgorithm", "dnssecKey", "keyName"]) {
				if (!crd.status[field]) {
					this.logger.debug(`getZonesWithoutProperStatus: Zone ${crd.spec.domainName} does not have a status`)
					zones.push(crd.spec.domainName)
				}
			}

		}

		// Remove duplicate entries and return as array
		return [...new Set(zones)]
	}

	async reconcile() {
		this.logger.debug(`reconcile: Starting`)

		const customResources = (await this.crdWatcher.listItems())
		const customResourcesDomainNames = customResources.map(el => el.spec.domainName)
		const zones = await this.bindConfigGen.getZones();
		const data = new ReconcilerData(customResourcesDomainNames, zones, this.logger)

		function getCrForName(name, crds) {
			let res = crds.filter(el => el.spec.domainName === name)
			if (res.length === 1)
				return res[0]
			else
				return undefined
		}

		// Zones that exist in bind but no matching CR exists in K8s
		for (const name of data.getDispensableZones()) {
			this.logger.debug(`reconcile: Deleting disposable zone = `, name)
			this.remove(getCrForName(name, customResources))
		}

		// Zones that are missing in Bind's config files
		for (const name of data.getMissingZones()) {
			this.logger.debug(`reconcile: Adding missing zone = `, name)
			this.add(getCrForName(name, customResources))
		}

		//Zone that have no proper status -> forcefully recreate them
		const zonesWithoutProperStatus = this.getZonesWithoutProperStatus(customResources)
		this.logger.debug("reconcile: Zones that have no proper status: ", zonesWithoutProperStatus)
		for (const name of zonesWithoutProperStatus) {
			this.logger.warn(`reconcile: Forcefully re-running zone ${name} because no proper status exists`)
			this.add(getCrForName(name, customResources))
		}

		//Restart if changes require a restart of bind
		if (this.bindRestartRequested) {
			this.logger.info("reconcile: Changes occured, bind restart requested")
			this.options.bindRestartRequestCallback();
			this.bindRestartRequested = false
		}

		this.logger.debug(`reconcile: Done`)
	}

}

module.exports = { Reconciler, ReconcilerData }