const { ResourceEventType } = require('@dot-i/k8s-operator');
const { spawnSync } = require('child_process');
const dns = require('dns').promises
const net = require('node:net')
const k8s = require('@kubernetes/client-node');
const randomWords = require('./util/randomwords.js')

class DnsUpdateReconciler {

    constructor(options) {
        this.logger = options.logger("DnsUpdateReconciler")
        this.options = options
        this.watcher = options.dnssecUpdateWatcher
        this.nsupdatePath = options.nsupdatepath
        this.resolver = new dns.Resolver()

        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
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
        this.logger.trace("reconcile: Reconciling all resources")
        for await (const item of await this.watcher.listItems()) {
            await this.handle(item, /* existing = */ true)
        }
        this.logger.trace("reconcile: Done reconciling all resources")
    }

    async handle(item, existing) {
        const action = existing ? "add" : "delete"
        const updateStrings = []

        this.logger.trace(`handle: Handling item ${item.metadata.name} with action ${action}`)

        // Check all records in the item
        for (const record of item.spec.records) {
            // Get expected values (if any)
            const expected = await this.getExpectedValues(record)
            if (!expected) {
                this.logger.warn(`handle: No expected values for record '${record.name}', skipping`)
                continue
            }

            // Check if record exists on DNS server
            if (! await this.lookupMatchesExpected(item.spec.dnsserver, expected)) {
                // Record doesn't exist, create nsupdate string
                updateStrings.push(await this.generateNsupdateString(action, record))
            }
        }

        if (updateStrings.length > 0) {
            // Create input string for nsupdate
            const inputString = [
                `server ${item.spec.dnsserver}`,
                ...updateStrings,
                `send`
            ].join("\n")

            // Create nsupdate command and arguments
            this.runNsupdate(`nsupdate`, ['-y', item.spec.keyString], inputString)
        }
    }

    async getExpectedValues(record) {
        const result = {
            name: record.name,
            expected: record.record ?
                [{ value: record.record.contents, type: record.record.type }]
                :
                await this.getServicePublicIps(record.service.name, record.service.namespace)
        }

        if (result.expected.length == 0) {
            this.logger.debug(`getExpectedValues: Service ${record.service.name} has no IP address`)
            return null
        }

        this.logger.trace(`getExpectedValues: Expected values for record ${record.name}:`, result)

        return result
    }

    async lookupMatchesExpected(dnsServer, expected) {
        // Make DNS server an IP address as required by dns.resolve4
        let usedDnsServer = dnsServer

        if (!net.isIP(usedDnsServer)) {
            usedDnsServer = (await dns.resolve4(usedDnsServer))[0]
            this.logger.trace(`lookupMatchesExpected: DNS server is not an IP, resolved ${dnsServer} to ${usedDnsServer}`)
        }

        // Check lookup result
        let anyMatch = false
        for (const entry of expected.expected) {
            const result = await this.dnsLookup(usedDnsServer, entry.type, expected.name)
            if (result == entry.value) {
                this.logger.trace(`lookupMatchesExpected: Found expected value '${entry.value}' for name '${expected.name}' (type: ${entry.type}) on dns server ${dnsServer} (${usedDnsServer})`)
                anyMatch = true
                break
            } else {
                this.logger.trace(`lookupMatchesExpected: Lookup ${result} != expected value '${entry.value}' for name '${expected.name}' (type: ${entry.type}) on dns server ${dnsServer} (${usedDnsServer})`)
            }

        }

        this.logger.trace(`lookupMatchesExpected: ${anyMatch ? "Got" : "Didn't find"} a matching DNS entry for name '${expected.name}'`)
        return anyMatch
    }

    async dnsLookup(dnsServer, recordType, name) {
        try {
            this.resolver.setServers([dnsServer])
            const result = await this.resolver.resolve(name, recordType);
            this.logger.trace(`dnsLookup: Resolved ${name} to rrtype ${recordType}: ${result}`)

            return result
        } catch (err) {
            this.logger.error(`dnsLookup: Unable to resolve ${name} of type ${recordType} on ${dnsServer}: ${err}`)
            return []
        }
    }

    async generateNsupdateString(action, record) {

        if (record.service) {
            const serviceIPs = await this.getServicePublicIps(record.service.name, record.service.namespace)

            return serviceIPs.map(ip => {
                return [`update ${action} ${record.name} ${record.ttl_seconds} IN ${ip.type} ${ip.value}`]
            })

        } else if (record.record) {
            return [`update ${action} ${record.name} ${record.ttl_seconds} IN ${record.record.type} ${record.record.contents}`]

        } else {
            throw new Error("No record or service found in record")
        }

    }

    async runNsupdate(cmd, args, inputString) {
        let success = false
        let errorMsg = ""

        // Run nsupdate and check for success
        if (this.options.dryrun) {
            this.logger.info(`Dryrun only, would run: ${cmd} ${args.join(" ")} with input: \n${inputString} `)
            success = true

        } else {
            this.logger.debug(`runNsupdate: Running ${cmd} ${args.join(" ")} with input: \n${inputString} `)
            const { status, stdout, stderr } = spawnSync(cmd, args, { input: inputString })
            this.logger.debug(`runNsupdate: exited with status ${status} and output: \n${stdout} \n${stderr} `)

            success = (status === 0)
            errorMsg = stderr
        }

        return { success, errorMsg }
    }

    async getServicePublicIps(name, namespace) {
        this.logger.trace(`getServicePublicIps: Looking up public IP for service ${name} in namespace ${namespace} `)

        const service = await this.k8sApi.readNamespacedService(name, namespace)

        let ipList = service?.body?.status?.loadBalancer?.ingress?.map(
            ingress => {
                return {
                    value: ingress.ip,
                    type: ingress.ip.includes('.') ? 'A' : 'AAAA'
                }
            }) ?? []

        this.logger.debug(`getServicePublicIps: Service ${namespace}/${name} has IPs:`, ipList)
        return ipList
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
                        "ttl_seconds": 60,
                        "record": {
                            "recordType": "A",
                            "contents": dummyIp
                        }
                    }
                ]

            }
        }

    }

}

module.exports = { DnsUpdateReconciler }
