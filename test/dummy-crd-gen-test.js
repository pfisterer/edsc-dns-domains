const dummyCrdGen = require('../src/dummy-crd-gen')
const k8s = require('@kubernetes/client-node');
const { default: Operator } = require('@dot-i/k8s-operator');
const log4js = require('log4js')

function getLogger(name) {
	let log = log4js.getLogger(name);
	log.level = "debug";
	return log
}

class CrdHelper extends Operator {
	constructor(logger, crdFile, namespace) {
		super(logger);
		this.crdFile = crdFile;
		this.logger = logger;
		this.namespace = namespace
	}

	async init() {
		const { group, versions, plural } = await this.registerCustomResourceDefinition(this.crdFile);
		this.customObjectsApi = this.kubeConfig.makeApiClient(k8s.CustomObjectsApi)
		this.crdGroup = group;
		this.crdVersions = versions;
		this.crdPlural = plural;
	}
}

async function main() {
	const interval = 2000
	const namespace = "default"
	const crdFile = "src/crd-defs/dnssec-zone-crd-v1beta1.yaml"

	const crd = new CrdHelper(getLogger("CrdHelper"), crdFile, namespace)
	await crd.start();

	dummyCrdGen(crd.customObjectsApi, interval, crd.crdGroup, crd.crdVersions[0].name, namespace, crd.crdPlural, getLogger("dummyCrdGen"))
}

(
	async () => main()
)();