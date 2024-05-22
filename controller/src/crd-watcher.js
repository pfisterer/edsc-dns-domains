const k8s = require('@kubernetes/client-node');
const { default: Operator, ResourceMetaImpl } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')

module.exports = class CrdWatcher extends Operator {

	constructor(options) {
		super(options.logger("Operator"));
		this.log = options.logger("CrdWatcher");
		this.options = options

		this.crdFile = options.crdFile;
		this.namespace = options.namespace
		this.events = new EventEmitter();

		this.log.debug("constructor: New instance with with crdFile", this.crdFile);
	}

	async init() {
		this.log.debug(`init: Registering CRD from file ${this.crdFile}`)
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.customObjectsApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi)
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;

		this.log = this.options.logger(`CrdWatcher(${plural}`);

		this.log.debug(`init: Watching group ${group}, versions[0].name ${versions[0].name}, plural ${plural}`)

		let watcher = async (event) => {
			try {
				this.events.emit(event.type, event)
			} catch (err) {
				this.log.warn(`watcher: Error in watch resource:`, err)
			}
		}

		await this.watchResource(group, versions[0].name, plural, watcher, this.namespace);
	}

	getCustomObjectsApi() {
		return this.customObjectsApi
	}

	async updateResourceStatus(cr, status) {
		this.log.debug(`updateResourceStatus: Updating status of ${cr.spec.domainName} to `, status)

		let meta = ResourceMetaImpl.createWithPlural(this.crdPlural, cr);

		return await this.patchResourceStatus(meta, status)
	}

	async *listItems(fieldSelector, labelSelector) {
		let _continue = undefined;

		do {
			const response = await this.customObjectsApi
				.listNamespacedCustomObject(
					this.crdGroup, this.crdVersions[0].name, this.namespace, this.crdPlural,
                	/* pretty = */ 'false', /* allowWatchBookmarks = */ false,
                	/* _continue = */ _continue, /* fieldSelector = */ fieldSelector,
					/* labelSelector = */ labelSelector
				)

			for (const item of response.body.items)
				yield item

			// Check whether we need to fetch more items
			_continue = response?.body?.metadata?.continue
		} while (_continue)
	}

}