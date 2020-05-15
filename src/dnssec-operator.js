const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')

module.exports = class DnssecOperator extends Operator {

	constructor({ logger, crdFile }) {
		super(logger);
		this.crdFile = crdFile;
		this.logger = logger;
		this.events = new EventEmitter();
	}

	async init() {
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;

		this.logger.debug(`Watching group ${group}, versions[0].name ${versions[0].name}, plural ${plural}`)
		await this.watchResource(group, versions[0].name, plural, async (e) => {
			try {
				if (e.type === ResourceEventType.Added) {
					logger.debug("Resource added", e)
					this.emit("added", event)

				} else if (e.type === ResourceEventType.Modified) {
					logger.debug("Resource modified", e)
					this.emit("modified", event)

				} else if (e.type === ResourceEventType.Deleted) {
					logger.debug("Resource deleted", e)
					this.emit("deleted", event)

				} else {
					logger.warn(`Unknown event type: ${e.type} of event `, e)
				}
			} catch (err) {
				logger.warn(`Error in watch resource:`, err)
			}
		});

	}

	async updateStatus(e, statusPatch) {
		/*

		e.object.body.status = Object.assign(body.status || {}, statusPatch)

		await this.setResourceStatus(e.meta, {
			observedGeneration: metadata.generation
		});
		*/
	}

}