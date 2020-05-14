## Local dry-run

```bash
# Compile the grammar
npm run build

# Run
nodemon src/index.js -- --verbose --dryrun

kubectl apply -f test/example-record.yaml
```

# Development using Skaffold

Make sure kubernetes is running and available
Run `skaffold dev`


# Build the Docker container

Run `docker build -t farberg/bind-dnssec-config .`

# Notes

`docker run --rm -ti farberg/bind-dnssec-config --entrypoint sh`

# Good reads

- [Invoking the Kubernetes API in Node.js](https://endaphelan.me/guides/kubernetes/invoking-the-kubernetes-api-in-node/)


## FAQ

### I'm getting errors like `Exception in main method: Error: customresourcedefinitions.apiextensions.k8s.io is forbidden: User "system:serviceaccount:default:default" cannot create resource "customresourcedefinitions" in API group "apiextensions.k8s.io" at the cluster scope`

Run

```bash
kubectl create clusterrolebinding \
	--clusterrole=cluster-admin \
  	--user=system:serviceaccount:default:default \
   --clusterrole=cluster-admin \
   --user=system:serviceaccount rds-admin-binding
```
