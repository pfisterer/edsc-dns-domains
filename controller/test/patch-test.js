const path = require('path')
const CrdWatcher = require('../src/crd-watcher')

const crdWatcher = new CrdWatcher({
	crdFile: path.join(__dirname, "../src/crd-defs/dnssec-zone-crd-v1.yaml"),
	logger: () => console,
	namespace: "default"
});

(async () => {
	await crdWatcher.start();
	let cr = (await crdWatcher.listItems())[0]
	console.log("Status before:", cr.status)

	const status = { "Bla": "Blubb", "dnssecAlgorithm": "12345" }

	const response = await crdWatcher.updateResourceStatus(cr, status)
	console.log("Response=", response)

	cr = (await crdWatcher.listItems())[0]
	console.log("Status after:", cr.status)

	process.exit(0)
})()