module.exports = async function generateRandomCrds(k8sclient, interval, crdGroup, version, namespace, plural, genFunction, logger) {

	async function createCustomResource(body) {
		return k8sclient.createNamespacedCustomObject(crdGroup, version, namespace, plural, body)
	}

	async function deleteCustomResource(name) {
		try {
			return await k8sclient.deleteNamespacedCustomObject(crdGroup, version, namespace, plural, name)
		} catch (e) {
			logger.warn(`Unable to delete ${name}: `, e)
			return null;
		}
	}

	async function f() {
		const newResource = genFunction()
		const meta_name = newResource.metadata.name

		// Create
		let createResult = await createCustomResource(newResource)
		logger.debug(`Created custom resource ${plural}/${meta_name}`)

		// Delete
		setTimeout(async () => {
			let deleteResult = await deleteCustomResource(meta_name)
			logger.debug(`Deleting custom resource ${plural}/${meta_name}`)
		}, 2 * interval)
	}

	f();
	setInterval(f, interval)
}

