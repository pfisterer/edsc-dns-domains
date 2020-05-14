const fs = require("fs")
const path = require('path');
const { execSync } = require('child_process');
const nearley = require("nearley");
const grammar = require("./dnssec-bind-key-grammar");

module.exports = class BindDnsSecKey {

	constructor(options) {
		this.options = Object.assign({}, {
			dryrun: false,
			rndcConfgenPath: null,
			keyFileName: null,
			keyName: null,
			logger: null
		}, options);

		if (!options.keyFileName)
			throw "options.keyFileName is missing"
	}

	debug() {
		if (this.options.logger)
			this.options.logger.debug.apply(this.options.logger, arguments)
		else
			console.log.apply(null, arguments)
	}

	getKey() {
		let loadResult = this.loadKeyFile();

		if (loadResult)
			return Object.assign({}, { changed: false }, loadResult);

		this.generateNewKeyFile();

		return Object.assign({}, { changed: true }, loadResult)
	}

	generateNewKeyFile() {

		if (this.options.dryrun) {
			let src = path.join(__dirname, "../test/dnssec-example.key")
			this.debug(`Dry-run, copying ${src} to ${this.options.keyFileName}`)
			fs.copyFileSync(src, this.options.keyFileName)

		} else {
			let cmd = `${this.options.rndcConfgenPath} -a -A hmac-sha512 -k '${this.options.keyname}' -c '${this.options.keyFileName}'`
			this.debug(`Running command ${cmd}`)
			execSync(cmd)

		}
	}

	loadKeyFile() {
		// Verify the file exists
		if (!fs.existsSync(this.options.keyFileName)) {
			this.debug(`Key file ${this.options.keyFileName} does not exist, returning.`)
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
				keyfilename: this.options.keyFileName,
				keyname: parser.results[0].keyname,
				algorithm: parser.results[0].algorithm,
				secret: parser.results[0].secret,
			}

		} catch (e) {
			this.debug(`Unable to parse key file ${this.options.keyFileName}, error=`, e)
			return null;
		}

	}

}