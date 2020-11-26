const fs = require("fs")
const crypto = require('crypto');

module.exports = function (logger) {
	if (!logger)
		logger = console

	return function (content, destFile, modifyCallbackBeforeHash) {
		//logger.debug(`conditionalUpdateDest: Checking whether ${destFile} needs to be updated`)

		let hash = (str) => {
			// Invoke a modify callback before hashing (e.g., to remove permanently changing fields)
			if (modifyCallbackBeforeHash)
				str = modifyCallbackBeforeHash(str);

			//Return the hash
			return crypto.createHash('sha256').update(str).digest('hex');
		}

		function hashFile(file) {
			return hash(fs.readFileSync(file, "utf-8"))
		}

		let destinationExists = fs.existsSync(destFile);
		let destFileHash = destinationExists ? hashFile(destFile) : "-1";
		let contentHash = hash(content)

		if (destFileHash !== contentHash) {
			logger.debug(`conditionalUpdateDest: Updating ${destFile} with new content: ${content}`)
			fs.writeFileSync(destFile, content)
			return true;
		}

		//logger.debug(`conditionalUpdateDest: Not updating ${destFile} since it would be unchanged`)
		return false;
	}
}


