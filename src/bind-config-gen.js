const tmp = require('tmp');
const fs = require('fs');
const crypto = require('crypto');
const glob = require("glob")
const rmf = require('rimraf')

tmp.setGracefulCleanup({ unsafeCleanup: true });

function logAndThrow(logger, err) {
	logger.error(err)
	throw { err: err };
}

module.exports = class BindConfigUpdater {

	constructor(configDir, dnssecBinaryCallback, logger) {
		this.configDir = configDir
		this.dnssecBinaryCallback = dnssecBinaryCallback
		this.logger = logger
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
	keyFileName(zone) {
		return this.generatedFilesDir() + zone.domainName + ".private"
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

	generateKey(zone) {
		// Make sure that the config path exists
		this.ensureConfigPathsExist();

		// Determine destination file
		let filename = this.keyFileName(zone);
		this.logger.debug(`Generating key for zone ${zone.domainName} in file ${filename} `)

		// Generate dnssec command to execute and generate temp folder
		var tmpDir = tmp.dirSync({ mode: 0o750, prefix: 'keygen_' });
		let generatedFileName = this.dnssecBinaryCallback(`-a HMAC-SHA512 -b 512 -r /dev/urandom -n USER '${zone.domainName}'`, tmpDir)

		// Copy the generated file to the destination
		this.logger.debug(`Copying generated file ${generatedFileName} to ${filename} `)
		fs.copyFileSync(generatedFileName, filename);

		this.logger.debug(`A new key for zone ${zone.domainName} has been created in ${filename} `)

		// Cleanup
		rmf.sync(tmpDir.name)
		tmpDir.removeCallback()
	}

	getOrGenerateKey(zone) {
		//e.g., 'Key: vNC49fpSpYTmiQ=='
		const keyMatchRegexp = /^Key\: (.+)$/gm
		//e.g., 'Algorithm: 165 (HMAC_SHA512)'
		const algorithmMatchRegexp = /^Algorithm\: \d+ \((.+)\)$/gm

		let filename = this.keyFileName(zone);
		let changed = false;

		// Make sure that the config path exists
		this.ensureConfigPathsExist();

		if (fs.existsSync(filename)) {
			this.logger.debug(`There is an existing key for zone ${zone.domainName} in ${filename} `)
		} else {
			this.logger.debug(`No existing key for zone ${zone.domainName} -> creating it`)
			this.generateKey(zone);
			changed = true
		}

		let privateKeyFileContents = fs.readFileSync(filename, "utf-8");
		let result = { "changed": changed, "filename": filename };

		//Extract key and algorithm from private key file
		let keyMatch = keyMatchRegexp.exec(privateKeyFileContents)
		let algorithmMatch = algorithmMatchRegexp.exec(privateKeyFileContents)

		this.logger.debug("keyMatchRegexp: Regexp = ", keyMatchRegexp, ", contents = ", privateKeyFileContents, ", result = ", keyMatch)
		this.logger.debug("algorithmMatch: Regexp = ", algorithmMatch, ", contents = ", privateKeyFileContents, ", result = ", algorithmMatch)


		if (!keyMatch || !algorithmMatch || !algorithmMatch[1] || !keyMatch[1]) {
			let err = `Unable to parse key and algorithm for zone ${zone.domainName} from keyfile ${filename}, keyMatch = ${keyMatch}, algorithmMatch = ${algorithmMatch}, content = ${privateKeyFileContents}`;
			logAndThrow(this.logger, err);
		}

		result.dnssecKey = keyMatch[1]
		result.dnssecAlgorithm = algorithmMatch[1]
		this.logger.debug(`Key and algorithm for zone ${zone.domainName} successfully loaded, returning`, result)

		return result;
	}

	// -------------------------------------------------------------------
	// Key file for Bind
	// -------------------------------------------------------------------

	/* 1.) Create a configuration file like this:
			key demo.e.example.com {
				algorithm HMAC-SHA512;
				secret "gO8NEPmThT...2XMIMwA==";
			};

		2.) Verify if a file exists and whether they are identical

		3.) Update the config if the new file differs
	*/
	getOrCreateKeyFile(zone, dnssecKey, dnssecAlgorithm) {
		let destinationKeyFile = this.bindKeyFileName(zone);
		let keyName = zone.domainName

		// Make sure that the config path exists
		this.ensureConfigPathsExist();

		let changed = this.conditionalUpdateDest(`key ${keyName} {
	algorithm ${dnssecAlgorithm};
	secret "${dnssecKey}";
};
`, destinationKeyFile);

		return { "changed": changed, "keyFile": destinationKeyFile, "keyName": keyName };
	}

	// -------------------------------------------------------------------
	// Config 
	// -------------------------------------------------------------------

	/* 1.) Create a configuration file like this:

			zone "demo.e.example.com" {
					type master;
					file "/var/cache/bind/db.demo.e.example.com";
					allow-update { key demo.e.example.com; };
			};

		2.) Verify if a file exists and whether they are identical

		3.) Update the config if the new file differs
	*/
	getOrCreateBindConfigFile(zone, keyName) {
		let confFileName = this.bindConfigFileName(zone)
		let zoneFileName = this.bindZoneFileName(zone);

		// Make sure that the config path exists
		this.ensureConfigPathsExist();

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
		// Make sure that the config path exists
		this.ensureConfigPathsExist();

		// Generate config contents
		let config = `$ORIGIN.
	$TTL ${ zone.ttlSeconds}; 1 minute
	${ zone.domainName} IN SOA	${zone.domainName}.${zone.adminContact} (
		${ Math.round(Date.now() / 6000)}; serial
	${ zone.refreshSeconds}; refresh(1 minute)
	${ zone.retrySeconds}; retry(1 minute)
	${ zone.expireSeconds}; expire(10 minutes)
	${ zone.minimumSeconds}; minimum(1 minute)
	)
	NS	${ zone.domainName}.
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
		// Make sure that the config path exists
		this.ensureConfigPathsExist();

		// Iterate all config files and generate include "filename"; configs
		let config = glob
			.sync(this.generatedFilesDir() + '*.conf')
			.map(el => `include "${el}";\n`)
			.sort()
			.reduce((a, b) => a + b)

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
		let { changed: namedConfChanged } = this.generateNamedConf()
		let { changed: isNewKey, dnssecKey, dnssecAlgorithm } = this.getOrGenerateKey(zone)
		let { changed: keyFileChanged, keyName } = this.getOrCreateKeyFile(zone, dnssecKey, dnssecAlgorithm)
		let { changed: configChanged, zoneFile } = this.getOrCreateBindConfigFile(zone, keyName)
		let { changed: zoneFileChanged } = this.getOrCreateZoneFile(zone, zoneFile)
		let { changed: namedConfLocalChanged } = this.updateNamedConfLocal()
		let { changed: crdStatusChanged, statusPatch } = this.updateCrdStatus(object, keyName, dnssecKey, dnssecAlgorithm)

		let changed = isNewKey || keyFileChanged || configChanged || zoneFileChanged || namedConfChanged || namedConfLocalChanged || crdStatusChanged;

		this.logger.debug(`Done processing zone `, zone, ` (changes: isNewKey: ${isNewKey} || keyFileChanged: ${keyFileChanged} || configChanged: ${configChanged} || zoneFileChanged: ${zoneFileChanged} || namedConfChanged: ${namedConfChanged}  || namedConfLocalChanged: ${namedConfLocalChanged}) || crdStatusChanged: ${crdStatusChanged}`)

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
		fs.unlinkSync(this.keyFileName(zone))
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