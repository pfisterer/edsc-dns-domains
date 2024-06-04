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

		this.logger.debug("constructor - New instance")

		this.defaultFilePermissions = 0o664
		this.defaultPathPermissions = 0o755

		this.ensureConfigPathsExist()
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
		fs.chmodSync(this.generatedFilesDir(), this.defaultPathPermissions)
	}

	// -------------------------------------------------------------------
	// named.conf
	// -------------------------------------------------------------------

	verboseLoggingConf() {
		return `logging {
			channel custom_debug_syslog {
				syslog daemon;
				severity debug 20; # add 20 after debug for full logging
			};

			category default { custom_debug_syslog; };
			category general { custom_debug_syslog; };
			category database { custom_debug_syslog; };
			category security { custom_debug_syslog; };
			category config { custom_debug_syslog; };
			category resolver { custom_debug_syslog; };
			category xfer-in { custom_debug_syslog; };
			category xfer-out { custom_debug_syslog; };
			category notify { custom_debug_syslog; };
			category client { custom_debug_syslog; };
			category unmatched { custom_debug_syslog; };
			category queries { custom_debug_syslog; };
			category network { custom_debug_syslog; };
			category update { custom_debug_syslog; };
			category dispatch { custom_debug_syslog; };
			category dnssec { custom_debug_syslog; };
			category lame-servers { custom_debug_syslog; };
			category security { custom_debug_syslog; };
		};`
	}

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
			`	listen-on { 0.0.0.0/0; };`,
			`	listen-on-v6 { any; };`,
			// `	listen-on { any; };`,
			// `	listen-on-v6 { any; };`,
			`	allow-transfer { none; };`,
			`	auth-nxdomain no;    # conform to RFC1035`,
			// If you have problems and are behind a firewall `query-source address * port 53;`,
			`	pid-file "/var/run/named/named.pid";`,
			// Changing this is NOT RECOMMENDED; see the notes above and in named.conf.recursive.`
			`	allow-recursion { none; };`,
			`	recursion no;`,
			`};`,
			this.options.bindVerboseOutput ? this.verboseLoggingConf() : "",
			includesKeys,
			includesZones
		].join("\n")

		let changed = this.conditionalUpdateDest(config, this.namedConfName(), null, this.defaultFilePermissions);
		return { changed: changed };
	}

	// -------------------------------------------------------------------
	// DNSSEC keygen
	// -------------------------------------------------------------------

	getOrGenerateKey(spec, status) {
		const keyFileName = this.bindKeyFileName(spec)

		let options = Object.assign({}, {
			keyFileName,
			keyName: spec.domainName,
			currentStatus: status
		}, this.options)

		let key = new BindDnsSecKey(options).getKey()

		//Set file permissions
		if (fs.existsSync(keyFileName) && this.defaultFilePermissions) {
			this.logger.debug(`Updating permissions of ${keyFileName} to ${this.defaultFilePermissions}`)
			fs.chmodSync(keyFileName, this.defaultFilePermissions)
		}

		//this.logger.debug(`getOrGenerateKey: Result of getKey = `, key)
		return key
	}

	// -------------------------------------------------------------------
	// Bind Config File
	// -------------------------------------------------------------------

	getOrCreateZoneFiles(bindZone, keyName) {
		const confFileName = this.bindConfigFileName(bindZone.getSpec())
		const zoneFileName = this.bindZoneFileName(bindZone.getSpec());

		//Create bind zone spec: zone {...}
		const zoneSpec = bindZone.getBindZoneSpec({ zoneFileName, keyName })
		const zoneSpecChanged = this.conditionalUpdateDest(zoneSpec, confFileName, null, this.defaultFilePermissions);

		//Create zone file
		const extraResourceRecords = undefined
		const zoneFile = bindZone.getZoneFile(extraResourceRecords)
		// Write config to file (?<= is a lookbehind expression, cf. https://2ality.com/2017/05/regexp-lookbehind-assertions.html)
		const zoneFileChanged = this.conditionalUpdateDest(
			zoneFile,
			zoneFileName,
			str => str.replace(/(?<=@ IN SOA [^\(]+ \()[0-9+]/gm, "__ignore_changed_serial_number__ "),
			this.defaultFilePermissions
		)

		return { "changed": zoneSpecChanged || zoneFileChanged, "confFile": confFileName, "zoneFile": zoneFileName };
	}

	// -------------------------------------------------------------------
	// Main management functionality
	// -------------------------------------------------------------------

	addOrUpdateZone(spec, crStatus) {
		const bindZone = new BindZone(spec, this.options)

		//Validate input
		let validationResult = bindZone.validate()
		if (validationResult.error) {
			this.logger.error("addOrUpdateZone: Not processing zone due to error:", validationResult.error)
			return { changed: false, status: { "Error": validationResult.error } }
		}

		//Update configuration
		this.logger.debug("addOrUpdateZone: Starting to process zone", spec.domainName)
		let { changed: keyChanged, keyName, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(spec, crStatus)
		let { changed: zoneFilesChanged } = this.getOrCreateZoneFiles(bindZone, keyName)
		let { changed: namedConfChanged } = this.generateNamedConf()

		let changed = keyChanged || zoneFilesChanged || namedConfChanged
		let status = { keyName, dnssecKey, dnssecAlgorithm }

		this.logger.debug(`addOrUpdateZone: Done (zone=${spec.domainName}): changes: key: ${keyChanged}, zone files: ${zoneFilesChanged}, named.conf: ${namedConfChanged}`)
		if (changed)
			this.logger.info(`addOrUpdateZone: Zone ${spec.domainName} has changed`)

		return { changed, status }
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
			try {
				fs.unlinkSync(f);
			} catch (e) {
				this.logger.debug(`deleteZone: Error deleting file for zone ${spec.domainName}`, f, e)
			}
		}

		let { changed } = this.generateNamedConf()
		this.logger.debug(`deleteZone: Done deleting zone`, spec.domainName, `(changes: Named.conf: ${changed})`)

		return { changed }
	}

}
