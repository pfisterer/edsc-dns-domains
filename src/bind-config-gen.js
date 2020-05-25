const tmp = require('tmp');
const fs = require('fs');
const crypto = require('crypto');
const glob = require('glob')
const path = require('path')
const globpromise = require('glob-promise')
const BindDnsSecKey = require("../src/dnssec-bind-key")

tmp.setGracefulCleanup({ unsafeCleanup: true });

function logAndThrow(logger, err) {
	logger.error(err)
	throw { err: err };
}

module.exports = class BindConfigUpdater {

	constructor(options) {
		this.options = options
		this.configDir = options.configdir
		this.logger = options.logger
	}

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------

	namedConfName() {
		return this.configDir + "/named.conf"
	}
	bindConfLocalFileName() {
		return this.configDir + "/named.conf.local";
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

	validateZone(spec) {
		//From https://regexr.com/3au3g
		const validDomainRegexp = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/gi;

		if (!spec.domainName.match(validDomainRegexp))
			logAndThrow(this.logger, `Not adding/updating invalid domain name ${zone.domainName}`)
	}

	ensureConfigPathsExist() {
		fs.mkdirSync(this.generatedFilesDir(), { recursive: true })
	}

	conditionalUpdateDest(content, destFile, modifyCallbackBeforeHash) {
		this.logger.debug(`Checking whether ${destFile} needs to be updated`)

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
			this.logger.debug(`Updating ${destFile} with new content ${content} `)
			fs.writeFileSync(destFile, content)
			return true;
		}

		this.logger.debug(`Not updating ${destFile} since it would be unchanged`)
		return false;
	}

	// -------------------------------------------------------------------
	// named.conf
	// -------------------------------------------------------------------

	generateNamedConf() {

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

	include "${this.bindConfLocalFileName()}"
};
`
		let changed = this.conditionalUpdateDest(namedConf, this.namedConfName());
		return { changed: changed };
	}

	// -------------------------------------------------------------------
	// DNSSEC keygen
	// -------------------------------------------------------------------

	getOrGenerateKey(spec) {
		let keyGen = new BindDnsSecKey({
			keyFileName: this.bindKeyFileName(spec),
			keyName: spec.domainName,
			logger: this.logger,
			dryrun: this.options.dryrun
		})

		let genResult = keyGen.getKey();

		return {
			changed: genResult.changed,
			keyFile: genResult.keyfilename,
			keyName: genResult.keyname,
			dnssecKey: genResult.secret,
			dnssecAlgorithm: genResult.algorithm
		};
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
		let config = `$ORIGIN.
	$TTL ${ spec.ttlSeconds}; 1 minute
	${spec.domainName} IN SOA	${spec.domainName}.${spec.adminContact} (
		${Math.round(Date.now() / 6000)}; serial
		${spec.refreshSeconds}; refresh(1 minute)
		${spec.retrySeconds}; retry(1 minute)
		${spec.expireSeconds}; expire(10 minutes)
		${spec.minimumSeconds}; minimum(1 minute)
	)
	NS	${spec.domainName}.
`
		// Write config to file
		let changed = this.conditionalUpdateDest(config, zoneFile,
			str => str.replace(/\s*(\d+)\s*\;\s*serial/gm, "__serial_number_was_here__"));

		return { "changed": changed };
	}

	// -------------------------------------------------------------------
	// named.conf.local
	// -------------------------------------------------------------------

	updateNamedConfLocal() {

		// Iterate all config files and generate include "filename"; configs
		let config = glob
			.sync(this.generatedFilesDir() + '*.conf')
			.map(el => `include "${el}";\n`)
			.sort()
			.reduce((a, b) => a + b, "")

		// Write changed config file only
		let changed = this.conditionalUpdateDest(config, this.bindConfLocalFileName());

		return { changed: changed }
	}

	async getZones() {
		// Iterate all config files and generate include "filename"; configs
		const configs = await globpromise(this.generatedFilesDir() + '*.conf')
		return configs.map(el => this.zoneNameFromBindConfigFileName(el))
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
		this.logger.debug("Starting to process zone", spec)

		this.validateZone(spec);
		this.ensureConfigPathsExist();

		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: isNewKey, keyFile, keyName, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(spec)
		let { changed: configChanged, zoneFile } = this.getOrCreateBindConfigFile(spec, keyName)
		let { changed: zoneFileChanged } = this.getOrCreateZoneFile(spec, zoneFile)
		let { changed: namedConfLocalChanged } = this.updateNamedConfLocal()

		let changed = isNewKey || configChanged || zoneFileChanged || namedConfChanged || namedConfLocalChanged;
		let status = { keyName, dnssecKey, dnssecAlgorithm }

		this.logger.debug(`Done processing zone `, spec, ` (changes: isNewKey: ${isNewKey} || configChanged: ${configChanged} || zoneFileChanged: ${zoneFileChanged} || namedConfChanged: ${namedConfChanged}  || namedConfLocalChanged: ${namedConfLocalChanged})`)

		if (changed) {
			this.logger.info(`Zone ${spec.domainName} has changed`)
			this.logger.debug(`Returning status object: ${JSON.stringify(status, null, 3)}`)
		}

		return { changed, status };
	}

	deleteZone(spec) {
		this.logger.debug(`Deleting zone`, spec)

		this.validateZone(spec);
		const filesToDelete = [this.bindKeyFileName(spec), this.bindConfigFileName(spec), this.bindZoneFileName(spec)]

		for (const f of filesToDelete) {
			this.logger.debug(`Deleting file for zone ${spec.domainName}`, f)
			fs.unlinkSync(f);
		}

		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: namedConfLocalChanged } = this.updateNamedConfLocal()
		let changed = namedConfChanged || namedConfLocalChanged;

		this.logger.debug(`Done deleting zone `, spec, ` (changes: namedConfChanged: ${namedConfChanged}  || namedConfLocalChanged: ${namedConfLocalChanged})`)

		if (changed)
			this.logger.info(`Config has changed`)

		return changed
	}

}
