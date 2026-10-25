import type {AppConfig} from "./config/env.js";
import type {Logger} from "pino";
import {createLogger} from "./shared/logger/logger.js";

// 🧩 "Composition root" : le SEUL endroit où l'on crée les objets et où on les branche.
// C'est l'injection de dépendances faite à la main — exactement ce que NestJS automatise.
export interface Container {
    config: AppConfig
    logger:Logger
}


export function createContainer(config:AppConfig) {
    const logger = createLogger(config);
    return { config, logger };
}