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

		this.crdWatcher.events.on('added', (e) => this.handleAddedOrModifiedEvent(e))
		this.crdWatcher.events.on('modified', (e) => this.handleAddedOrModifiedEvent(e))
		this.crdWatcher.events.on('deleted', (e) => this.handleDeletedEvent(e))

		this.reconcileInterval = reconcileInterval;
		this.setupReconcileTimer(this.reconcileInterval);
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

	async handleAddedOrModifiedEvent(event) {
		this.logger.debug("Added/Modified event for zone ", event.object.spec.domainName)
		let { changed, status } = this.bindConfigGen.addOrUpdateZone(event.object.spec)

		if (changed) {
			this.bindProcessRunner.restart();
			await this.crdWatcher.setResourceStatus(event.meta, status)
		}
	}

	async handleDeletedEvent(event) {
		this.logger.debug("Deleted event for zone ", event.object.spec.domainName)
		let { changed, statusPatch } = this.remove(event.object.spec)

		if (changed)
			bindProcessRunner.restart();

		return { changed, statusPatch }
	}

	async add(spec) {
		// returns { changed, status }
		return this.bindConfigGen.addOrUpdateZone(spec)
	}

	async remove(spec) {
		this.logger.debug(`Removing zone with object`, spec)
		// returns whether the config file has changed
		return this.bindConfigGen.deleteZone(spec);
	}

	async reconcile() {
		this.logger.debug(`Starting reconciliation.`)

		const customResources = (await this.crdWatcher.listItems())
		const customResourcesDomainNames = customResources.map(el => el.spec.domainName)
		const zones = await this.bindConfigGen.getZones();

		const data = new ReconcilerData(customResourcesDomainNames, zones, this.logger)

		for (const name of data.getDispensableZones()) {
			this.logger.debug(`Deleting disposable zone = `, name)
			this.remove({ domainName: name })
		}

		for (const name of data.getMissingZones()) {
			this.logger.debug(`Adding missing zone = `, name)
			this.add({ domainName: name })
		}

		this.logger.debug(`Reconciliation done.`)
	}

}

module.exports = { Reconciler, ReconcilerData }