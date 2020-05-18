// From https://gist.github.com/wittfeldt/29a87a6ee1a3975c991dcfc2276e1ba3
const { default: Operator, ResourceEventType } = require('@dot-i/k8s-operator');
const Path = require('path');

class FooOperator extends Operator {
	constructor() {
		super();
	}

	async init() {
		await this.registerCustomResourceDefinition(
			Path.resolve(__dirname, 'crd.yaml')
		);

		await this.watchResource('acme.org', 'v1', 'foos', async ev => {
			console.log('received event:', ev);
		}, 'default');
	}
}

process.on('unhandledRejection', err => console.error(err));

(async () => {
	const operator = new FooOperator();
	await operator.start();
})();