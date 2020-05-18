const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')

module.exports = class DnssecOperator extends Operator {

	constructor(logger, crdFile) {
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

		await this.watchResource(group, versions[0].name, plural, async (event) => {
			try {
				if (event.type === ResourceEventType.Added) {
					this.logger.debug("Resource added", event)
					this.events.emit("added", event)

				} else if (event.type === ResourceEventType.Modified) {
					this.logger.debug("Resource modified", event)
					this.events.emit("modified", event)

				} else if (event.type === ResourceEventType.Deleted) {
					this.logger.debug("Resource deleted", event)
					this.events.emit("deleted", event)

				} else {
					this.logger.warn(`Unknown event type: ${e.type} of event `, e)
				}
			} catch (err) {
				this.logger.warn(`Error in watch resource:`, err)
			}
		});

	}

}