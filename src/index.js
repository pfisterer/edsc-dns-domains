const commandLineArgs = require('command-line-args')
const commandLineUsage = require('command-line-usage')
const path = require('path')
const fs = require('fs')
const Express = require('express')
const yaml = require('js-yaml')
var log4js = require('log4js')

const Client = require('kubernetes-client').Client
//const config = require('kubernetes-client/backends/request').config

const CrdWatcher = require('./crd-watcher')
const BindConfigGen = require("./bind-config-gen")
const BindProcessRunner = require("./bind-process-runner");
const dummyCrdGen = require('./dummy-crd-gen')

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

const logger = getLogger("index")

function startHealth(port) {
  logger.info(`Starting health endpoint on port ${port}`)

  const app = Express();
  app.get('/', (req, res) => {
    res.status(200).send(`<html>
      <body>
        <a href="/health/liveness">liveness</a><br>
        <a href="/health/readiness">readiness</a>
      </body>
    </html>`);
  });

  app.get('/health/liveness', (req, res) => {
    logger.debug("Health check");
    res.status(200).send("OK");
  });

  app.get('/health/readiness', (req, res) => {
    logger.debug("Readiness check");
    if (bindProcessRunner.ready())
      res.status(200).send("OK");
    else
      res.status(500).send("Internal Server Error");
  });

  app.listen(port)
}

function loadYaml(pathname, filename) {
  const p = path.join(pathname, filename);
  return yaml.safeLoad(fs.readFileSync(p, "utf8"))
}

async function main(options) {
  logger.log("Starting main with options", options)
  const client = new Client(/*{ config: config.fromKubeconfig(), version: '1.13' }*/)

  // Create watcher on k8s resources
  const dnsSecZoneCrd = loadYaml(options.crddef, "dnssec-zone-crd-v1.yaml");
  const dnsSecZoneCrdWatcher = new CrdWatcher(client, dnsSecZoneCrd, options.namespace, getLogger("dnssec-zone-crd"))
  await dnsSecZoneCrdWatcher.start();

  // Create bind config generator
  let bindConfigGen = new BindConfigGen({
    configdir: options.configdir,
    dryrun: options.dryrun,
    logger: getLogger("BindConfigGen")
  })

  let bindProcessRunner = new BindProcessRunner({
    bindbinary: options.bindbinary,
    configdir: options.configdir,
    bindextraargs: options.bindextraargs,
    dryrun: options.dryrun,
    logger: getLogger("BindProcessRunner")
  })

  bindProcessRunner.restart();

  function addedOrModified(object) {
    let { changed, statusPatch } = bindConfigGen.addOrUpdateZone(object)

    if (changed) {
      bindProcessRunner.restart();
      dnsSecZoneCrdWatcher.updateStatus(object, statusPatch)
    }
  }

  dnsSecZoneCrdWatcher.on('added', addedOrModified)
  dnsSecZoneCrdWatcher.on('modified', addedOrModified)
  dnsSecZoneCrdWatcher.on('deleted', object => {
    logger.debug(`Deleting zone with object`, object)
    if (bindConfigGen.deleteZone(object))
      bindProcessRunner.restart();
  })

  // Start dummy crd generator
  if (options.dryrun) {
    dummyCrdGen({
      client: client,
      namespace: options.namespace,
      logger: getLogger("DummyCrdGen"),
      crdGroup: dnsSecZoneCrd.spec.group,
      interval: 5000
    })

  }

  //Start readiness and liveness probes for kubernetes
  if (options.healthendpoint) {
    startHealth(options.healthendpoint)
  }
}

if (options.help) {
  console.log(usage)
  process.exit(0)

} else {
  main(options)
    .then(() => { logger.debug("Main method returned, exiting.") })
    .catch(e => { logger.error("Exception in main method:", e) })
}
