# Bind9 Config Creator for Kubernetes' external-dns

This project allows to reconfigure a [Bind9](https://www.isc.org/bind/) DNS server running in [Kubernetes](https://kubernetes.io/) dynamically using [Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/). 

Using Kubernetes, [external-dns](https://github.com/kubernetes-sigs/external-dns) can be used to configure external DNS servers for Kubernetes Ingresses and Services. It supports, amongst many others, "Dynamic Updates in the Domain Name System" (DNS UPDATE, cf. [RFC 2136](https://tools.ietf.org/html/rfc2136)). Bind9 is able to provide a RFC 2136 DNS server that allows external-dns to update a certain DNS zone automatically. However, manually editing Bind9 config files for many users quickly becomes tedious. This is where this project supports you. 

This project supports configuring (and running) a Bind9 server by adding/removing/modifying custom resources in Kubernetes. It creates the required configuration files and key material and attaches this information to the status of the individual custom resources.

## Example 
Define a zone (`someusername.user.cloud.dhbw-mannheim.de`) and apply it using `kubectl apply -f filename.yaml`:

```yaml
apiVersion: dnsseczone.farberg.de/v1
kind: DnssecZone
metadata:
  name: some-name
  namespace: default
spec:
  domainName: someusername.user.cloud.dhbw-mannheim.de
  adminContact: admin.someusername.user.cloud.dhbw-mannheim.de
  expireSeconds: 60
  minimumSeconds: 60
  refreshSeconds: 60
  retrySeconds: 60
  ttlSeconds: 60
  associatedPrincipals:
    - test
    - blablubb
```

The controller creates Bind9 config files and key material. It then adds data required to configure external-dns in the status of the custom resource:

```yaml
apiVersion: dnsseczone.farberg.de/v1
kind: DnssecZone
metadata:
  name: some-name
  namespace: default
spec:
  domainName: someusername.user.cloud.dhbw-mannheim.de
  adminContact: admin.someusername.user.cloud.dhbw-mannheim.de
  expireSeconds: 60
  minimumSeconds: 60
  refreshSeconds: 60
  retrySeconds: 60
  ttlSeconds: 60
  associatedPrincipals:
    - test
    - blablubb
status:
  dnssecAlgorithm: hmac-sha512
  dnssecKey: +bGKiHE6E8FP3fif/OD+mwqte6WCdYCdTN5Ur+RrTHSRlk7sRd/p1FCbo8aqP4Oc5nt5sCaBJCLfHi/zSa9jRA==
  keyName: someusername.user.cloud.dhbw-mannheim.de
```

## Running and Development

### Run locally

```bash
npm install # Install required modules
npm run build # Compile the nearley grammar for bind key files
npm run dryrun # Run a local dry-run
kubectl apply -f test/example-record.yaml # Add a custom resource
```

### Develop using [Skaffold](https://skaffold.dev/)

Make sure kubernetes is running and available and then run `skaffold dev`

### Deploy to Kubernetes

Option 1: Manual deployment
- Create a deployment similar to [this one](k8s/k8s-deployment.yaml)
- Deploy it using `kubectl apply -f your-filename.yaml`.

Option 2: Use Skaffold
- Run `npm run deploy`

### Build the Docker container

Run `docker build -t farberg/bind-dnssec-config controller/` and `docker build -t farberg/bind-dnssec-runner bindrunner`


## Use Case

<div style="text-align: center">
  <img src="use-case-dhbw-mannheim.svg" style="width: 75%;">
</div>

## Testing

```console
HMAC="hmac-sha256:my-awesome-keyname:THEKEYINBASE64FORMAT"
RECORD='test.user.cloud.dhbw-mannheim.de. 900 IN TXT "Hello, how are you?"'
echo -e server dyn-ns.cloud.dhbw-mannheim.de\nupdate add $RECORD\nsend\n | nsupdate -y "$HMAC"
```

## FAQ

I'm getting errors like `Exception in main method: Error: customresourcedefinitions.apiextensions.k8s.io is forbidden: User "system:serviceaccount:default:default" cannot create resource "customresourcedefinitions" in API group "apiextensions.k8s.io" at the cluster scope`
- Create missing RBAC roles
- For development (e.g., in Minikube), run `kubectl create clusterrolebinding --clusterrole=cluster-admin --user=system:serviceaccount:default:default --clusterrole=cluster-admin --user=system:serviceaccount rds-admin-binding`


## Internal Notes

Convert use case from PDF to SVG: ``NAME="use-case-dhbw-mannheim.pdf" ; pdfcrop --margins 0 "$NAME" "tmp.pdf" && pdf2svg	"tmp.pdf" `basename "$NAME" .pdf`.svg && rm tmp.pdf``
