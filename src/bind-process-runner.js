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

		this.defaultArgs = ['-g', '-u', 'named', '-c', `${this.configDir}/named.conf`]
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
		let cmd = `${this.binaryPath}' '${this.defaultArgs}' ${this.extraArgs}`
		let args = this.defaultArgs.concat(this.extraArgs)

		this.logger.debug("Bind, command ", cmd, "and", args);
		this.bindProcess = spawn(this.binaryPath, args);
		this.emit('start')

		this.bindProcess.on('error', err => {
			this.logger.debug(`Error: `, err)
			this.bindProcess = null
			this.emit('error', err)
		})

		this.bindProcess.on('exit', (code, signal) => {
			this.logger.debug(`Exit: `, code, signal)
			this.bindProcess = null
			this.emit('exit', code, signal)
		})

		this.bindProcess.stdout.on('data', (data) => {
			this.logger.debug("Bind stdout:", data.toString());
		});

		this.bindProcess.stderr.on('data', (data) => {
			this.logger.debug("Bind stderr:", data.toString());
		});
	}

	ready() {
		return this.bindProcess || this.dryRun
	}
}