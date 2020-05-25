const { ReconcilerData } = require("../src/reconciler");
var log4js = require('log4js')

function getLogger(name) {
	let log = log4js.getLogger(name);
	log.level = "debug";
	return log
}

const logger = getLogger("test-main")

const customRessources1 = ["domain1"]
const customRessources2 = ["domain1", "newDomain"]

const zones1 = ["domain1"]
const zones2 = ["domain1", "obsoleteDomain"]

const data1 = new ReconcilerData(customRessources1, zones1, getLogger("ReconcilerData1"))
const data2 = new ReconcilerData(customRessources2, zones2, getLogger("ReconcilerData2"))

logger.info("Data1: disposableZones = ", data1.getDispensableZones(), "missingZones =", data1.getMissingZones())
logger.info("Data2: disposableZones = ", data2.getDispensableZones(), "missingZones =", data2.getMissingZones())
