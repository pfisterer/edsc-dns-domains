const k8s = require('@kubernetes/client-node');
const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')

module.exports = class CrdWatcher extends Operator {

	constructor(options) {
		super(options.logger("Operator"));

		this.crdFile = options.crdFile;
		this.log = options.logger("CrdWatcher");
		this.namespace = options.namespace

		this.events = new EventEmitter();

		this.log.debug("constructor: New instance with options: ", options);
	}

	async init() {
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.customObjectsApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi)
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;

		this.log.debug(`init: Watching group ${group}, versions[0].name ${versions[0].name}, plural ${plural}`)

		let watcher = async (event) => {
			try {
				if (event.type === ResourceEventType.Added) {
					this.log.debug("watcher: Resource added", event.object.metadata.name)
					this.events.emit("added", event)

				} else if (event.type === ResourceEventType.Modified) {
					this.log.debug("watcher: Resource modified", event.object.metadata.name)
					this.events.emit("modified", event)

				} else if (event.type === ResourceEventType.Deleted) {
					this.log.debug("watcher: Resource deleted", event.object.metadata.name)
					this.events.emit("deleted", event)

				} else {
					this.log.warn(`watcher: Unknown event type: ${e.type} of event `, e)
				}
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
		//this.log.debug(`updateResourceStatus: Updating status of ${cr.spec.domainName} to `, status)

		//copied from node_modules/@dot-i/k8s-operator/dist/operator.js since it is not exported
		class ResourceMetaImpl {
			constructor(id, object) {
				var _a, _b;
				if (!((_a = object.metadata) === null || _a === void 0 ? void 0 : _a.name) || !((_b = object.metadata) === null || _b === void 0 ? void 0 : _b.resourceVersion) || !object.apiVersion || !object.kind) {
					throw Error(`Malformed event object for '${id}'`);
				}
				this.id = id;
				this.name = object.metadata.name;
				this.namespace = object.metadata.namespace;
				this.resourceVersion = object.metadata.resourceVersion;
				this.apiVersion = object.apiVersion;
				this.kind = object.kind;
			}
			static createWithId(id, object) {
				return new ResourceMetaImpl(id, object);
			}
			static createWithPlural(plural, object) {
				return new ResourceMetaImpl(`${plural}.${object.apiVersion}`, object);
			}
		}

		let meta = ResourceMetaImpl.createWithPlural(this.crdPlural, cr);

		return await this.patchResourceStatus(meta, status)
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