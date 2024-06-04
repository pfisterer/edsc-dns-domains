const k8s = require('@kubernetes/client-node');
const { Resolver } = require('dns').promises;


module.exports = class UpstreamDnsUpdater {

    constructor(options) {
        this.log = options.logger("UpstreamDnsUpdater");
        this.resolver = new Resolver()

        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);

        this.namespace = options.namespace
        this.k8sServiceName = options.k8sServiceName
        this.upstreamDnsServer = options.upstreamDnsServer
        this.upstreamDnsRecordName = options.upstreamDnsRecordName
        this.upstreamDnsRecordType = options.upstreamDnsRecordType
    }

    async update() {
        const serviceIp = await this.getExternalIp(this.namespace, this.k8sServiceName)

        if (serviceIp) {
            const currentIp = await checkDnsRecord(this.upstreamDnsServer, this.upstreamDnsRecordName, this.upstreamDnsRecordType)

            if (currentIp !== serviceIp) {
                this.log.info(`DNS record needs update. Current IP is ${currentIp} on server ${this.upstreamDnsServer}, service IP: ${serviceIp}`)

                //update(this.upstreamDnsRecordName, this.upstreamDnsRecordType, serviceIp)

            } else {
                this.log.debug(`DNS record ${this.upstreamDnsRecordName} is already up to date`)
            }

        } else {
            this.log.warn(`No external IP found for ${this.namespace}/${this.k8sServiceName}`)
        }
    }

    async checkDnsRecord(dnsServer, lookupHost, recordType) {
        try {
            this.resolver.setServers([dnsServer])
            const result = await this.resolver.resolve(lookupHost, recordType);
            return result.address
        } catch (err) {
            this.log.error(`Error looking up ${lookupHost} (type: ${recordType}) on ${dnsServer}`, err)
            return null
        }
    }


    async getExternalIp(namespace, serviceName) {

        try {
            // Get the service object
            const res = await this.k8sApi.readNamespacedService(serviceName, namespace);
            const service = res.body;

            // Check if the service is of type LoadBalancer
            if (service.spec.type === 'LoadBalancer') {
                const loadBalancerIngress = service.status.loadBalancer.ingress;

                if (loadBalancerIngress && loadBalancerIngress.length > 0) {
                    // Return the first external IP address found
                    const externalIp = loadBalancerIngress[0].ip;
                    return externalIp;
                } else {
                    this.log.warn(`Service ${namespace}/${serviceName} has no external IP assigned yet.`)
                    return null;
                }
            } else {
                this.log.warn(`Service ${namespace}/${serviceName} is not of type LoadBalancer.`)
                return null;
            }
        } catch (err) {
            this.log.error(`Error fetching service ${namespace}/${serviceName}`, err)
            return null;
        }
    }

}
