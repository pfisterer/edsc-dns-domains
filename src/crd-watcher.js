const k8s = require('@kubernetes/client-node');
const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')

module.exports = class CrdWatcher extends Operator {

	constructor(logger, crdFile, namespace) {
		super(logger);
		this.crdFile = crdFile;
		this.logger = logger;
		this.namespace = namespace
		this.events = new EventEmitter();
	}

	async init() {
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.customObjectsApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi)
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;

		this.logger.debug(`Watching group ${group}, versions[0].name ${versions[0].name}, plural ${plural}`)

		let watcher = async (event) => {
			try {
				if (event.type === ResourceEventType.Added) {
					this.logger.debug("Resource added", event.object.metadata.name)
					this.events.emit("added", event)

				} else if (event.type === ResourceEventType.Modified) {
					this.logger.debug("Resource modified", event.object.metadata.name)
					this.events.emit("modified", event)

				} else if (event.type === ResourceEventType.Deleted) {
					this.logger.debug("Resource deleted", event.object.metadata.name)
					this.events.emit("deleted", event)

				} else {
					this.logger.warn(`Unknown event type: ${e.type} of event `, e)
				}
			} catch (err) {
				this.logger.warn(`Error in watch resource:`, err)
			}
		}

		await this.watchResource(group, versions[0].name, plural, watcher, this.namespace);
	}

	getCustomObjectsApi() {
		return this.customObjectsApi
	}

	async listItems() {
		const res = await this.customObjectsApi.listNamespacedCustomObject(
			this.crdGroup,
			this.crdVersions[0].name,
			'default', //<your namespace>
			this.crdPlural,
			'false',
			'', //<labelSelectorExpresson>
		);

		return res.body.items
	}

}