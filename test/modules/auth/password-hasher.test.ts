import {randomBytes, scrypt, scryptSync} from "node:crypto";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ScryptPasswordHasher} from "../../../src/modules/auth/password-hasher.js";

vi.mock('node:crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:crypto')>();
    return {...actual, scrypt: vi.fn(actual.scrypt)};
});

const LOG2N = 14;
const PASSWORD = 'correct horse battery staple';

// Fabrique un hachage avec des paramètres choisis, sans passer par ScryptPasswordHasher.
function forge({log2N = LOG2N, r = 8, p = 1, keyLength = 64, saltLength = 16} = {}) {
    const salt = randomBytes(saltLength);
    const key = scryptSync(PASSWORD, salt, keyLength, {N: 2 ** log2N, r, p, maxmem: 2 ** 31});
    return ['scrypt', log2N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

describe('ScryptPasswordHasher', () => {
    const hasher = new ScryptPasswordHasher(LOG2N);

    beforeEach(() => {
        vi.mocked(scrypt).mockClear();
    });

    describe('constructor', () => {
        it.each([14, 17, 20])('accepte log2N=%d', (log2N) => {
            expect(() => new ScryptPasswordHasher(log2N)).not.toThrow();
        });

        it.each([13, 21, 14.5, Number.NaN, Number.POSITIVE_INFINITY])('rejette log2N=%d', (log2N) => {
            expect(() => new ScryptPasswordHasher(log2N)).toThrow(RangeError);
        });
    });

    describe('hash', () => {
        it('produit le format attendu', async () => {
            const stored = await hasher.hash(PASSWORD);
            const [algo, log2N, r, p, salt, key] = stored.split('$');

            expect([algo, log2N, r, p]).toEqual(['scrypt', '14', '8', '1']);
            expect(Buffer.from(salt ?? '', 'base64')).toHaveLength(16);
            expect(Buffer.from(key ?? '', 'base64')).toHaveLength(64);
        });

        it('utilise un sel différent à chaque appel', async () => {
            expect(await hasher.hash(PASSWORD)).not.toBe(await hasher.hash(PASSWORD));
        });

        it('ne contient pas le mot de passe', async () => {
            expect(await hasher.hash(PASSWORD)).not.toContain(PASSWORD);
        });

        it('masque le détail d\'un échec de scrypt', async () => {
            vi.mocked(scrypt).mockImplementationOnce((...args: unknown[]) => {
                (args.at(-1) as (err: Error) => void)(new Error('out of memory'));
            });

            await expect(hasher.hash(PASSWORD)).rejects.toThrow('Something went wrong, please try again');
        });
    });

    describe('verify', () => {
        it('accepte le bon mot de passe', async () => {
            expect(await hasher.verify(PASSWORD, await hasher.hash(PASSWORD))).toBe(true);
        });

        it('rejette un mauvais mot de passe', async () => {
            expect(await hasher.verify('wrong', await hasher.hash(PASSWORD))).toBe(false);
        });

        it('distingue la casse', async () => {
            expect(await hasher.verify(PASSWORD.toUpperCase(), await hasher.hash(PASSWORD))).toBe(false);
        });

        it('gère les caractères non ASCII', async () => {
            expect(await hasher.verify('mötdepasse🔐', await hasher.hash('mötdepasse🔐'))).toBe(true);
        });

        it('vérifie un hachage créé avec un coût plus élevé', async () => {
            expect(await hasher.verify(PASSWORD, forge({log2N: 15}))).toBe(true);
        });

        it('vérifie un hachage créé avec d\'autres r et p', async () => {
            expect(await hasher.verify(PASSWORD, forge({r: 4}))).toBe(true);
            expect(await hasher.verify(PASSWORD, forge({p: 2}))).toBe(true);
        });

        it('vérifie un hachage avec une autre longueur de clé', async () => {
            expect(await hasher.verify(PASSWORD, forge({keyLength: 32}))).toBe(true);
        });

        it('propage un échec de scrypt', async () => {
            const stored = await hasher.hash(PASSWORD);
            vi.mocked(scrypt).mockImplementationOnce((...args: unknown[]) => {
                (args.at(-1) as (err: Error) => void)(new Error('out of memory'));
            });

            await expect(hasher.verify(PASSWORD, stored)).rejects.toThrow('out of memory');
        });
    });

    describe('hachages invalides', () => {
        const salt = randomBytes(16).toString('base64');
        const key = randomBytes(64).toString('base64');

        const invalid: [string, string][] = [
            ['chaîne vide', ''],
            ['format inconnu', 'n-importe-quoi'],
            ['autre algorithme', `argon2id$14$8$1$${salt}$${key}`],
            ['champ manquant', `scrypt$14$8$1$${salt}`],
            ['champ supplémentaire', `scrypt$14$8$1$${salt}$${key}$extra`],
            ['log2N non numérique', `scrypt$abc$8$1$${salt}$${key}`],
            ['r non numérique', `scrypt$14$abc$1$${salt}$${key}`],
            ['p non numérique', `scrypt$14$8$abc$${salt}$${key}`],
            ['log2N vide', `scrypt$$8$1$${salt}$${key}`],
            ['log2N négatif', `scrypt$-1$8$1$${salt}$${key}`],
            ['log2N décimal', `scrypt$14.5$8$1$${salt}$${key}`],
            ['log2N hexadécimal', `scrypt$0xE$8$1$${salt}$${key}`],
            ['log2N avec exposant', `scrypt$1.4e1$8$1$${salt}$${key}`],
            ['log2N avec espace', `scrypt$ 14$8$1$${salt}$${key}`],
            ['log2N trop faible', `scrypt$13$8$1$${salt}$${key}`],
            ['log2N trop élevé', `scrypt$21$8$1$${salt}$${key}`],
            ['log2N démesuré', `scrypt$40$8$1$${salt}$${key}`],
            ['log2N immense', `scrypt$${'9'.repeat(400)}$8$1$${salt}$${key}`],
            ['r nul', `scrypt$14$0$1$${salt}$${key}`],
            ['p nul', `scrypt$14$8$0$${salt}$${key}`],
            ['r démesuré', `scrypt$14$100000$1$${salt}$${key}`],
            ['p démesuré', `scrypt$14$8$100000$${salt}$${key}`],
            ['sel vide', `scrypt$14$8$1$$${key}`],
            ['sel trop court', `scrypt$14$8$1$${randomBytes(4).toString('base64')}$${key}`],
            ['sel en base64 invalide', `scrypt$14$8$1$!!!!$${key}`],
            ['clé vide', `scrypt$14$8$1$${salt}$`],
            ['clé trop courte', `scrypt$14$8$1$${salt}$${randomBytes(16).toString('base64')}`],
            ['clé en base64 invalide', `scrypt$14$8$1$${salt}$!!!!`],
            ['clé contenant des caractères invalides', `scrypt$14$8$1$${salt}$${key.slice(0, 4)}!!${key.slice(4)}`],
        ];

        it.each(invalid)('verify renvoie false sans lancer scrypt : %s', async (_label, stored) => {
            await expect(hasher.verify(PASSWORD, stored)).resolves.toBe(false);
            expect(scrypt).not.toHaveBeenCalled();
        });

        it.each(invalid)('needsRehashedPassword renvoie true : %s', async (_label, stored) => {
            await expect(hasher.needsRehashedPassword(stored)).resolves.toBe(true);
        });

        it('n\'accepte pas un hachage altéré d\'un seul octet', async () => {
            const stored = await hasher.hash(PASSWORD);
            const fields = stored.split('$');
            const altered = Buffer.from(fields[5] ?? '', 'base64');
            altered[0] = (altered[0] ?? 0) ^ 1;
            fields[5] = altered.toString('base64');

            expect(await hasher.verify(PASSWORD, fields.join('$'))).toBe(false);
        });
    });

    describe('needsRehashedPassword', () => {
        it('renvoie false pour un hachage à jour', async () => {
            expect(await hasher.needsRehashedPassword(await hasher.hash(PASSWORD))).toBe(false);
        });

        it('renvoie true quand le coût exigé augmente', async () => {
            const stored = await hasher.hash(PASSWORD);

            expect(await new ScryptPasswordHasher(15).needsRehashedPassword(stored)).toBe(true);
        });

        it('renvoie false pour un coût supérieur à celui exigé', async () => {
            expect(await hasher.needsRehashedPassword(forge({log2N: 15}))).toBe(false);
        });

        it.each([
            ['r différent', {r: 4}],
            ['p différent', {p: 2}],
            ['longueur de clé différente', {keyLength: 32}],
            ['longueur de sel différente', {saltLength: 32}],
        ])('renvoie true : %s', async (_label, options) => {
            expect(await hasher.needsRehashedPassword(forge(options))).toBe(true);
        });
    });
});
