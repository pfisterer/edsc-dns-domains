const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const EventEmitter = require('events')
const path = require("path")

class DnssecOperator extends Operator {

	constructor(logger, crdFile) {
		super(logger);
		this.crdFile = crdFile;
		this.logger = logger;
		this.events = new EventEmitter();
	}

	async init() {
		console.log("this.crdFile", this.crdFile)
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;

		console.log(`Watching group ${group}, versions[0].name ${versions[0].name}, plural ${plural}`)
		await this.watchResource(group, versions[0].name, plural, async (e) => {
			try {
				if (e.type === ResourceEventType.Added) {
					console.log("Resource added", e)

				} else if (e.type === ResourceEventType.Modified) {
					console.log("Resource modified", e)

				} else if (e.type === ResourceEventType.Deleted) {
					console.log("Resource deleted", e)

				} else {
					console.log(`Unknown event type: ${e.type} of event `, e)
				}
			} catch (err) {
				console.log(`Error in watch resource:`, err)
			}
		});

	}

}

process.on('unhandledRejection', err => console.error(err));

(async () => {
	const p = path.join(__dirname, "../src/crd-defs/dnssec-zone-crd-v1beta1.yaml")
	console.log(p)
	const operator = new DnssecOperator(console, p);
	await operator.start();
})();