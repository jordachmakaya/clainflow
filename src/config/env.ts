import {z} from "zod"
import {ConfigReader, createEnvValidator, type InferEnv } from '@hardmachinelabs/zod-config/core'

const databaseSchema = z.object({
    DATABASE_URL: z.url().optional(),
    DB_HOST:z.string().optional(),
    DB_PORT: z.coerce.number().int().positive().optional(),
    DB_NAME: z.string().min(1).optional(),
    DB_USER: z.string().min(1).optional(),
    DB_PASSWORD: z.string().min(1).optional(),
})

const ERROR_MESSAGES = {
    DATABASE_URL: 'Provide DATABASE_URL environment variable or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD',
    PASSWORD_SCRYPT_LOG2N:'Must be >= 17 in production (OWASP)',
    S3_BUCKET:'S3_BUCKET and S3_REGION are required with FILE_STORAGE_DRIVER=s3'
} as const

export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default("development"),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECOND: z.coerce.number().int().positive().default(3600),

    // Coût scrypt = 2^N. OWASP recommande N=17 (128 Mio par hachage). Abaissable en test uniquement.
    PASSWORD_SCRYPT_LOG2N: z.coerce.number().int().positive().min(14).default(17),

    // ⏱️ SLA : un dossier "en instruction" depuis plus de N jours est en retard.
    SLA_UNDER_REVIEW_DAYS: z.coerce.number().int().positive().default(10),

    // 📎 Pièces jointes : disque local (dev/test) ou S3 (prod).
    FILE_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().min(1).default('./upload'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
}).extend(databaseSchema.shape)
    .superRefine((env,ctx) => {
        const hasParts = Boolean(env.DB_HOST && env.DB_PORT && env.DB_NAME && env.DB_USER && env.DB_PASSWORD);

        if(!env.DATABASE_URL && !hasParts){
            ctx.addIssue({
                code: 'custom',
                path:['DATABASE_URL'],
                message:ERROR_MESSAGES.DATABASE_URL,
            })
        }

        if(env.NODE_ENV === 'production' && env.PASSWORD_SCRYPT_LOG2N < 17){
            ctx.addIssue({
                code: 'custom',
                path:['PASSWORD_SCRYPT_LOG2N'],
                message:ERROR_MESSAGES.PASSWORD_SCRYPT_LOG2N
            })
        }

        if(env.FILE_STORAGE_DRIVER === 's3' && (!env.S3_BUCKET || !env.S3_REGION)){
            ctx.addIssue({
                code: 'custom',
                path:['S3_BUCKET'],
                message:ERROR_MESSAGES.S3_BUCKET
            })
        }
    })
    .transform((env) => ({
        ...env,
        DATABASE_URL: env.DATABASE_URL ?? buildDatabaseUrl(env),
    }))

function buildDatabaseUrl(env: z.infer<typeof databaseSchema>):string {
    const user = encodeURIComponent(env.DB_USER ?? '')
    const password = encodeURIComponent(env.DB_PASSWORD ?? '')
    return `postgresql://${user}:${password}@${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`
}

export type Env =  InferEnv<typeof envSchema>
const validateEnv = createEnvValidator({
    schema: envSchema,
    sensitiveKeys:['DATABASE_URL','DB_PASSWORD','JWT_SECRET'],
})

// Valide une source (process.env par défaut) et renvoie un lecteur typé et figé.
// Lève EnvValidationError (sans fuite de secret) si la config est invalide.
export function loadConfig(source = process.env): ConfigReader<Env>{
    return new ConfigReader<Env>(validateEnv(source))
}

export type AppConfig = ConfigReader<Env>