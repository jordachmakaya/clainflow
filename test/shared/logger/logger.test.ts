import {pino, type LoggerOptions} from "pino";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {loadConfig} from "../../../src/config/env.js";
import {createLogger} from "../../../src/shared/logger/logger.js";

vi.mock('pino', async (importOriginal) => {
    const actual = await importOriginal<typeof import('pino')>();
    return {...actual, pino: vi.fn(actual.pino)};
});

function config(overrides: Record<string, string> = {}) {
    return loadConfig({
        JWT_SECRET: 'test-secret-of-at-least-32-characters',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/claimflow_test',
        ...overrides,
    });
}

function optionsFor(overrides: Record<string, string> = {}) {
    createLogger(config(overrides));
    return vi.mocked(pino).mock.lastCall?.[0] as LoggerOptions;
}

// Écrit une ligne de log avec les options de createLogger, dans un flux lisible par le test.
function writeLog(payload: object) {
    const lines: string[] = [];
    pino(optionsFor({NODE_ENV: 'production'}), {write: (line: string) => lines.push(line)}).info(payload);
    return lines.join('');
}

describe('createLogger', () => {
    beforeEach(() => {
        vi.mocked(pino).mockClear();
    });

    it('applique LOG_LEVEL', () => {
        expect(createLogger(config({LOG_LEVEL: 'warn'})).level).toBe('warn');
    });

    it('active pino-pretty en développement', () => {
        expect(optionsFor({NODE_ENV: 'development'}).transport).toEqual({target: 'pino-pretty'});
    });

    it.each(['test', 'production'])('écrit du JSON brut en %s', (NODE_ENV) => {
        expect(optionsFor({NODE_ENV}).transport).toBeUndefined();
    });

    it('masque le header authorization', () => {
        const output = writeLog({req: {headers: {authorization: 'Bearer secret-token'}}});

        expect(output).not.toContain('secret-token');
    });

    it('masque le header cookie', () => {
        const output = writeLog({req: {headers: {cookie: 'session=secret-token'}}});

        expect(output).not.toContain('secret-token');
    });
});
