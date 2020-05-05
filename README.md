## Local dry-run

```bash
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