const { parseDomain } = require('parse-domain')



function getSuperDomains(d) {
	const split = d.split(".")
	const { subDomains, topLevelDomains } = parseDomain(d)
	const d_wo_tld = split.slice(0, split.length - topLevelDomains.length)
	const d_wo_hostname = d_wo_tld.slice(1)

	console.log(`split = ${split}`)
	console.log(`subDomains = ${subDomains}`)
	console.log(`topLevelDomains = ${topLevelDomains}`)
	console.log(`d_wo_tld = ${d_wo_tld}`)
	console.log(`d_wo_hostname = ${d_wo_hostname}`)

	return d_wo_hostname
}


for (let d of ["farberg.de", "www.farberg.de", "test.e.farberg.de", "www.bla.co.uk"]) {
	console.log(`------------------------------------------`)
	console.log(`Superdomains of ${d}: `, getSuperDomains(d))
}

