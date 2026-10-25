import express, { type Express } from 'express';
import type {Container} from "./container.js";
import helmet from "helmet";
import {pinoHttp} from "pino-http";
import {createHealthRouter} from "./modules/health/health.router.js";
import {errorHandler, notFoundHandler} from "./shared/http/error-handler.js";


// 🏭 Fabrique l'app SANS la démarrer (indispensable pour Supertest).
export function createApp(container:Container) {
    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', 1); // derrière le load balancer AWS : IP client et https corrects

    app.use(helmet());
    app.use(pinoHttp({logger:container.logger}));
    app.use(express.json({ limit: "100kb" })); // limite la taille des bodies

    app.use('/health', createHealthRouter());
    app.use(notFoundHandler)
    app.use(errorHandler(container.logger));
    return app;
}