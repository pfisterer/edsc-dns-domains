const Express = require('express')

module.exports = class HealthEndpoint {
	constructor(bindProcessRunner, logger) {
		this.logger = logger
		this.bindProcessRunner = bindProcessRunner
	}

	start(port) {
		this.logger.info(`Starting health endpoint on port ${port}`)

		this.app = Express();

		this.app.get('/', (req, res) => {
			res.status(200).send(`
			<html>
      		<body>
        			<a href="/health/liveness">liveness</a><br>
        			<a href="/health/readiness">readiness</a>
      		</body>
    		</html>`);
		});

		this.app.get('/health/liveness', (req, res) => {
			this.logger.debug("Health check");
			res.status(200).send("OK");
		});

		this.app.get('/health/readiness', (req, res) => {
			this.logger.debug("Readiness check");
			if (this.bindProcessRunner.ready())
				res.status(200).send("OK");
			else
				res.status(500).send("Internal Server Error");
		});

		this.app.listen(port)
	}

}