import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";

describe('server', () => {
    let exit: ReturnType<typeof vi.spyOn>;
    let knownListeners: Set<NodeJS.SignalsListener>;

    beforeAll(async () => {
        knownListeners = new Set(process.listeners('SIGTERM'));
        vi.stubEnv('PORT', '0');
        vi.stubEnv('LOG_LEVEL', 'silent');
        vi.stubEnv('JWT_SECRET', 'test-secret-of-at-least-32-characters');
        vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/claimflow_test');
        exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

        await import('../src/server.js');
    });

    afterAll(() => {
        for (const signal of ['SIGTERM', 'SIGINT'] as const) {
            process.listeners(signal).filter((l) => !knownListeners.has(l)).forEach((l) => process.off(signal, l));
        }
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('s\'arrête proprement à la réception de SIGTERM', async () => {
        const shutdown = process.listeners('SIGTERM').find((l) => !knownListeners.has(l));

        shutdown?.('SIGTERM');

        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    });

    it('enregistre aussi un arrêt sur SIGINT', () => {
        expect(process.listeners('SIGINT').some((l) => !knownListeners.has(l))).toBe(true);
    });
});
