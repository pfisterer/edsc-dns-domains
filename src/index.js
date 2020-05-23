const commandLineArgs = require('command-line-args')
const commandLineUsage = require('command-line-usage')
const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
var log4js = require('log4js')

//const Client = require('kubernetes-client').Client
//const config = require('kubernetes-client/backends/request').config

const CrdWatcher = require('./crd-watcher')
const BindConfigGen = require("./bind-config-gen")
const BindProcessRunner = require("./bind-process-runner");
const Reconciler = require("./reconciler");
const HealthEndpoint = require("./health-endpoint");
const dummyCrdGen = require('./dummy-crd-gen')
const GodaddyClient = require('kubernetes-client').Client

// ------------------------------------------------
// Parse command line options
// ------------------------------------------------

const cmdLineOpts = [
  { name: 'verbose', alias: 'v', type: Boolean, description: "Display verbose output" },
  { name: 'dryrun', type: Boolean, description: "Do not actually write configuration files" },
  { name: 'configdir', type: String, description: "The directory where to write the configuration to" },
  { name: 'crddef', type: String, description: "Path to custom resource defs(CRDs) to use" },
  { name: 'namespace', type: String, description: "Namespace to use" },
  { name: 'rndcconfgenpath', type: String, description: "Path to the rndc-confgen binary" },
  { name: 'bindbinary', type: String, description: "Path to named binary" },
  { name: 'bindextraargs', type: String, description: "Extra args to pass to the bind binary" },
  { name: 'healthendpoint', type: Number, description: "Start a k8s health endpoint on this port" },
  { name: 'help', alias: 'h', type: Boolean, description: "Print this help message" }
];

const usage = commandLineUsage([
  {
    header: 'Typical Example',
    content: 'node index.js --dryrun --verbose'
  },
  {
    header: 'Options',
    optionList: cmdLineOpts
  },/*
  {
    content: 'Project home: {underline https://github.com/me/example}'
  }*/
])

const options = Object.assign({}, {
  crddef: path.join(__dirname, "./crd-defs"),
  configdir: "/tmp",
  rndcconfgenpath: "/usr/sbin/rndc-confgen",
  bindbinary: "/usr/sbin/named",
  namespace: "default",
  healthendpoint: 7777
}, commandLineArgs(cmdLineOpts));


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
    logger
  })
}

async function startBindProcessRunner(options, logger) {
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

async function startCrdWatcher(options, bindConfigGen, bindProcessRunner, logger) {
  const crdFile = path.join(options.crddef, "dnssec-zone-crd-v1beta1.yaml");
  const crdWatcher = new CrdWatcher(logger, crdFile, options.namespace)

  async function addedOrModified(event) {
    const object = event.object
    let { changed, statusPatch } = bindConfigGen.addOrUpdateZone(object)

    if (changed) {
      bindProcessRunner.restart();
      await crdWatcher.setResourceStatus(event.meta, statusPatch)
    }
  }

  async function deleted(event) {
    const object = event.object
    logger.debug(`Deleting zone with object`, object)
    if (bindConfigGen.deleteZone(object))
      bindProcessRunner.restart();
  }

  crdWatcher.events.on('added', addedOrModified)
  crdWatcher.events.on('modified', addedOrModified)
  crdWatcher.events.on('deleted', deleted)

  await crdWatcher.start();

  return crdWatcher;
}

async function startReconciler(crdWatcher, bindConfigGen, bindProcessRunner, logger) {
  return new Reconciler(crdWatcher, bindConfigGen, bindProcessRunner, logger)
}


async function startDummyCrdGenerator(client, options, crdGroup, logger, interval) {
  dummyCrdGen({
    client,
    namespace: options.namespace,
    logger,
    crdGroup,
    interval
  })
}


async function main(options) {
  const logger = getLogger("main")
  logger.log("Starting main with options", options)

  const bindConfigGen = await startBindConfigGenerator(options, getLogger("BindConfigGen"))
  const bindProcessRunner = await startBindProcessRunner(options, getLogger("BindProcessRunner"))
  const healthEndpoint = await startHealthEndpoint(bindProcessRunner, options, getLogger("HealthEndpoint"))
  const crdWatcher = await startCrdWatcher(options, bindConfigGen, bindProcessRunner, getLogger("CrdWatcher"))
  const reconciler = await startReconciler(crdWatcher, bindConfigGen, bindProcessRunner, getLogger("Reconciler"));

  if (options.dryrun) {
    /*
    let interval = 15000
 
    const client = new GodaddyClient()
    await client.loadSpec()
 
    const crdFile = path.join(options.crddef, "dnssec-zone-crd-v1beta1.yaml");
    await client.addCustomResourceDefinition(yaml.safeLoad(fs.readFileSync(crdFile, "utf8")))
 
    await startDummyCrdGenerator(client, options, crdWatcher.crdGroup, getLogger("DummyCrdGenerator"), interval)
    */
  }

}

if (options.help) {
  console.log(usage)
  process.exit(0)

} else {

  (
    async () => await main(options)
  )();

}
