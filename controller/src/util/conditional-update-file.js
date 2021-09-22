const fs = require("fs")
const crypto = require('crypto');

module.exports = function (logger) {
	if (!logger)
		logger = console

	function updatePermissions(file, permissions) {
		if (fs.existsSync(file)) {
			logger.debug(`Updating permissions of ${file} to ${permissions}`)
			fs.chmodSync(file, permissions)
		} else {
			logger.debug(`Not Updating permissions of ${file} to ${permissions}, file does not exist`)
		}
	}

	return function (content, destFile, modifyCallbackBeforeHash, permissions) {
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

		if (permissions)
			updatePermissions(destFile, permissions)

		//logger.debug(`conditionalUpdateDest: Not updating ${destFile} since it would be unchanged`)
		return false;
	}
}


