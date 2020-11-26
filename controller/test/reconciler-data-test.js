const { ReconcilerData } = require("../src/reconciler");
var log4js = require('log4js')

function getLogger(name) {
	let log = log4js.getLogger(name);
	log.level = "debug";
	return log
}

const logger = getLogger("test-main")

function testReconcilerData() {
	const cr1 = { "spec": { "domainName": "domain1.de" } }
	const cr2 = { "spec": { "domainName": "newDomain.de" } }

	const customRessources1 = [cr1]
	const customRessources2 = [cr1, cr2]

	const zones1 = ["domain1.de"]
	const zones2 = ["domain1.de", "obsoleteDomain.de"]

	const data1 = new ReconcilerData(customRessources1, zones1, getLogger("ReconcilerData1"))
	const data2 = new ReconcilerData(customRessources2, zones2, getLogger("ReconcilerData2"))

	logger.info("Data1: disposableZones = ", data1.getDispensableZoneDomainNames(), "missingZones =", data1.getMissingZoneDomainNames())
	logger.info("Data2: disposableZones = ", data2.getDispensableZoneDomainNames(), "missingZones =", data2.getMissingZoneDomainNames())
}

function testUpstreamDelegationZones() {
	const names = ["a.b.c.de", "edsc.cloud", "farberg.de", "sturm.e.farberg.de", "e.farberg.de"]
	const crs = names.map(e => { return { "spec": { "domainName": e } } })
	const zones = ["domain1.de", "obsoleteDomain.de"]

	const data = new ReconcilerData(crs, zones, getLogger("UpstreamDelegationZones"))

	logger.info(data.getUpstreamDelegationZones())

}

//testReconcilerData()
testUpstreamDelegationZones()