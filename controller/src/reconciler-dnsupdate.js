const { ResourceEventType } = require('@dot-i/k8s-operator');
const { spawnSync } = require('child_process');
const dns = require('dns').promises
const randomWords = require('./randomwords.js')

class DnsUpdateReconciler {

    constructor(options) {
        this.logger = options.logger("DnsUpdateReconciler")
        this.options = options
        this.watcher = options.dnssecUpdateWatcher
        this.nsupdatePath = options.nsupdatepath
    }

    start() {
        this.logger.debug("start: Starting DnsUpdateReconciler reconciler")
        this.stop()

        this.watcher.events.on(ResourceEventType.Added, async (event) => await this.handle(event.object, /* existing = */ true))
        this.watcher.events.on(ResourceEventType.Modified, async (event) => await this.handle(event.object, /* existing = */ true))
        this.watcher.events.on(ResourceEventType.Deleted, async (event) => await this.handle(event.object, /* existing = */ false))

        this.intervalId = setInterval(() => this.reconcile(), this.options.reconcileInterval)
    }

    stop() {
        if (this.intervalId) {
            this.logger.debug("stop: Stopping DnsUpdateReconciler reconciler")

            clearInterval(this.intervalId)
            this.intervalId = null
        }
    }

    async reconcile() {
        this.logger.debug("reconcile: Reconciling all resources")
        for await (const item of await this.watcher.listItems()) {
            await this.handle(item, /*existing =*/ true)
        }
        this.logger.debug("reconcile: Done reconciling all resources")
    }

    async handle(item, existing) {
        this.logger.debug(`handle: ${existing ? "checking existing" : "deleting"} resource '${item.metadata.name}'`)
        let nsupdateRequired = false || (existing == false)

        if (existing) {
            const dnsUpToDate = await this.itemDnsLookupExists(item)
            nsupdateRequired = !dnsUpToDate
        }

        if (nsupdateRequired) {
            const action = existing ? "add" : "delete"

            this.logger.info(`handle: Performing DNS update (action: ${action}) for resource '${item.metadata.name}'`)
            await this.runNsupdate(item.spec.dnsserver, action, item.spec.records, item.spec.keystring)
        } else {
            this.logger.debug(`handle: No action update required for resource '${item.metadata.name}'`)
        }
    }

    async itemDnsLookupExists(item) {
        this.logger.debug(`itemDnsLookupExists: Checking DNS lookup for resource '${item.metadata.name}'`)

        for (const record of item.spec.records) {
            const result = await this.lookupExists(item.spec.dnsserver, record)
            if (result) {
                this.logger.debug(`itemDnsLookupExists: DNS lookup exists for resource '${item.metadata.name}'`)
                return true
            }
        }

        this.logger.debug(`itemDnsLookupExists: DNS lookup does not exist for resource '${item.metadata.name}'`)
        return false
    }

    async lookupExists(dnsServer, record) {
        const expected = record.contents

        for (const r of await this.dnsLookup(dnsServer, record.recordType, record.name)) {
            if (r.includes(expected)) {
                this.logger.debug(`lookupExists: Found '${expected}' in ${r} (type: ${record.recordType}) on ${dnsServer} `)
                return true
            }
        }

        this.logger.debug(`lookupExists: Didn't find '${expected} ' in ${record.name}, type: ${record.recordType}) on DNS server ${dnsServer}`)
        return false
    }

    async dnsLookup(dnsServer, recordType, name) {
        try {
            dns.setServers([dnsServer])
            return await dns.resolve(name, recordType)
        } catch (err) {
            this.logger.error(`dnsLookup: Unable to resolve ${name} of type ${recordType} on ${dnsServer}: ${err}`)
            return []
        }
    }

    async runNsupdate(dnsServer, action, records, keyString) {
        let success = false
        let errorMsg = ""

        // Create input string for nsupdate
        const inputString = [
            `server ${dnsServer}`,
            ...records.map(r => `update ${action} ${r.name} ${r.ttl_seconds} IN ${r.recordType} ${r.contents}`),
            `send`
        ].join("\n")

        // Create nsupdate command and arguments
        const cmd = `nsupdate`
        const args = ['-y', keyString]

        // Run nsupdate and check for success
        if (this.options.dryrun) {
            this.logger.info(`Dryrun only, would run: ${cmd} ${args.join(" ")} with input:\n${inputString}`)
            success = true

        } else {
            this.logger.debug(`runNsupdate: Running ${cmd} ${args.join(" ")} with input:\n${inputString}`)
            const { status, stdout, stderr } = spawnSync(cmd, args, { input: inputString })
            this.logger.debug(`runNsupdate: exited with status ${status} and output:\n${stdout}\n${stderr}`)

            success = (status === 0)
            errorMsg = stderr
        }

        return { success, errorMsg }
    }


    generateRandomDummyResource() {
        const dnsServer = this.options.updateDummyDnsserver
        const tld = this.options.updateDummyTld

        const resourceName = randomWords(2).join('.')
        const domain = `${randomWords(1)[0]}.${tld}.`
        const keyString = this.options.updateDummyKeystring

        const randNr = () => Math.floor(Math.random() * 255) + 1
        const dummyIp = `10.10.${randNr()}.${randNr()}`

        return {
            "apiVersion": "dnsseczone.farberg.de/v1",
            "kind": "DnsUpdate",
            "metadata": { "name": resourceName },
            "spec": {
                "dnsserver": dnsServer,
                "keystring": keyString,
                "records": [
                    {
                        "name": domain,
                        "recordType": "A",
                        "contents": dummyIp
                    }
                ]

            }
        }

    }

}

module.exports = { DnsUpdateReconciler }
