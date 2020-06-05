const isValidDomain = require('is-valid-domain')

module.exports = class BindZone {
	/*
	zone "e.farberg.de" {
		  type master;
		  file "/var/cache/bind/db.e.farberg.de";
	};
	
	cat /var/cache/bind/db.e.farberg.de
	$ORIGIN .
	$TTL 60	; 1 minute
	e.farberg.de		IN SOA	e.farberg.de. admin.farberg.de. (113 60 60 600 60)
		NS	e-ns.farberg.de.
	
	--------------------------------------------
	
	zone "sturm.e.farberg.de" {
		  type master;
		  file "/var/cache/bind/db.sturm.e.farberg.de";
		  allow-update { key sturm.e.farberg.de; };
	};
	
	$ORIGIN .
	$TTL 60	; 1 minute
	sturm.e.farberg.de	IN SOA	sturm.e.farberg.de. admin.farberg.de. (113 60 60 600 60)
		NS	e-ns.farberg.de.
	 */
	constructor(spec, options) {
		this.spec = spec;
		this.options = options
		this.logger = options.logger("BindZone")
	}

	getSpec() {
		return this.spec
	}

	getBindZoneSpec({ zoneFileName, keyName }) {

		let config = [
			`zone "${this.spec.domainName}" {`,
			`	type master; `,
			`	file "${zoneFileName}";`,
			keyName ? `	allow-update { key ${keyName}; };` : `allow-update { none; };`,
			`}; `
		].join("\n")


		return config
	}

	getZoneFile(extraResourceRecords) {

		//Generate configuration
		let serialNo = Math.round(Date.now() / 6000)
		let config = [
			// The zone's name is used as the $ORIGIN directive's value by default.
			// $ORIGIN directive is unnecessary if you name the zone in /etc/named.conf the same as the value you would assign to $ORIGIN.
			//`$ORIGIN ${ spec.domainName } `
			`$TTL ${this.spec.ttlSeconds} `,
			// The @symbol places the $ORIGIN directive(or the zone's name, if the $ORIGIN directive is not set) as the namespace being defined by this SOA resource record.
			// @ IN SOA <primary-name-server> <hostmaster-email> (<serial-number> <time-to-refresh> <time-to-retry> <time-to-expire> <minimum-TTL> )
			`@IN SOA ${this.options.nameserver1}. ${this.spec.adminContact}. (${serialNo} ${this.spec.refreshSeconds} ${this.spec.retrySeconds} ${this.spec.expireSeconds} ${this.spec.minimumSeconds})`,
			`IN NS	${this.options.nameserver1}.`,
			this.options.nameserver2 ? `IN NS	${this.options.nameserver2}.` : "; no 2nd ns specified",
			extraResourceRecords ? extraResourceRecords : "; no extra RRs specified "
		].join("\n")

		return config
	}

	validate() {
		for (let result of [this.validateDomainName(this.spec.domainName), this.validateOptions(this.options), this.validateSpec(this.spec)])
			if (!result.valid)
				return result;

		return { valid: true }
	}

	validateDomainName() {
		if (!this.spec.domainName || !this.validateString(this.spec.domainName) || !isValidDomain(this.spec.domainName))
			return { valid: false, error: `Invalid string field 'domainName' = ${this.spec.domainName}` };

		return { valid: true }
	}

	validateOptions() {
		if (!this.validateString(this.options.nameserver1) || !isValidDomain(this.options.nameserver1))
			return { valid: false, error: `Invalid nameserver1 option: ${this.options.nameserver1}` };

		return { valid: true }
	}

	validateSpec() {
		//Validate string fields
		for (const field of ["adminContact"])
			if (!this.validateString(this.spec[field]))
				return { valid: false, error: `Invalid string field ${field} of ${this.spec.domainName}: ${this.spec[field]} in spec ${JSON.stringify(this.spec)}` }

		//Validate int fields
		for (const field of ["ttlSeconds", "refreshSeconds", "retrySeconds", "expireSeconds", "minimumSeconds"])
			if (!this.validateNonNegInt(this.spec[field]))
				return { valid: false, error: `Invalid int field ${field} of ${this.spec.domainName}: ${this.spec[field]} in spec ${JSON.stringify(this.spec)}` }

		return { valid: true }
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

}