let BindDnsSecKey = require("../src/dnssec-bind-key")

let key = new BindDnsSecKey({ keyFileName: "test/dnssec-example.key" })

console.log(key.loadExistingKeyFile())