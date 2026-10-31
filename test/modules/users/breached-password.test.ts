import {createHash} from "node:crypto";
import type {Logger} from "pino";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PwnedPasswordsChecker} from "../../../src/modules/users/breached-password.js";

const PASSWORD = 'correct horse battery';
const DIGEST = createHash('sha1').update(PASSWORD, 'utf8').digest('hex').toUpperCase();
const PREFIX = DIGEST.slice(0, 5);
const SUFFIX = DIGEST.slice(5);
const OTHER_SUFFIX = 'F'.repeat(35);

describe('PwnedPasswordsChecker', () => {
    const request = vi.fn<typeof fetch>();
    const warn = vi.fn();
    const checker = new PwnedPasswordsChecker({warn} as unknown as Logger, request);

    const answer = (body: string, status = 200) => {
        request.mockResolvedValueOnce(new Response(body, {status}));
    };

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('détecte un mot de passe présent dans une fuite', async () => {
        answer(`${OTHER_SUFFIX}:3\r\n${SUFFIX}:42\r\n`);

        await expect(checker.isBreached(PASSWORD)).resolves.toBe(true);
    });

    it('accepte un mot de passe absent des fuites', async () => {
        answer(`${OTHER_SUFFIX}:3\r\n`);

        await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);
    });

    it('ignore une ligne de remplissage à zéro', async () => {
        answer(`${SUFFIX}:0\r\n`);

        await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);
    });

    it('lit la dernière ligne sans retour à la ligne', async () => {
        answer(`${OTHER_SUFFIX}:3\r\n${SUFFIX}:1`);

        await expect(checker.isBreached(PASSWORD)).resolves.toBe(true);
    });

    it('interroge le préfixe avec le remplissage et un délai', async () => {
        answer('');

        await checker.isBreached(PASSWORD);

        expect(request).toHaveBeenCalledExactlyOnceWith(
            `https://api.pwnedpasswords.com/range/${PREFIX}`,
            {headers: {'Add-Padding': 'true'}, signal: expect.any(AbortSignal)},
        );
    });

    it('hache les caractères non ASCII en UTF-8', async () => {
        const password = 'mötdepasse🔐';
        const digest = createHash('sha1').update(Buffer.from(password, 'utf8')).digest('hex').toUpperCase();
        answer(`${digest.slice(5)}:1`);

        await expect(checker.isBreached(password)).resolves.toBe(true);
    });

    describe('service indisponible', () => {
        it('laisse passer sur une erreur HTTP et journalise', async () => {
            answer('rate limited', 429);

            await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);

            expect(warn).toHaveBeenCalledExactlyOnceWith(
                {err: new Error('Pwned Passwords answered 429')},
                'Pwned Passwords check skipped',
            );
        });

        it('laisse passer sur une panne réseau', async () => {
            request.mockRejectedValueOnce(new TypeError('fetch failed'));

            await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);
            expect(warn).toHaveBeenCalledOnce();
        });

        it('laisse passer après le délai', async () => {
            request.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

            await expect(checker.isBreached(PASSWORD)).resolves.toBe(false);
        });
    });
});
