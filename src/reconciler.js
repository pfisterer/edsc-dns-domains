const { fixed: { setIntervalAsync: setIntervalAsync }, clearIntervalAsync } = require('set-interval-async')


module.exports = class Reconciler {

	constructor(crdWatcher, bindConfigGen, bindProcessRunner, logger) {
		this.crdWatcher = crdWatcher;
		this.bindConfigGen = bindConfigGen
		this.bindProcessRunner = bindProcessRunner;
		this.logger = logger;

		this.crdWatcher.events.on('added', () => this.addedOrModified)
		this.crdWatcher.events.on('modified', () => this.addedOrModified)
		this.crdWatcher.events.on('deleted', () => deleted)

		this.reconcileInterval = 5000;
		this.setupReconcileTimer();
	}

	setupReconcileTimer() {
		if (this.reconcileTimer) {
			this.logger.debug(`Clearing existing timer`, this.reconcileTimer)
			clearIntervalAsync(this.reconcileTimer)
		}

		this.reconcileTimer = setIntervalAsync(async () => {
			this.logger.debug(`Running reconcile from timer`)
			await this.reconcile();
		}, this.reconcileInterval)
	}

	async addedOrModified(event) {
		const object = event.object
		let { changed, statusPatch } = this.bindConfigGen.addOrUpdateZone(object)

		if (changed) {
			this.bindProcessRunner.restart();
			await this.crdWatcher.setResourceStatus(event.meta, statusPatch)
		}
	}

	async deleted(event) {
		const object = event.object
		this.logger.debug(`Deleting zone with object`, object)
		if (bindConfigGen.deleteZone(object))
			bindProcessRunner.restart();
	}

	async reconcile() {
		this.logger.debug(`Starting reconciliation.`)

		const customResources = await this.crdWatcher.listItems()

		for (const zone of await this.bindConfigGen.getZones()) {
			this.logger.debug(`Reconcile, got existing zone ${zone}`)
		}

		this.logger.debug(`Reconciliation done.`)
	}

}
