const tmp = require('tmp');
const fs = require('fs');
const glob = require('glob')
const path = require('path')
const globpromise = require('glob-promise')

const BindDnsSecKey = require("./dnssec-bind-key")
const condUpdate = require('../util/conditional-update-file.js')
const BindZone = require('./bind-zone.js')

tmp.setGracefulCleanup({ unsafeCleanup: true });

module.exports = class BindConfigGen {

	constructor(options) {
		this.options = options
		this.logger = options.logger("BindConfigGen")
		this.conditionalUpdateDest = condUpdate(this.logger)

		this.logger.debug("New instance with options: ", options);

		this.ensureConfigPathsExist();
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	namedConfName() {
		return path.join(this.options.configdir, "named.conf")
	}
	generatedFilesDir() {
		return path.join(this.options.configdir, "gen")
	}
	bindKeyFileName(spec) {
		return path.join(this.generatedFilesDir(), spec.domainName + ".key")
	}
	bindZoneFileName(spec) {
		return path.join(this.options.vardir, spec.domainName + ".db")
	}
	bindConfigFileName(spec) {
		return path.join(this.generatedFilesDir(), spec.domainName + ".conf")
	}
	zoneNameFromBindConfigFileName(filename) {
		return path.basename(filename, '.conf')
	}
	globPatternZones() {
		return this.generatedFilesDir() + '/*.conf';
	}
	globPatternKeys() {
		return this.generatedFilesDir() + '/*.key';
	}
	async getZones() {
		// Iterate all config files and generate include "filename"; configs
		const configs = await globpromise(this.globPatternZones())
		return configs.map(el => this.zoneNameFromBindConfigFileName(el))
	}
	ensureConfigPathsExist() {
		fs.mkdirSync(this.generatedFilesDir(), { recursive: true })
	}

	// -------------------------------------------------------------------
	// named.conf
	// -------------------------------------------------------------------

	generateNamedConf() {
		// Iterate all config files and generate include "filename"; configs
		let includesKeys = glob
			.sync(this.globPatternKeys())
			.map(el => `include "${el}";\n`)
			.sort()
			.reduce((a, b) => a + b, "")

		let includesZones = glob
			.sync(this.globPatternZones())
			.map(el => `include "${el}";\n`)
			.sort()
			.reduce((a, b) => a + b, "")

		let config = [
			`options {`,
			`	directory "/var/bind";`,
			`	listen-on { any; };`,
			`	listen-on-v6 { any; };`,
			`	allow-transfer { none; };`,
			`	auth-nxdomain no;    # conform to RFC1035`,
			//If you have problems and are behind a firewall `query-source address * port 53;`,
			`	pid-file "/var/run/named/named.pid";`,
			// Changing this is NOT RECOMMENDED; see the notes above and in named.conf.recursive.`
			`	allow-recursion { none; };`,
			`	recursion no;`,
			`};`,
			includesKeys,
			includesZones
		].join("\n")

		let changed = this.conditionalUpdateDest(config, this.namedConfName());
		return { changed: changed };
	}

	// -------------------------------------------------------------------
	// DNSSEC keygen
	// -------------------------------------------------------------------

	getOrGenerateKey(spec, status) {

		let options = Object.assign({}, {
			keyFileName: this.bindKeyFileName(spec),
			keyName: spec.domainName,
			currentStatus: status
		}, this.options)
		return new BindDnsSecKey(options).getKey()
	}

	// -------------------------------------------------------------------
	// Bind Config File
	// -------------------------------------------------------------------

	getOrCreateZoneFiles(bindZone, keyName) {
		const confFileName = this.bindConfigFileName(bindZone.getSpec())
		const zoneFileName = this.bindZoneFileName(bindZone.getSpec());

		//Create bind zone spec: zone {...}
		const zoneSpec = bindZone.getBindZoneSpec({ zoneFileName, keyName })
		const zoneSpecChanged = this.conditionalUpdateDest(zoneSpec, confFileName);

		//Create zone file
		const extraResourceRecords = undefined
		const zoneFile = bindZone.getZoneFile(extraResourceRecords)
		// Write config to file (?<= is a lookbehind expression, cf. https://2ality.com/2017/05/regexp-lookbehind-assertions.html)
		const zoneFileChanged = this.conditionalUpdateDest(zoneFile, zoneFileName,
			str => str.replace(/(?<=@ IN SOA [^\(]+ \()[0-9+]/gm, "__ignore_changed_serial_number__ "))

		return { "changed": zoneSpecChanged || zoneFileChanged, "confFile": confFileName, "zoneFile": zoneFileName };
	}

	// -------------------------------------------------------------------
	// Main management functionality
	// -------------------------------------------------------------------

	addOrUpdateZone(spec, status) {
		const bindZone = new BindZone(spec, this.options)

		//Validate input
		let validationResult = bindZone.validate()
		if (validationResult.error) {
			this.logger.error("addOrUpdateZone: Not processing zone due to error:", validationResult.error)
			return { changed: false, status: { "Error": validationResult.error } }
		}

		//Update configuration
		this.logger.debug("addOrUpdateZone: Starting to process zone", spec.domainName)
		let { changed: keyChanged, keyName, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(spec, status)
		let { changed: zoneFilesChanged } = this.getOrCreateZoneFiles(bindZone, keyName)
		let { changed: namedConfChanged } = this.generateNamedConf()

		let changed = keyChanged || zoneFilesChanged || namedConfChanged;
		let status = { keyName, dnssecKey, dnssecAlgorithm }

		this.logger.debug(`addOrUpdateZone: Done (zone=${spec.domainName}): changes: key: ${keyChanged}, zone files: ${zoneFilesChanged}, named.conf: ${namedConfChanged}`)
		if (changed)
			this.logger.info(`addOrUpdateZone: Zone ${spec.domainName} has changed`)

		return { changed, status };
	}

	deleteZone(spec) {
		const bindZone = new BindZone(spec, this.options)

		//Validate input
		let validationResult = bindZone.validateDomainName()
		if (validationResult.error) {
			this.logger.error("deleteZone: Not processing zone due to error:", validationResult.error)
			return { changed: false, status: { "Error": validationResult.error } }
		}

		//Delete the zone
		this.logger.debug(`deleteZone: Deleting zone`, spec)

		const filesToDelete = [this.bindKeyFileName(spec), this.bindConfigFileName(spec), this.bindZoneFileName(spec)]
		for (const f of filesToDelete) {
			this.logger.debug(`deleteZone: Deleting file for zone ${spec.domainName}`, f)
			fs.unlinkSync(f);
		}

		let { changed } = this.generateNamedConf()
		this.logger.debug(`deleteZone: Done deleting zone`, spec.domainName, `(changes: Named.conf: ${changed})`)

		return { changed }
	}

}
