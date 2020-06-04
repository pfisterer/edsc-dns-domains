const path = require('path')
var log4js = require('log4js')
const { program: optionparser } = require('commander')

const CrdWatcher = require('./crd-watcher')
const BindConfigGen = require("./bind-config-gen")
const BindProcessRunner = require("./bind-process-runner");
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
  .option('--bindbinary <path>', "Path to named binary", "/usr/sbin/named")
  .option('--bindextraargs <extragargs>', "Extra args to pass to the bind binary", [])
  .option('--reconcile-interval <ms>', "Reconcile interval in millis", 10000)
  .option('--healthendpoint <port>', "Start a k8s health endpoint on this port", 7777)
  .version('0.0.2pre-alpha')
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
// Setup functions
// ------------------------------------------------

async function startHealthEndpoint(bindProcessRunner, options, logger) {
  const health = new HealthEndpoint(bindProcessRunner, logger)
  health.start(options.healthendpoint)
  return health;
}

async function startBindConfigGenerator(options, logger) {
  return new BindConfigGen({
    configdir: options.configdir,
    dryrun: options.dryrun,
    rndcConfgenPath: options.rndcconfgenpath,
    logger
  })
}

async function startBindProcessRunner(options, logger) {
  if (typeof options.bindextraargs === "string") {
    options.bindextraargs = options.bindextraargs.split(" ")
  }

  let bindProcessRunner = new BindProcessRunner({
    bindbinary: options.bindbinary,
    configdir: options.configdir,
    bindextraargs: options.bindextraargs,
    dryrun: options.dryrun,
    logger
  })

  bindProcessRunner.restart();
  return bindProcessRunner
}

async function startCrdWatcher(options, logger) {
  const crdFile = path.join(options.crddef, "dnssec-zone-crd-v1beta1.yaml");
  const crdWatcher = new CrdWatcher(logger, crdFile, options.namespace)
  await crdWatcher.start();

  return crdWatcher;
}

async function startReconciler(crdWatcher, bindConfigGen, bindProcessRunner, reconcileInterval, logger) {
  return new Reconciler(crdWatcher, bindConfigGen, bindProcessRunner, reconcileInterval, logger)
}


async function main(options) {
  const logger = getLogger("main")
  logger.debug(`Starting with options`, options)

  const bindConfigGen = await startBindConfigGenerator(options, getLogger("BindConfigGen"))
  const bindProcessRunner = await startBindProcessRunner(options, getLogger("BindProcessRunner"))
  const crdWatcher = await startCrdWatcher(options, getLogger("CrdWatcher"))
  const reconciler = await startReconciler(crdWatcher, bindConfigGen, bindProcessRunner, options.reconcileInterval, getLogger("Reconciler"));
  const healthEndpoint = await startHealthEndpoint(bindProcessRunner, options, getLogger("HealthEndpoint"))

  if (options.debugCreateCrds > 0) {
    logger.info("Starting dummy generator")
    let interval = options.debugCreateCrds

    dummyCrdGen(crdWatcher.getCustomObjectsApi(), interval,
      crdWatcher.crdGroup, crdWatcher.crdVersions[0].name,
      options.namespace, crdWatcher.crdPlural, getLogger("dummyCrdGen"))
  }

}

// Start main method
(async () => main(options)
  .then(() => console.log("Main done"))
  .catch(e => { console.log("Error in main: ", e); process.exit(1) })
)();
