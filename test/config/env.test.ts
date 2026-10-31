import {afterEach, describe, expect, it, vi} from "vitest";
import {EnvValidationError} from "@hardmachinelabs/zod-config/core";
import {loadConfig} from "../../src/config/env.js";

const validEnv = {
    JWT_SECRET: 'a'.repeat(32),
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/claimflow',
};

const dbParts = {
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_NAME: 'claimflow',
    DB_USER: 'user',
    DB_PASSWORD: 'pass',
};

function load(overrides: Record<string, string | undefined> = {}) {
    return loadConfig({...validEnv, ...overrides});
}

// Renvoie l'erreur levée par loadConfig pour pouvoir inspecter son contenu.
function loadError(env: Record<string, string | undefined>): EnvValidationError {
    try {
        loadConfig(env);
    } catch (err) {
        return err as EnvValidationError;
    }
    throw new Error('loadConfig should have thrown');
}

describe('loadConfig', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('lit process.env quand aucune source n\'est fournie', () => {
        vi.stubEnv('JWT_SECRET', validEnv.JWT_SECRET);
        vi.stubEnv('DATABASE_URL', validEnv.DATABASE_URL);
        vi.stubEnv('PORT', '4567');

        expect(loadConfig().get('PORT')).toBe(4567);
    });

    it('applique les valeurs par défaut', () => {
        const config = load();

        expect(config.get('NODE_ENV')).toBe('development');
        expect(config.get('PORT')).toBe(3000);
        expect(config.get('LOG_LEVEL')).toBe('info');
        expect(config.get('JWT_TTL_SECOND')).toBe(900);
        expect(config.get('PASSWORD_SCRYPT_LOG2N')).toBe(17);
        expect(config.get('SLA_UNDER_REVIEW_DAYS')).toBe(10);
        expect(config.get('FILE_STORAGE_DRIVER')).toBe('local');
        expect(config.get('UPLOAD_DIR')).toBe('./upload');
        expect(config.get('MAX_UPLOAD_BYTES')).toBe(5 * 1024 * 1024);
    });

    it('convertit les variables numériques en nombres', () => {
        const config = load({
            PORT: '8080',
            JWT_TTL_SECOND: '60',
            PASSWORD_SCRYPT_LOG2N: '18',
            SLA_UNDER_REVIEW_DAYS: '5',
            MAX_UPLOAD_BYTES: '1024',
        });

        expect(config.get('PORT')).toBe(8080);
        expect(config.get('JWT_TTL_SECOND')).toBe(60);
        expect(config.get('PASSWORD_SCRYPT_LOG2N')).toBe(18);
        expect(config.get('SLA_UNDER_REVIEW_DAYS')).toBe(5);
        expect(config.get('MAX_UPLOAD_BYTES')).toBe(1024);
    });

    describe('champs simples', () => {
        it.each([
            ['NODE_ENV', 'staging'],
            ['LOG_LEVEL', 'verbose'],
            ['FILE_STORAGE_DRIVER', 'ftp'],
            ['UPLOAD_DIR', ''],
        ])('rejette %s=%j', (key, value) => {
            expect(() => load({[key]: value})).toThrow(EnvValidationError);
        });

        it.each(['abc', '-1', '3.5', '65536'])('rejette PORT=%j', (value) => {
            expect(() => load({PORT: value})).toThrow(EnvValidationError);
        });

        it.each(['0', '65535'])('accepte PORT=%j', (value) => {
            expect(load({PORT: value}).get('PORT')).toBe(Number(value));
        });

        it.each(['JWT_TTL_SECOND', 'SLA_UNDER_REVIEW_DAYS', 'MAX_UPLOAD_BYTES'])('rejette %s=0', (key) => {
            expect(() => load({[key]: '0'})).toThrow(EnvValidationError);
        });
    });

    describe('JWT_SECRET', () => {
        it('est obligatoire', () => {
            expect(() => loadConfig({DATABASE_URL: validEnv.DATABASE_URL})).toThrow(EnvValidationError);
        });

        it('rejette un secret de moins de 32 caractères', () => {
            expect(() => load({JWT_SECRET: 'a'.repeat(31)})).toThrow(EnvValidationError);
        });

        it('accepte un secret de 32 caractères', () => {
            expect(load().get('JWT_SECRET')).toBe(validEnv.JWT_SECRET);
        });
    });

    describe('PASSWORD_SCRYPT_LOG2N', () => {
        it('rejette une valeur inférieure à 14', () => {
            expect(() => load({PASSWORD_SCRYPT_LOG2N: '13'})).toThrow(EnvValidationError);
        });

        it('accepte 14 hors production', () => {
            expect(load({PASSWORD_SCRYPT_LOG2N: '14'}).get('PASSWORD_SCRYPT_LOG2N')).toBe(14);
        });

        it('rejette une valeur inférieure à 17 en production', () => {
            const error = loadError({...validEnv, NODE_ENV: 'production', PASSWORD_SCRYPT_LOG2N: '16'});

            expect(error).toBeInstanceOf(EnvValidationError);
            expect(error.message).toContain('PASSWORD_SCRYPT_LOG2N');
        });

        it('accepte 17 en production', () => {
            const config = load({NODE_ENV: 'production', PASSWORD_SCRYPT_LOG2N: '17'});

            expect(config.get('PASSWORD_SCRYPT_LOG2N')).toBe(17);
        });
    });

    describe('FILE_STORAGE_DRIVER', () => {
        it.each([
            ['S3_BUCKET et S3_REGION', {}],
            ['S3_REGION', {S3_BUCKET: 'claims'}],
            ['S3_BUCKET', {S3_REGION: 'eu-west-3'}],
        ])('rejette s3 sans %s', (_missing, s3Env) => {
            expect(() => load({FILE_STORAGE_DRIVER: 's3', ...s3Env})).toThrow(EnvValidationError);
        });

        it('accepte s3 avec S3_BUCKET et S3_REGION', () => {
            const config = load({FILE_STORAGE_DRIVER: 's3', S3_BUCKET: 'claims', S3_REGION: 'eu-west-3'});

            expect(config.get('S3_BUCKET')).toBe('claims');
            expect(config.get('S3_REGION')).toBe('eu-west-3');
        });

        it('n\'exige pas S3_BUCKET ni S3_REGION en local', () => {
            expect(() => load({FILE_STORAGE_DRIVER: 'local'})).not.toThrow();
        });
    });

    describe('DATABASE_URL', () => {
        it('rejette une URL invalide', () => {
            expect(() => load({DATABASE_URL: 'pas-une-url'})).toThrow(EnvValidationError);
        });

        it('est prioritaire sur les variables DB_*', () => {
            expect(load(dbParts).get('DATABASE_URL')).toBe(validEnv.DATABASE_URL);
        });

        it('rejette des variables DB_* incomplètes', () => {
            const {DB_HOST} = dbParts;

            expect(() => loadConfig({JWT_SECRET: validEnv.JWT_SECRET, DB_HOST})).toThrow(EnvValidationError);
        });

        it('rejette DB_PORT non numérique', () => {
            expect(() => load({DB_PORT: 'abc'})).toThrow(EnvValidationError);
        });

        it('rejette DB_* sans DB_PASSWORD', () => {
            const {DB_PASSWORD: _password, ...partsWithoutPassword} = dbParts;

            expect(() => loadConfig({JWT_SECRET: validEnv.JWT_SECRET, ...partsWithoutPassword}))
                .toThrow(EnvValidationError);
        });

        it('rejette une configuration sans DATABASE_URL ni variables DB_*', () => {
            expect(() => loadConfig({JWT_SECRET: validEnv.JWT_SECRET})).toThrow(EnvValidationError);
        });

        it('construit l\'URL à partir des variables DB_*', () => {
            const config = loadConfig({JWT_SECRET: validEnv.JWT_SECRET, ...dbParts});

            expect(config.get('DATABASE_URL')).toBe('postgresql://user:pass@localhost:5432/claimflow');
        });

        it('encode les caractères spéciaux de DB_USER et DB_PASSWORD', () => {
            const config = loadConfig({
                JWT_SECRET: validEnv.JWT_SECRET,
                ...dbParts,
                DB_USER: 'us@er',
                DB_PASSWORD: 'p:ss/w#rd',
            });

            expect(config.get('DATABASE_URL')).toBe(
                'postgresql://us%40er:p%3Ass%2Fw%23rd@localhost:5432/claimflow',
            );
        });
    });

    describe('erreurs de validation', () => {
        it('nomme chaque variable invalide', () => {
            const error = loadError({...validEnv, PORT: 'abc', LOG_LEVEL: 'verbose'});

            expect(error.message).toContain('PORT');
            expect(error.message).toContain('LOG_LEVEL');
        });

        it.each([
            ['JWT_SECRET', 'trop-court-mais-confidentiel'],
            ['DATABASE_URL', 'url-invalide-mais-confidentielle'],
        ])('ne divulgue pas la valeur de %s', (key, value) => {
            const error = loadError({...validEnv, [key]: value});

            expect(error.message).not.toContain(value);
            expect(JSON.stringify(error.issues)).not.toContain(value);
        });
    });
});
