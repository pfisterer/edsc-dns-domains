const tmp = require('tmp');
const fs = require('fs');
const crypto = require('crypto');
const glob = require('glob')
const path = require('path')
const globpromise = require('glob-promise')
const BindDnsSecKey = require("../src/dnssec-bind-key")

tmp.setGracefulCleanup({ unsafeCleanup: true });

module.exports = class BindConfigGen {

	constructor(options) {
		this.options = options
		this.configDir = options.configdir
		this.rndcconfgenpath = options.rndcconfgenpath
		this.logger = options.logger("BindConfigGen")

		this.logger.debug("New instance with options: ", options);
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	namedConfName() {
		return this.configDir + "/named.conf"
	}
	generatedFilesDir() {
		return this.configDir + "/gen/"
	}
	bindKeyFileName(spec) {
		return this.generatedFilesDir() + spec.domainName + ".key";
	}
	bindZoneFileName(spec) {
		return this.generatedFilesDir() + spec.domainName + ".db";
	}
	bindConfigFileName(spec) {
		return this.generatedFilesDir() + spec.domainName + ".conf";
	}
	zoneNameFromBindConfigFileName(filename) {
		return path.basename(filename, '.conf')
	}
	ensureConfigPathsExist() {
		fs.mkdirSync(this.generatedFilesDir(), { recursive: true })
	}

	validateString(data) {
		if (!data)
			return false
		if (!(typeof data === "string"))
			return false
		if (data.length <= 0)
			return false
		return true
	}

	validateNonNegInt(data) {
		if (!data)
			return false
		if (isNaN(parseInt(data)))
			return false
		if (parseInt(data) < 0)
			return false
		return true
	}

	validateZone(spec) {
		//Validate domain name exists
		if (!this.validateString(spec.domainName))
			return { error: `Invalid string field 'spec.domainName' in spec ${JSON.stringify(spec)}` }

		//Validate domain name (from https://regexr.com/3au3g)
		const validDomainRegexp = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/gi;
		if (!spec.domainName.match(validDomainRegexp))
			return { error: `Not adding/updating invalid domain name ${spec.domainName} in spec ${JSON.stringify(spec)}` }

		//Validate string fields
		for (const field of ["adminContact"])
			if (!this.validateString(spec[field]))
				return { error: `Invalid string field ${field} of ${spec.domainName}: ${spec[field]} in spec ${JSON.stringify(spec)}` }

		//Validate int fields
		for (const field of ["ttlSeconds", "refreshSeconds", "retrySeconds", "expireSeconds", "minimumSeconds"])
			if (!this.validateNonNegInt(spec[field]))
				return { error: `Invalid int field ${field} of ${spec.domainName}: ${spec[field]} in spec ${JSON.stringify(spec)}` }

		return {}
	}

	conditionalUpdateDest(content, destFile, modifyCallbackBeforeHash) {
		this.logger.debug(`conditionalUpdateDest: Checking whether ${destFile} needs to be updated`)

		let hash = (str) => {
			// Invoke a modify callback before hashing (e.g., to remove permanently changing fields)
			if (modifyCallbackBeforeHash)
				str = modifyCallbackBeforeHash(str);

			//Return the hash
			return crypto.createHash('sha256').update(str).digest('hex');
		}

		function hashFile(file) {
			return hash(fs.readFileSync(file, "utf-8"))
		}

		let destinationExists = fs.existsSync(destFile);
		let destFileHash = destinationExists ? hashFile(destFile) : "-1";
		let contentHash = hash(content)

		if (destFileHash !== contentHash) {
			this.logger.debug(`conditionalUpdateDest: Updating ${destFile} with new content: ${content}`)
			fs.writeFileSync(destFile, content)
			return true;
		}

		this.logger.debug(`conditionalUpdateDest: Not updating ${destFile} since it would be unchanged`)
		return false;
	}

	// -------------------------------------------------------------------
	// named.conf
	// -------------------------------------------------------------------

	generateNamedConf() {

		// Iterate all config files and generate include "filename"; configs
		let includes = glob
			.sync(this.generatedFilesDir() + '*.conf')
			.map(el => `include "${el}";\n`)
			.sort()
			.reduce((a, b) => a + b, "")

		let namedConf = `
options {
	directory "/var/bind";

	listen-on { any; };
	listen-on-v6 { any; };
	allow-transfer { none; };
	auth-nxdomain no;    # conform to RFC1035

	// If you have problems and are behind a firewall:
	//query-source address * port 53;

	pid-file "/var/run/named/named.pid";

	// Changing this is NOT RECOMMENDED; see the notes above and in named.conf.recursive.
	allow-recursion { none; };
	recursion no;
};

${includes}
`
		let changed = this.conditionalUpdateDest(namedConf, this.namedConfName());
		return { changed: changed };
	}

	// -------------------------------------------------------------------
	// Get all existing zones
	// -------------------------------------------------------------------

	async getZones() {
		// Iterate all config files and generate include "filename"; configs
		const configs = await globpromise(this.generatedFilesDir() + '*.conf')
		return configs.map(el => this.zoneNameFromBindConfigFileName(el))
	}


	// -------------------------------------------------------------------
	// DNSSEC keygen
	// -------------------------------------------------------------------

	getOrGenerateKey(spec) {
		const key = new BindDnsSecKey(
			Object.assign({}, {
				keyFileName: this.bindKeyFileName(spec),
				keyName: spec.domainName
			}, this.options))

		return Object.assign({ changed: true }, key.getKey())
	}

	// -------------------------------------------------------------------
	// Bind Config File
	// -------------------------------------------------------------------

	getOrCreateBindConfigFile(spec, keyName) {
		let confFileName = this.bindConfigFileName(spec)
		let zoneFileName = this.bindZoneFileName(spec);

		let changed = this.conditionalUpdateDest(`zone "${spec.domainName}" {
	type master;
	file "${zoneFileName}";
	allow-update { key ${keyName}; };
};
`, confFileName);

		return { "changed": changed, "confFile": confFileName, "zoneFile": zoneFileName };
	}

	// -------------------------------------------------------------------
	// Zonefile
	// -------------------------------------------------------------------

	getOrCreateZoneFile(spec, zoneFile) {

		// Generate config contents
		let config = `$ORIGIN .
$TTL ${spec.ttlSeconds}; 1 minute
${spec.domainName} IN SOA ${this.options.nameserver1}. ${spec.adminContact}. (
	${Math.round(Date.now() / 6000)}; serial
	${spec.refreshSeconds}; refresh
	${spec.retrySeconds}; retry
	${spec.expireSeconds}; expire
	${spec.minimumSeconds}; minimum
)
;
	NS	${this.options.nameserver1}.
	NS	${this.options.nameserver2}.
`
		// Write config to file
		let changed = this.conditionalUpdateDest(config, zoneFile,
			str => str.replace(/\s*(\d+)\s*\;\s*serial/gm, "__serial_number_was_here__"));

		return { "changed": changed };
	}

	// -------------------------------------------------------------------
	// Main management functionality
	// -------------------------------------------------------------------

	/*
		spec:
		{
			associatedPrincipals: ["dennis.pfisterer@dhbw-mannheim.de"],
			nameserver: "e-ns.example.com",
			adminContact: 'admin.bla.test.de.',
			domainName: 'bla.test.de',
			expireSeconds: 600,
			minimumSeconds: 60,
			refreshSeconds: 60,
			retrySeconds: 60,
			ttlSeconds: 60
		 }
		 */
	addOrUpdateZone(spec) {
		this.logger.debug("addOrUpdateZone: Starting to process zone", spec.domainName)

		//Validate input
		let validationResult = this.validateZone(spec)
		if (validationResult.error) {
			this.logger.error("addOrUpdateZone: Not processing zone due to error:", validationResult.error)
			return { changed: false, status: { "Error": validationResult.error } }
		}

		//Create config path
		this.ensureConfigPathsExist();

		//Update configuration
		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: keyChanged, keyName, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(spec)
		let { changed: configChanged, zoneFile } = this.getOrCreateBindConfigFile(spec, keyName)
		let { changed: zoneFileChanged } = this.getOrCreateZoneFile(spec, zoneFile)

		this.logger.debug(`addOrUpdateZone: Done processing zone `, spec.domainName, ` (changes: Key: ${keyChanged} || Config: ${configChanged} || Zonefile: ${zoneFileChanged} || Named.conf: ${namedConfChanged}`)

		//Check result
		let changed = keyChanged || configChanged || zoneFileChanged || namedConfChanged;
		let status = { keyName, dnssecKey, dnssecAlgorithm }

		if (changed) {
			this.logger.info(`addOrUpdateZone: Zone ${spec.domainName} has changed`)
		}

		return { changed, status };
	}

	deleteZone(spec) {
		let validationResult = this.validateZone(spec)
		if (validationResult.error) {
			this.logger.error("deleteZone: Not processing zone due to error:", validationResult.error)
			return { changed: false, error: validationResult.error }
		}

		this.logger.debug(`deleteZone: Deleting zone`, spec)

		const filesToDelete = [this.bindKeyFileName(spec), this.bindConfigFileName(spec), this.bindZoneFileName(spec)]

		for (const f of filesToDelete) {
			this.logger.debug(`deleteZone: Deleting file for zone ${spec.domainName}`, f)
			fs.unlinkSync(f);
		}

		let { changed } = this.generateNamedConf()
		this.logger.debug(`deleteZone: Done deleting zone `, spec.domainName, ` (changes: Named.conf: ${changed})`)

		return { changed }
	}

}
