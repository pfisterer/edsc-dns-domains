const randomWords = require('./randomwords.js')


module.exports = function generateRandomCrds(k8sclient, interval, crdGroup, version, namespace, plural, logger) {

	let createCustomResource = async (body) => {
		return k8sclient.createNamespacedCustomObject(crdGroup, version, namespace, plural, body)
	}

	let deleteCustomResource = async (name) => {
		try {
			return await k8sclient.deleteNamespacedCustomObject(crdGroup, version, namespace, plural, name)
		} catch (e) {
			logger.warn(`Unable to delete ${name}: `, e)
			return null;
		}

	}

	let genFunc = async () => {
		const name = randomWords(2).join('.')
		const meta_name = `domain-${name}`

		// Create spec
		const dnsZone = {
			"apiVersion": "dnsseczone.farberg.de/v1",
			"kind": "DnssecZone",
			"metadata": { "name": meta_name },
			"spec": {
				"domainName": name,
				"adminContact": `admin.${name}`,
				"ttlSeconds": 60,
				"refreshSeconds": 60,
				"retrySeconds": 60,
				"expireSeconds": 60,
				"minimumSeconds": 60
			}
		}

		// Create
		logger.debug(`Creating zone ${name} in namespace ${namespace}`)
		let createResult = await createCustomResource(dnsZone)
		//logger.debug(`Done creating zone ${name} in namespace ${namespace}, result = `, createResult)

		// Delete
		setTimeout(async () => {
			logger.debug(`Deleting dnssec zone ${name} with meta.name: ${meta_name}`)
			let deleteResult = await deleteCustomResource(meta_name)
			//logger.debug(`Done deleting dnssec zone ${name}, meta.name: ${meta_name}, result = `, deleteResult)

		}, 2 * interval)
	}

	genFunc();
	setInterval(genFunc, interval)
}

