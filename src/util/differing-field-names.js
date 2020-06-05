const { diff } = require("deep-object-diff")

function getDifferingFieldNames(o1, o2) {
	if (!o1 && !o2)
		return []

	if (!o1 && o2)
		return Object.getOwnPropertyNames(o2)

	if (!o2 && o1)
		return Object.getOwnPropertyNames(o1)

	return Object.getOwnPropertyNames(diff(o1, o2))
}

module.exports = getDifferingFieldNames