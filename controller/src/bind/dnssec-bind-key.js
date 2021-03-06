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
		const keyLoadResult = this.loadKeyFile();
		const validFileSystemKey = this.isValidKey(keyLoadResult, `${this.options.keyFileName}`)
		const validStatusKey = this.isValidKey(this.options.currentStatus, "cr status")
		const statusAndFileSystemDiffer = !this.keyMatchesStatus(keyLoadResult, this.options.currentStatus)

		this.logger.debug(`getKey(${this.options.keyName}): validFileSystemKey = ${validFileSystemKey}, validStatusKey = ${validStatusKey}, statusAndFileSystemDiffer = ${statusAndFileSystemDiffer}`)

		let result;

		if (validStatusKey) { //A status in k8s exists

			if (statusAndFileSystemDiffer) { //Create correct key on file system
				this.logger.debug(`getKey(${this.options.keyName}): Status/Key don't match, creating new key on file system from current status`)
				this.createKeyFileFromExistingKey(this.options.keyFileName, this.options.currentStatus);

				let newKeyFileResult = this.loadKeyFile()
				this.logger.debug(`getKey(${this.options.keyName}): New key from status`, newKeyFileResult)
				result = Object.assign({}, { changed: true }, newKeyFileResult);

			} else { // All good
				this.logger.debug(`getKey(${this.options.keyName}): Everything fine`)
				result = Object.assign({}, { changed: false }, keyLoadResult);
			}

		} else { // No status in k8s exists

			if (validFileSystemKey) { //Load key from file system
				this.logger.debug(`getKey(${this.options.keyName}): Loading key from file system`)
				result = Object.assign({}, { changed: false }, keyLoadResult);

			} else { //Generate new key
				this.logger.debug(`getKey(${this.options.keyName}): Unable to load key from ${this.options.keyFileName}, generating a new one`)
				this.generateNewKeyFile();

				let newKeyFileResult = this.loadKeyFile()
				this.logger.debug(`getKey(${this.options.keyName}): New key from status`, newKeyFileResult)
				result = Object.assign({}, { changed: true }, newKeyFileResult)
			}
		}

		//this.logger.debug(`getKey(${this.options.keyName}): Result = `, result)
		return result
	}

	generateNewKeyFile() {

		if (this.options.dryrun) {
			//Generate dummy key on dry-run
			this.logger.debug(`generateNewKeyFile: Dry-run, created dummy key at ${this.options.keyFileName}`)
			this.createKeyFileFromExistingKey(this.options.keyFileName, {
				keyName: this.options.keyName,
				dnssecAlgorithm: "hmac-sha512",
				dnssecKey: "Fc7zMz2T5KrZjFY2kWbOkwyYOSTGHfu6r9LYTTQH1O64k2qs1k8ZcPVoj34E2AK/A+sHKquLaId89EM0xE8tew=="
			})

		} else {
			//Run rndc-confgen
			let cmd = `${this.options.rndcconfgenpath} -a -A hmac-sha512 -k '${this.options.keyName}' -c '${this.options.keyFileName}'`
			this.logger.debug(`generateNewKeyFile: Running command ${cmd}`)
			execSync(cmd)
		}

	}

	keyMatchesStatus(key, status) {
		if (!this.isValidKey(key, "keyMatchesStatus:key")) {
			this.logger.debug(`keyMatchesStatus: Invalid key`);
			return false;
		}

		if (!this.isValidKey(status, "keyMatchesStatus:status")) {
			this.logger.debug("keyMatchesStatus: Invalid status");
			return false;
		}

		for (let prop of ["keyName", "dnssecAlgorithm", "dnssecKey"]) {
			if (status[prop] !== key[prop]) {
				this.logger.debug(`keyMatchesStatus: ${prop} of status(${status[prop]}) != existing key(${key[prop]}), returning false`);
				return false;
			}
		}

		return true;
	}

	isValidKey(key, keyName) {
		if (!key) {
			this.logger.debug(`isValidKey: No key provided (keyname=${keyName}) returning false`);
			return false
		}

		for (let prop of ["keyName", "dnssecAlgorithm", "dnssecKey"]) {
			if (!key[prop]) {
				this.logger.debug(`isValidKey: ${prop} missing (keyname=${keyName}) in `, key, ` returning false`);
				return false;
			}
		}

		return true;
	}

	createKeyFileFromExistingKey(fileName, key) {
		let contents = [
			`key "${key.keyName}" {`,
			`	algorithm ${key.dnssecAlgorithm};`,
			`	secret "${key.dnssecKey}";`,
			`};`,
		].join('\n')

		this.logger.debug(`createKeyFileFromExistingKey: New key file ${fileName} with contents = `, contents);
		fs.writeFileSync(fileName, contents)
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
				this.logger.error(`Unable to load key from: '`, contents, "', parser state= ", parser)
				return null;
			}

			// Return data from parser results
			let result = {
				fileValid: true,
				keyFile: this.options.keyFileName,
				keyName: parser.results[0].keyname,
				dnssecAlgorithm: parser.results[0].algorithm,
				dnssecKey: parser.results[0].secret,
			}

			//this.logger.debug(`loadKeyFile: Loaded ${this.options.keyFileName}, result = `, result)

			return result;

		} catch (e) {
			this.logger.debug(`loadKeyFile: Unable to parse key file ${this.options.keyFileName}, error=`, e)
			return null;
		}

	}

}