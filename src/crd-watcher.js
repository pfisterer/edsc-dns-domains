const EventEmitter = require('events')
const clonedeep = require('lodash').cloneDeep

module.exports = class CrdWatcher extends EventEmitter {

	constructor(client, crdDef, namespace, logger) {
		super()
		this.client = client;
		this.crdDef = crdDef;
		this.namespace = namespace;
		this.logger = logger;
	}

	async ensureCrdsAvailable() {
		//Wait for spec being loaded
		await this.client.loadSpec()

		// Create the CRD if it doesn't already exist.
		try {
			this.logger.info("Adding CRD")
			await this.client
				.apis['apiextensions.k8s.io'].v1
				//.namespaces(this.namespace)
				.customresourcedefinitions
				.post({ body: this.crdDef })

		} catch (err) {
			// API returns a 409 Conflict if CRD already exists.
			if (err.statusCode == 409) {
				this.logger.debug("CRD already exists")
			} else {
				throw err
			}
		}

		// Add endpoints to our client
		await this.client.addCustomResourceDefinition(this.crdDef)
	}

	async deleteCrdDef() {
		throw "deleteCrdDef: Not implemented"
	}

	async start() {
		if (this.stream)
			this.stop();

		this.crdGroup = this.crdDef.spec.group;
		this.pluralName = this.crdDef.spec.names.plural

		await this.ensureCrdsAvailable();

		console.log(`Using CRD with name ${this.crdGroup}`)

		this.stream = await this.startStream()

		this.stream.on("end", async event => {
			if (this.stream) {
				this.logger.debug("Event stream ended, restarting stream");
				this.start();
			}
		});
		this.stream.on("error", async event => {
			if (this.stream) {
				this.logger.debug("Event stream ended, restarting stream");
				this.start();
			}
		});
	}

	stop() {
		if (this.stream) {
			this.logger.debug("Stopping stream");

			this.stream.destroy();
			this.stream = null;

			this.logger.debug("Stopped");
		}
	}


	async getAll() {
		const all = await this.client
			.apis[this.crdGroup].v1
			.namespaces(this.namespace)[this.pluralName].get()

		this.logger.debug('All: ', all)
	}

	async create(crd) {
		this.logger.debug("Creating new crd instance: ", crd)

		const newCrd = await this.client
			.apis[this.crdGroup].v1
			.namespaces(this.namespace)[this.pluralName]
			.post({ body: crd })

		this.logger.debug("Created new crd instance: ", newCrd)
	}

	async remove(crdName) {
		this.logger.debug("About to delete crd with name", crdName)

		const result = await this.client
			.apis[this.crdGroup].v1
			.namespaces(this.namespace)[this.pluralName](crdName)
			.delete()

		this.logger.debug("Delete result of crd with name: ", result)
	}

	// Inspired by https://github.com/godaddy/kubernetes-external-secrets/blob/master/lib/custom-resource-manager.js" and	
	// https://github.com/godaddy/kubernetes-external-secrets/blob/f26bf2bb14cfc7f6827e53550c8474b89133bc45/lib/poller.js
	async updateStatus(customResource, statusPatch) {
		this.logger.debug("Request to update status of ", customResource, " to ", statusPatch)
		const resourceName = customResource.metadata.name

		/*
		const resourceVersion = customResource.metadata.resourceVersion
		const body = clonedeep(customResource)
		body.status = Object.assign(body.status || {}, statusPatch)
		body.metadata.resourceVersion = resourceVersion
		console.log(await this.client.apis[this.crdGroup].v1)
		await this.client.apis[this.crdGroup].v1.put({ body })
		*/

		console.log(this.client.apis[this.crdGroup].v1[this.pluralName])

		this.client.apis[this.crdGroup].v1[this.pluralName](resourceName).status.put(statusPatch)
		this.logger.debug("Updated status from", customResource.status, "to", body.status, "of new crd object", body)

		/*
		this._status = this._kubeClient
			.apis[this._customResourceManifest.spec.group]
			.v1.namespaces(this._namespace)[this._customResourceManifest.spec.names.plural](this._name).status
		await this._status.put({
			body: {
				...this._externalSecret,
				status: {
					lastSync: `${new Date().toISOString()}`,
					observedGeneration: this._externalSecret.metadata.generation,
					status
				}
			}
		})*/
	}

	async startStream() {
		this.logger.debug("Watching event stream")

		//Wait for spec being loaded
		await this.client.loadSpec()

		let stream = await this.client
			.apis[this.crdGroup].v1
			//.namespaces(this.namespace)
			.watch[this.pluralName]
			.getObjectStream()

		stream.on('data', async event => {

			if (event.type === 'ADDED') {
				this.logger.debug("Added", event);
				this.emit("added", event.object)

			} else if (event.type === 'MODIFIED') {
				this.logger.debug("Modified", event);
				this.emit("modified", event.object)

			} else if (event.type === 'DELETED') {
				this.logger.debug("Deleted", event);
				this.emit("deleted", event.object)

			} else {
				this.logger.debug(`Unhandled event type: ${event.type}`)
				this.emit("unhandled", event)
			}

		})

		return stream
	}

};
