const BindZone = require('../src/bind/bind-zone.js')
const log4js = require('log4js')

function getLogger(name) {
	let log = log4js.getLogger(name);
	log.level = "debug";
	return log
}

spec = {
	domainName: "demo.a.b.c.de",
	adminContact: "me.example.com",
	ttlSeconds: 1,
	refreshSeconds: 2,
	retrySeconds: 3,
	expireSeconds: 4,
	minimumSeconds: 5
}

options = {
	logger: getLogger,
	nameserver1: "ns1.example.com",
	nameserver2: "ns2.example.com"
}

const zone = new BindZone(spec, options)

console.log("Zone validation result = ", zone.validate())

console.log("Zone spec:", zone.getBindZoneSpec({ zoneFileName: "/tmp/zone-spec.conf", keyName: "my-key" }))

console.log("Zone file:", zone.getZoneFile())

console.log("Extra RRs:", zone.getZoneFile(`bla IN NS ${options.nameserver1}.
blubb IN NS ${options.nameserver1}.`))