import {pino,type Logger} from "pino"
import type {AppConfig} from "../../config/env.js";


export function createLogger (config:AppConfig):Logger{
    const isDev = config.get('NODE_ENV') === 'development';
    return pino({
        level:  config.get('LOG_LEVEL'),
        // Ne jamais logger ces champs, même par accident.
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        ...(isDev ? { transport : {target : 'pino-pretty'}}: {} )
    })
}