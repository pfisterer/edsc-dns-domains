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

	constructor(crdWatcher, bindConfigGen, bindProcessRunner, reconcileInterval, logger) {
		this.crdWatcher = crdWatcher;
		this.bindConfigGen = bindConfigGen
		this.bindProcessRunner = bindProcessRunner;
		this.logger = logger;

		this.crdWatcher.events.on('added', event => {
			this.logger.debug("Added event for zone ", event.object.spec.domainName)
			this.add(event.object.spec)
		})

		this.crdWatcher.events.on('modified', event => {
			this.logger.debug("Modified event for zone ", event.object.spec.domainName)
			this.add(event.object.spec)
		})

		this.crdWatcher.events.on('deleted', event => {
			this.logger.debug("Deleted event for zone ", event.object.spec.domainName)
			this.remove(event.object.spec)
		})

		this.reconcileInterval = reconcileInterval;
		this.setupReconcileTimer(this.reconcileInterval);
		this.bindRestartRequested = false
	}

	setupReconcileTimer() {
		// Cancel existing timer
		if (this.reconcileTimer) {
			this.logger.debug(`Clearing existing timer`, this.reconcileTimer)
			clearIntervalAsync(this.reconcileTimer)
		}

		// Setup new timer
		this.reconcileTimer = setIntervalAsync(async () => {
			this.logger.debug(`Running reconcile from timer`)
			await this.reconcile();
		}, this.reconcileInterval)
	}

	async add(spec) {
		let result = this.bindConfigGen.addOrUpdateZone(spec)

		if (result.changed) {
			this.logger.debug("Requesting bind restart due to changes to zone", spec.domainName)
			this.bindRestartRequested = true;
		}

		if (result.statusPatch) {
			await this.crdWatcher.setResourceStatus(event.meta, statusPatch)
			this.logger.debug(`Set status of ${spec.domainName} to `, statusPatch)
		}


		return result
	}

	async remove(spec) {
		this.logger.debug(`Removing zone with object`, spec)

		let result = this.bindConfigGen.deleteZone(spec);

		if (result.changed) {
			this.logger.debug("Requesting bind restart due to changes to zone", spec.domainName)
			this.bindRestartRequested = true;
		}

		return result
	}

	getZonesWithoutProperStatus(crds) {
		let zones = []

		for (let crd of crds) {

			if (!crd.status) {
				this.logger.debug(`Zone ${crd.spec.domainName} does not have a status`)
				zones.push(crd.spec.domainName)
				continue
			}

			for (const field of ["dnssecAlgorithm", "dnssecKey", "keyName"]) {
				if (!crd.status[field]) {
					this.logger.debug(`Zone ${crd.spec.domainName} does not have a status`)
					zones.push(crd.spec.domainName)
				}
			}

		}

		// Remove duplicate entries and return as array
		return [...new Set(zones)]
	}

	async reconcile() {
		this.logger.debug(`Starting reconciliation.`)

		const customResources = (await this.crdWatcher.listItems())
		const customResourcesDomainNames = customResources.map(el => el.spec.domainName)
		const zones = await this.bindConfigGen.getZones();
		const data = new ReconcilerData(customResourcesDomainNames, zones, this.logger)

		function getCrdForName(name, crds) {
			let res = crds.filter(el => el.spec.domainName === name)
			if (res.length === 1)
				return res[0]
			else return undefined

			XXXXXXX
		}

		// Zones that exist in bind but no matching CR exists in K8s
		for (const name of data.getDispensableZones()) {
			this.logger.debug(`Deleting disposable zone = `, name)
			this.remove(getCrdForName(name, customResources))
		}

		// Zones that are missing in Bind's config files
		for (const name of data.getMissingZones()) {
			this.logger.debug(`Adding missing zone = `, name)
			this.add(getCrdForName(name, customResources))
		}

		//Zone that have no proper status -> forcefully recreate them
		const zonesWithoutProperStatus = this.getZonesWithoutProperStatus(customResources)
		this.logger.debug("Zones that have no proper status: ", zonesWithoutProperStatus)
		for (const name of zonesWithoutProperStatus) {
			this.logger.warn(`Forcefully recreating zone ${name} because no proper status exists`)
			this.remove(getCrdForName(name, customResources))
			this.add(getCrdForName(name, customResources))
		}

		//Restart if changes require a restart of bind
		if (this.bindRestartRequested) {
			this.logger.info("Changes occured, bind restart requested")
			this.bindProcessRunner.restart()
			this.bindRestartRequested = false
		}

		this.logger.debug(`Reconciliation done.`)
	}

}

module.exports = { Reconciler, ReconcilerData }