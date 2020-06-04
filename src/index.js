const path = require('path')
const fs = require('fs')
const log4js = require('log4js')
const { program: optionparser } = require('commander')

const CrdWatcher = require('./crd-watcher')
const BindConfigGen = require("./bind-config-gen")
const { Reconciler } = require("./reconciler");
const HealthEndpoint = require("./health-endpoint");
const dummyCrdGen = require('./dummy-crd-gen')

// ------------------------------------------------
// Parse command line options
// ------------------------------------------------

const options = optionparser
  .storeOptionsAsProperties(true)
  .option('-v, --verbose', "Display verbose output", false)
  .option('--dryrun', "Do not actually run bind", false)
  .option('--debug-create-crds <interval>', "Create random CRs for debugging", -1)
  .option('--configdir <path>', "The directory where to write the configuration to", "/tmp")
  .option('--crddef <path>', "Path to custom resource defs(CRDs) to use", path.join(__dirname, "./crd-defs"))
  .option('--namespace <namespace>', "Namespace to use", "default")
  .option('--rndcconfgenpath <path>', "Path to the rndc-confgen binary", "/usr/sbin/rndc-confgen")
  .option('--reconcile-interval <ms>', "Reconcile interval in millis", 10000)
  .option('--healthendpoint <port>', "Start a k8s health endpoint on this port", 7777)
  .version('0.0.3alpha')
  .addHelpCommand()
  .parse()
  .opts()

// ------------------------------------------------
// Set global log level options
// ------------------------------------------------

let logLevel = options.verbose ? "debug" : "info";

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

  //Create bind config generator
  const bindConfigGen = new BindConfigGen(Object.assign({}, { logger: getLogger }, options))

  //Create custom resource watcher
  const crdFile = path.join(options.crddef, "dnssec-zone-crd-v1beta1.yaml");
  const crdWatcher = new CrdWatcher(Object.assign({}, { crdFile, logger: getLogger }, options))
  await crdWatcher.start();

  //Create reconciler
  const reconciler = new Reconciler(Object.assign({}, {
    logger: getLogger,
    crdWatcher,
    bindConfigGen,
    bindRestartRequestCallback() {
      const restartFilename = path.join(options.configdir, "bind-restart.requested");
      logger.info(`Restarting bind requested, creating file ${restartFilename}`)
      fs.closeSync(fs.openSync(restartFilename, 'w'));
    }
  }, options))

  //Start health endpoint
  const healthEndpoint = new HealthEndpoint(Object.assign({}, { logger: getLogger }, options))
  healthEndpoint.start(options.healthendpoint)

  //Create random CRs
  if (options.debugCreateCrds > 0) {
    logger.info("Starting dummy generator")
    let interval = options.debugCreateCrds

    dummyCrdGen(crdWatcher.getCustomObjectsApi(), interval,
      crdWatcher.crdGroup, crdWatcher.crdVersions[0].name,
      options.namespace, crdWatcher.crdPlural, getLogger("dummyCrdGen"))
  }
}

// ------------------------------------------------
// Start main method
// ------------------------------------------------

(async () => main(options)
  .then(() => console.log("Main done"))
  .catch(e => { console.log("Error in main: ", e); process.exit(1) })
)();
