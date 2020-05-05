const EventEmitter = require('events');
const { spawn } = require('child_process');

module.exports = class BindConfigRunner extends EventEmitter {

	constructor(options) {
		super()
		this.binaryPath = options.bindbinary
		this.configDir = options.configdir
		this.extraArgs = options.bindextraargs || ""
		this.dryRun = options.dryrun || false
		this.logger = options.logger

		this.defaultArgs = `-g -u named -c '${this.configDir}/named.conf'`
	}

	restart() {
		// Send SIGHUP to reload the config (if running)
		if (this.bindProcess) {
			this.logger.debug("Bind running, sending SIGHUP to reload the configuration")
			this.bindProcess.kill('SIGHUP')
		}

		// Stop here if only doing a dry run
		if (this.dryRun) {
			this.logger.debug("Not starting bind - dry run only");
			return
		}

		// Spawn a new bind process		
		let cmd = `'${this.binaryPath}' '${this.defaultArgs}' ${this.extraArgs}`

		this.logger.debug("String bind, command: ", cmd);
		this.bindProcess = spawn(cmd);
		this.emit('start')

		this.bindProcess.on('error', function (err) {
			this.bindProcess = null
			this.emit('error', err)
		})
		this.bindProcess.on('exit', function (code, signal) {
			this.bindProcess = null
			this.emit('exit', code, signal)
		})
	}


	ready() {
		return this.bindProcess || this.dryRun
	}
}