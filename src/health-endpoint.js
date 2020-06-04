const Express = require('express')

module.exports = class HealthEndpoint {
	constructor(options) {
		this.logger = options.logger("HealthEndpoint")
		this.logger.debug("New instance with options: ", options);
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
			res.status(200).send("OK");
		});

		this.app.listen(port)
	}

}