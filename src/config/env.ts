import {z} from "zod"
import {ConfigReader, createEnvValidator, type InferEnv } from '@hardmachinelabs/zod-config/core'

export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default("development"),
    PORT: z.coerce.number().int().nonnegative().min(0).max(65553).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Env =  InferEnv<typeof envSchema>
const validateEnv = createEnvValidator({
    schema: envSchema,
    sensitiveKeys:[]
})

// Valide une source (process.env par défaut) et renvoie un lecteur typé et figé.
// Lève EnvValidationError (sans fuite de secret) si la config est invalide.
export function loadConfig(source = process.env): ConfigReader<Env>{
    return new ConfigReader<Env>(validateEnv(source))
}

export type AppConfig = ConfigReader<Env>