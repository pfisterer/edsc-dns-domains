const path = require('path')
const fs = require('fs')
const log4js = require('log4js')
const { program: optionparser } = require('commander')

const CrdWatcher = require('./crd-watcher')
const BindConfigGen = require("./bind/bind-config-gen")
const { DnsZoneReconciler } = require("./reconciler-zone");
const { DnsUpdateReconciler } = require("./reconciler-dnsupdate");
const HealthEndpoint = require("./health-endpoint");
const dummyCrdGen = require('./dummy-crd-gen')

// ------------------------------------------------
// Parse command line options
// ------------------------------------------------

const options = optionparser
  .storeOptionsAsProperties(true)
  .option('--log-level <level>', "Set log level out of: fatal, error, warn, info, debug, trace", "debug")
  .option('--dryrun', "Do not actually run bind", false)
  .option('--debug-create-crds <intervalMs>', "Create random CRs for debugging", -1)
  .option('--configdir <path>', "The directory where to write the configuration to", "/tmp")
  .option('--vardir <path>', "The directory where to write the zone files to", "/tmp")
  .option('--crddef <path>', "Path to custom resource defs(CRDs) to use", path.join(__dirname, "./crd-defs"))
  .option('--namespace <namespace>', "Namespace to use", "default")
  .option('--nameserver1 <name1>', "The 1st external name of this nameserver", "ns1.example.com")
  .option('--nameserver2 <name1>', "The 2nd external name of this nameserver", undefined)
  .option('--bind-verbose-output', "Use verbose logging for Bind configuration", false)
  .option('--rndcconfgenpath <path>', "Path to the rndc-confgen binary", "/usr/sbin/rndc-confgen")
  .option('--nsupdatepath <path>', "Path to the nsupdate binary", "/usr/bin/nsupdate")
  .option('--reconcile-interval <ms>', "Reconcile interval in millis", 60 * 1000)
  .option('--healthendpoint <port>', "Start a k8s health endpoint on this port", 7777)
  .option('--run-reconcilers <list>', "Which reconcilers to start", "zone,update")

  //For updating an external upstream DNS server record to match the external IP of the k8s service
  .option('upstream-dns-server <server>', "The name/address of the upstream DNS server to use", "bama09.dhbw-mannheim.de")
  .option('upstream-dns-record-name <name>', "The record name to use", "cloud-ns.cloud-ns.dhbw-mannheim.de")
  .option('upstream-dns-record-type <rrtype>', "The record type to use", "A")
  .option('--k8s-service-name <name>', "The name of the k8s service to use", "bind-dnssec-config-service")

  //Dummy update options
  .option('--update-dummy-dnsserver <server>', "The DNS server to use for dummy updates", '1.1.1.1')
  .option('--update-dummy-tld <tld>', "The TLD to use ", 'example.com')
  .option('--update-dummy-keystring <tld>', "The key to use", 'xxxxx-invalid-xxxxxxxxx')

  //Version and help
  .version('0.0.7')
  .helpCommand()
  .parse()
  .opts()

// ------------------------------------------------
// Set global log level options
// ------------------------------------------------

let logLevel = options.logLevel;
let intervalRandomCR = options.debugCreateCrds

function getLogger(name) {
  let log = log4js.getLogger(name);
  log.level = logLevel;
  return log
}

// ------------------------------------------------
// Main
// ------------------------------------------------

async function main(options) {
  const logger = getLogger("main")
  logger.debug(`Starting with options`, options)

  const reconcilers = options.runReconcilers.split(",").map(r => r.trim())

  if (reconcilers.includes("zone")) {
    logger.info("Starting DNS Zone reconciler")

    //Create bind config generator
    const bindConfigGen = new BindConfigGen(Object.assign({}, { logger: getLogger }, options))

    //Create custom resource watcher for dnssec zones
    const crdFilesDnsssecZone = path.join(options.crddef, "dnssec-zone-crd-v1.yaml");
    const zoneWatcher = new CrdWatcher(Object.assign({}, { crdFile: crdFilesDnsssecZone, logger: getLogger }, options))
    await zoneWatcher.start()

    //Create DNS Zone reconciler
    const zoneReconciler = new DnsZoneReconciler(Object.assign({}, {
      logger: getLogger,
      dnssecZoneWatcher: zoneWatcher,
      bindConfigGen,
      bindRestartRequestCallback() {
        const restartFilename = path.join(options.configdir, "bind-restart.requested");
        logger.info(`Restarting bind requested, creating file ${restartFilename}`)
        fs.closeSync(fs.openSync(restartFilename, 'w'));
      }
    }, options))

    //Create random CRs
    if (intervalRandomCR > 0) {
      logger.info("Starting dummy generator")

      dummyCrdGen(zoneWatcher.getCustomObjectsApi(), intervalRandomCR,
        zoneWatcher.crdGroup, zoneWatcher.crdVersions[0].name,
        options.namespace, zoneWatcher.crdPlural,
        zoneReconciler.dummyDnsZoneGenerator,
        getLogger("dummyCrdGen"))
    }

  }

  //Create DNS Update reconciler
  if (reconcilers.includes("update")) {
    logger.info("Starting DNS Update reconciler")

    //Create custom resource watcher for dnssec updates
    const crdFilesDnsUpdate = path.join(options.crddef, "dnsupdate-crd-v1.yaml");
    const updateWatch = new CrdWatcher(Object.assign({}, { crdFile: crdFilesDnsUpdate, logger: getLogger }, options))
    await updateWatch.start();

    //Create DNS Update reconciler
    const dnsUpdateReconciler = new DnsUpdateReconciler(Object.assign({}, { logger: getLogger, dnssecUpdateWatcher: updateWatch, }, options))
    dnsUpdateReconciler.start()

    //Create random CRs
    if (intervalRandomCR > 0) {
      logger.info("Starting dummy generator for DNS updates")

      dummyCrdGen(updateWatch.getCustomObjectsApi(), intervalRandomCR,
        updateWatch.crdGroup, updateWatch.crdVersions[0].name,
        options.namespace, updateWatch.crdPlural,
        () => dnsUpdateReconciler.generateRandomDummyResource(),
        getLogger("dummyDnsUpdateGen"))
    }

  }

  //Start health endpoint
  const healthEndpoint = new HealthEndpoint(Object.assign({}, { logger: getLogger }, options))
  healthEndpoint.start(options.healthendpoint)
}

// ------------------------------------------------
// Start main method
// ------------------------------------------------

(async () => main(options)
  .catch(e => { console.log("Error in main: ", e); process.exit(1) })
)();
