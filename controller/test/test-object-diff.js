const { diff } = require("deep-object-diff");

let s1 = {
	keyName: 'bla.dhbw.edsc.cloud',
	dnssecKey: 'ChPcsQXVy01LInZses7nxYQRSidjRZyqhED8+q1jlRV+7COc81Eh252M2aE+VnOQoIYdayn6FK9VQDx47mO5zw==',
	dnssecAlgorithm: 'hmac-sha512'
}

let s2 = {
	keyName: 'other.dhbw.edsc.cloud',
	dnssecKey: 'ChPcsQXVy01LInZses7nxYQRSidjRZyqhED8+q1jlRV+7COc81Eh252M2aE+VnOQoIYdayn6FK9VQDx47mO5zw==',
	dnssecAlgorithm: 'hmac-sha512'
}

let s3 = {
}

let s4 = undefined

function mydiff(o1, o2) {
	if (!o1 && !o2)
		return []

	if (!o1 && o2)
		return Object.getOwnPropertyNames(o2)

	if (!o2 && o1)
		return Object.getOwnPropertyNames(o1)

	return Object.getOwnPropertyNames(diff(o1, o2))

}

function t(o1, o2) {
	let d = mydiff(o1, o2)
	console.log("-----------------------------------------")
	console.log(o1, " - ", o2, " = ", d)
	console.log("Changed props: ", d)
	console.log("-----------------------------------------")

}


t(s1, s2)
t(s1, s3)
t(s3, s1)
t(s1, s4)
