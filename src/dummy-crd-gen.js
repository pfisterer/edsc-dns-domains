const randomWords = require('./randomwords.js')

module.exports = function generateRandomCrds(options) {
	let k8sclient = options.client
	let namespace = options.namespace
	let logger = options.logger
	let crdGroup = options.crdGroup
	let interval = options.interval || 5000

	setInterval(async () => {
		const name = randomWords(2).join('.')
		const meta_name = `domain-${name}`

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

		logger.debug(`Creating zone ${name} in namespace ${namespace}`)
		const create = await k8sclient
			.apis[crdGroup].v1
			.namespaces(namespace)
			.dnsseczones.post({ body: dnsZone })

		logger.debug(`Done creating zone ${name} in namespace ${namespace}, result = `, create)

		setTimeout(async () => {
			logger.debug(`Deleting dnssec zone ${name}, meta.name: ${meta_name}`)

			const del = await k8sclient
				.apis[crdGroup].v1
				.namespaces(namespace)
				.dnsseczones(meta_name)
				.delete()

			logger.debug(`Done deleting dnssec zone ${name}, meta.name: ${meta_name}, result = `, del)

		}, interval / 2)

	}, interval)

}

