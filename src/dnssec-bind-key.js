const fs = require("fs")
const path = require('path');
const { execSync } = require('child_process');
const nearley = require("nearley");
const grammar = require("./bind-key-grammar");

module.exports = class BindDnsSecKey {

	constructor(options) {
		this.options = options;
		this.logger = options.logger ? options.logger("BindDnsSecKey") : function () { console.log.apply(null, arguments) }

		if (!options.keyFileName)
			throw "options.keyFileName is missing"

		if (!options.keyName)
			throw "options.keyName is missing"

		if (!options.rndcconfgenpath)
			throw "options.rndcconfgenpath is missing"
	}

	getKey() {
		const loadResult = this.loadKeyFile();

		if (loadResult) {
			this.logger.debug(`getKey: Loaded from ${this.options.keyFileName}`)
			return Object.assign({}, { changed: false }, loadResult);
		}

		this.logger.debug(`getKey: Unable to load key from ${this.options.keyFileName}, generating a new one`)

		this.generateNewKeyFile();

		return Object.assign({}, { changed: true }, this.loadKeyFile())
	}

	generateNewKeyFile() {

		if (this.options.dryrun) {
			this.logger.debug(`generateNewKeyFile: Dry-run, created dummy key at ${this.options.keyFileName}`)
			fs.writeFileSync(this.options.keyFileName, `key "${this.options.keyName}" {
	algorithm hmac-sha512;
	secret "Fc7zMz2T5KrZjFY2kWbOkwyYOSTGHfu6r9LYTTQH1O64k2qs1k8ZcPVoj34E2AK/A+sHKquLaId89EM0xE8tew==";
};
`)

		} else {
			//Run rndc-confgen
			let cmd = `${this.options.rndcconfgenpath} -a -A hmac-sha512 -k '${this.options.keyName}' -c '${this.options.keyFileName}'`
			this.logger.debug(`generateNewKeyFile: Running command ${cmd}`)
			execSync(cmd)
		}

	}

	loadKeyFile() {
		// Verify the file exists
		if (!fs.existsSync(this.options.keyFileName)) {
			this.logger.debug(`loadKeyFile: Key file ${this.options.keyFileName} does not exist, returning.`)
			return null;
		}

		// Load key file contents
		const contents = fs.readFileSync(this.options.keyFileName, 'utf8');

		// Parse file contents using the pre-compiled grammar
		try {
			const parser = new nearley.Parser(nearley.Grammar.fromCompiled(grammar));
			parser.feed(contents)

			// Parsing failed
			if (!parser.results || !parser.results[0]) {
				return null;
			}

			// Return data from parser results
			return {
				fileValid: true,
				keyFile: this.options.keyFileName,
				keyName: parser.results[0].keyname,
				dnssecAlgorithm: parser.results[0].algorithm,
				dnssecKey: parser.results[0].secret,
			}

		} catch (e) {
			this.logger.debug(`loadKeyFile: Unable to parse key file ${this.options.keyFileName}, error=`, e)
			return null;
		}

	}

}