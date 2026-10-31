import {SignJWT, decodeJwt, decodeProtectedHeader} from "jose";
import {afterEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import {UnauthorizedError} from "../../../src/shared/http/http-error.js";

const SECRET = 'test-secret-of-at-least-32-characters';
const TTL_SECONDS = 3600;
const ISSUER = 'claimflow';
const AUDIENCE = 'claimflow-api';
const USER_ID = 'user-123';
const ROLE = Object.values(Role)[0] as Role;

const service = new TokenService(SECRET, TTL_SECONDS);

interface ForgeOptions {
    secret?: string;
    alg?: string;
    payload?: Record<string, unknown>;
    subject?: string | null;
    issuer?: string | null;
    audience?: string | null;
    expiresIn?: string;
    notBefore?: string;
}

// Fabrique un token indépendamment de TokenService.sign() : valide par défaut, altérable au besoin.
function forge(options: ForgeOptions = {}) {
    const {
        secret = SECRET,
        alg = 'HS256',
        payload = {role: ROLE},
        subject = USER_ID,
        issuer = ISSUER,
        audience = AUDIENCE,
        expiresIn = '1h',
        notBefore,
    } = options;

    const jwt = new SignJWT(payload).setProtectedHeader({alg}).setIssuedAt();
    if (subject !== null) jwt.setSubject(subject);
    if (issuer !== null) jwt.setIssuer(issuer);
    if (audience !== null) jwt.setAudience(audience);
    if (notBefore) jwt.setNotBefore(notBefore);
    jwt.setExpirationTime(expiresIn);

    return jwt.sign(new TextEncoder().encode(secret));
}

function base64Url(value: object) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function expectUnauthorized(token: string, message: string) {
    const error = await service.verify(token).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(UnauthorizedError);
    expect(error).toMatchObject({statusCode: 401, message});
}

describe('TokenService', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    describe('sign', () => {
        it('produit un token vérifiable par verify', async () => {
            const token = await service.sign({id: USER_ID, role: ROLE});

            await expect(service.verify(token)).resolves.toEqual({id: USER_ID, role: ROLE});
        });

        it('renseigne les claims attendus', async () => {
            const claims = decodeJwt(await service.sign({id: USER_ID, role: ROLE}));

            expect(claims).toMatchObject({sub: USER_ID, role: ROLE, iss: ISSUER, aud: AUDIENCE});
        });

        it('utilise HS256', async () => {
            const token = await service.sign({id: USER_ID, role: ROLE});

            expect(decodeProtectedHeader(token).alg).toBe('HS256');
        });

        it('expire après la durée demandée', async () => {
            const {exp, iat} = decodeJwt(await service.sign({id: USER_ID, role: ROLE}));

            expect((exp ?? 0) - (iat ?? 0)).toBe(TTL_SECONDS);
        });

        it('respecte une autre durée', async () => {
            const shortLived = new TokenService(SECRET, 60);
            const {exp, iat} = decodeJwt(await shortLived.sign({id: USER_ID, role: ROLE}));

            expect((exp ?? 0) - (iat ?? 0)).toBe(60);
        });

        it('reste valide juste avant la fin de la durée', async () => {
            vi.useFakeTimers({now: new Date('2026-03-02T10:00:00.000Z')});
            const token = await service.sign({id: USER_ID, role: ROLE});

            vi.setSystemTime(new Date('2026-03-02T10:59:59.000Z'));

            await expect(service.verify(token)).resolves.toEqual({id: USER_ID, role: ROLE});
        });

        it('refuse le token après la fin de la durée', async () => {
            vi.useFakeTimers({now: new Date('2026-03-02T10:00:00.000Z')});
            const token = await service.sign({id: USER_ID, role: ROLE});

            vi.setSystemTime(new Date('2026-03-02T11:00:01.000Z'));

            await expectUnauthorized(token, 'Token expired');
        });

        it('ne contient que les données nécessaires', async () => {
            const user = {id: USER_ID, role: ROLE, email: 'a@b.fr', passwordHash: 'x'};
            const claims = decodeJwt(await service.sign(user));

            expect(Object.keys(claims).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub']);
        });
    });

    describe('verify', () => {
        it('renvoie l\'utilisateur d\'un token valide', async () => {
            await expect(service.verify(await forge())).resolves.toEqual({id: USER_ID, role: ROLE});
        });

        it.each(Object.values(Role))('accepte le rôle %s', async (role) => {
            await expect(service.verify(await forge({payload: {role}}))).resolves.toEqual({id: USER_ID, role});
        });

        it('ignore les claims supplémentaires', async () => {
            const token = await forge({payload: {role: ROLE, admin: true}});

            await expect(service.verify(token)).resolves.toEqual({id: USER_ID, role: ROLE});
        });

        it('signale un token expiré', async () => {
            await expectUnauthorized(await forge({expiresIn: '-1s'}), 'Token expired');
        });

        it.each([
            ['chaîne vide', ''],
            ['texte quelconque', 'pas-un-token'],
            ['trois segments invalides', 'a.b.c'],
        ])('refuse un format invalide : %s', async (_label, token) => {
            await expectUnauthorized(token, 'invalid token');
        });

        it.each<[string, ForgeOptions]>([
            ['mauvais secret', {secret: 'another-secret-of-at-least-32-characters'}],
            ['algorithme HS384', {alg: 'HS384'}],
            ['algorithme HS512', {alg: 'HS512'}],
            ['mauvais émetteur', {issuer: 'attacker'}],
            ['émetteur absent', {issuer: null}],
            ['mauvaise audience', {audience: 'other-api'}],
            ['audience absente', {audience: null}],
            ['sujet absent', {subject: null}],
            ['sujet vide', {subject: ''}],
            ['rôle inconnu', {payload: {role: 'SUPERADMIN'}}],
            ['rôle absent', {payload: {}}],
            ['rôle non textuel', {payload: {role: 1}}],
            ['rôle sous forme de liste', {payload: {role: [ROLE]}}],
            ['pas encore valide', {notBefore: '1h'}],
        ])('refuse un token invalide : %s', async (_label, options) => {
            await expectUnauthorized(await forge(options), 'invalid token');
        });

        it('refuse un token sans signature (alg: none)', async () => {
            const now = Math.floor(Date.now() / 1000);
            const header = base64Url({alg: 'none'});
            const payload = base64Url({sub: USER_ID, role: ROLE, iss: ISSUER, aud: AUDIENCE, exp: now + 3600});

            await expectUnauthorized(`${header}.${payload}.`, 'invalid token');
        });

        it('refuse un token dont la charge a été modifiée', async () => {
            const [header, , signature] = (await forge()).split('.');
            const payload = base64Url({sub: 'attacker', role: ROLE, iss: ISSUER, aud: AUDIENCE});

            await expectUnauthorized(`${header}.${payload}.${signature}`, 'invalid token');
        });

        it('refuse un token dont la signature a été modifiée', async () => {
            const token = await forge();
            const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;

            await expectUnauthorized(tampered, 'invalid token');
        });

        it('n\'indique pas la raison d\'un refus de signature', async () => {
            const error = await service.verify(await forge({secret: 'another-secret-of-at-least-32-characters'}))
                .catch((err: Error) => err);

            expect((error as Error).message).not.toMatch(/signature/i);
        });
    });
});
