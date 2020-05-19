const tmp = require('tmp');
const fs = require('fs');
const crypto = require('crypto');
const glob = require("glob")
const rmf = require('rimraf')
const BindDnsSecKey = require("../src/dnssec-bind-key")

tmp.setGracefulCleanup({ unsafeCleanup: true });

function logAndThrow(logger, err) {
	logger.error(err)
	throw { err: err };
}

module.exports = class BindConfigUpdater {

	constructor(options, logger) {
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
	bindKeyFileName(zone) {
		return this.generatedFilesDir() + zone.domainName + ".key";
	}
	bindConfigFileName(zone) {
		return this.generatedFilesDir() + zone.domainName + ".conf";
	}
	bindZoneFileName(zone) {
		return this.generatedFilesDir() + zone.domainName + ".db";
	}

	validateZone(zone) {
		//From https://regexr.com/3au3g
		const validDomainRegexp = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/gi;

		if (!zone.domainName.match(validDomainRegexp))
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

	getOrGenerateKey(zone) {
		let keyGen = new BindDnsSecKey({
			keyFileName: this.bindKeyFileName(zone),
			keyName: zone.domainName,
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
	// Config 
	// -------------------------------------------------------------------

	/*
		zone "demo.e.example.com" {
				type master;
				file "/var/cache/bind/db.demo.e.example.com";
				allow-update { key demo.e.example.com; };
		};
	*/
	getOrCreateBindConfigFile(zone, keyName) {
		let confFileName = this.bindConfigFileName(zone)
		let zoneFileName = this.bindZoneFileName(zone);

		let changed = this.conditionalUpdateDest(`zone "${zone.domainName}" {
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

	/* 
		$ORIGIN .
		$TTL 60	; 1 minute
		demo.e.example.com	IN SOA	demo.e.example.com. admin.example.com. (
						59         ; serial
						60         ; refresh (1 minute)
						60         ; retry (1 minute)
						600        ; expire (10 minutes)
						60         ; minimum (1 minute)
						)
					NS	e-ns.example.com.
	*/
	getOrCreateZoneFile(zone, zoneFile) {

		// Generate config contents
		let config = `$ORIGIN.
	$TTL ${ zone.ttlSeconds}; 1 minute
	${zone.domainName} IN SOA	${zone.domainName}.${zone.adminContact} (
		${Math.round(Date.now() / 6000)}; serial
	${zone.refreshSeconds}; refresh(1 minute)
	${zone.retrySeconds}; retry(1 minute)
	${zone.expireSeconds}; expire(10 minutes)
	${zone.minimumSeconds}; minimum(1 minute)
	)
	NS	${zone.domainName}.
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

	// -------------------------------------------------------------------
	// Update Object Status for K8S
	// -------------------------------------------------------------------

	updateCrdStatus(_currentStatus, keyName, dnssecKey, dnssecAlgorithm) {
		let currentStatus = _currentStatus || {}
		let statusPatch = {};
		let changed = false;

		if (currentStatus.keyName !== keyName) {
			this.logger.debug(`keyName has changed from ${currentStatus.keyName} to ${keyName}`)
			statusPatch.keyName = keyName
			changed = true
		}

		if (currentStatus.dnssecKey !== dnssecKey) {
			this.logger.debug(`dnssecKey has changed from ${currentStatus.dnssecKey} to ${dnssecKey}`)
			statusPatch.dnssecKey = dnssecKey
			changed = true
		}

		if (currentStatus.dnssecAlgorithm !== dnssecAlgorithm) {
			this.logger.debug(`dnssecAlgorithm has changed from ${currentStatus.dnssecAlgorithm} to ${dnssecAlgorithm}`)
			statusPatch.dnssecAlgorithm = dnssecAlgorithm
			changed = true
		}

		return { changed, statusPatch };
	}

	// -------------------------------------------------------------------
	// Main management functionality
	// -------------------------------------------------------------------


	/*
		zone:
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
	addOrUpdateZone(object) {
		let zone = object.spec;
		this.logger.debug("Starting to process zone", zone)

		this.validateZone(zone);
		this.ensureConfigPathsExist();

		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: isNewKey, keyFile, keyName, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(zone)
		let { changed: configChanged, zoneFile } = this.getOrCreateBindConfigFile(zone, keyName)
		let { changed: zoneFileChanged } = this.getOrCreateZoneFile(zone, zoneFile)
		let { changed: namedConfLocalChanged } = this.updateNamedConfLocal()
		let { changed: crdStatusChanged, statusPatch } = this.updateCrdStatus(object, keyName, dnssecKey, dnssecAlgorithm)

		let changed = isNewKey || configChanged || zoneFileChanged || namedConfChanged || namedConfLocalChanged || crdStatusChanged;

		this.logger.debug(`Done processing zone `, zone, ` (changes: isNewKey: ${isNewKey} || configChanged: ${configChanged} || zoneFileChanged: ${zoneFileChanged} || namedConfChanged: ${namedConfChanged}  || namedConfLocalChanged: ${namedConfLocalChanged}) || crdStatusChanged: ${crdStatusChanged}`)

		if (changed) {
			this.logger.info(`Zone ${zone.domainName} has changed`)
			this.logger.debug(`Returning status patch object: ${JSON.stringify(statusPatch, null, 3)}`)
		}

		return { changed, statusPatch };
	}

	deleteZone(object) {
		let zone = object.spec
		this.logger.debug(`Deleting zone ${zone}`)

		this.validateZone(zone);
		fs.unlinkSync(this.bindKeyFileName(zone));
		fs.unlinkSync(this.bindConfigFileName(zone));
		fs.unlinkSync(this.bindZoneFileName(zone));

		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: namedConfLocalChanged } = this.updateNamedConfLocal()
		let changed = namedConfChanged || namedConfLocalChanged;

		this.logger.debug(`Done deleting zone `, zone, ` (changes: namedConfChanged: ${namedConfChanged}  || namedConfLocalChanged: ${namedConfLocalChanged})`)

		if (changed)
			this.logger.info(`Config has changed`)

		return changed
	}

}