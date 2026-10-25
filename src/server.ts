import {loadConfig} from "./config/env.js";
import {createContainer} from "./container.js";
import {createApp} from "./app.js";
import http from "http"

const config = loadConfig();
const container = createContainer(config);
const app = createApp(container)
const httpServer = http.createServer(app)

const server = httpServer.listen(config.get('PORT'), () => {
    container.logger.info(`API listening on port ${config.get('PORT')}`);
} )

function shutdown(signal:string) {
    container.logger.info({signal:signal},"Shutting down");
    server.close((err) => {
        if(err) container.logger.error({err}, 'Error during shutdown');
        process.exit(err ? 1 : 0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

