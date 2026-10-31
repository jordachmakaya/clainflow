import express, {type RequestHandler, type Response} from "express";
import {SignJWT} from "jose";
import type {Logger} from "pino";
import request from "supertest";
import {describe, expect, it, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import {authenticate, authorize, currentUser} from "../../../src/modules/auth/auth.middleware.js";
import type {AuthUser} from "../../../src/modules/auth/auth.types.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import {errorHandler} from "../../../src/shared/http/error-handler.js";
import {UnauthorizedError} from "../../../src/shared/http/http-error.js";

const SECRET = 'test-secret-of-at-least-32-characters';
const USER: AuthUser = {id: 'user-123', role: Role.HANDLER};

function createTokenService(verify: (token: string) => Promise<AuthUser> = async () => USER) {
    const spy = vi.fn(verify);
    return {service: {verify: spy} as unknown as TokenService, verify: spy};
}

// Application minimale : les erreurs passent par le vrai errorHandler.
function createApp(...middlewares: RequestHandler[]) {
    const handler = vi.fn<RequestHandler>((_req, res) => {
        res.json({auth: res.locals.auth ?? null});
    });
    const app = express();
    app.get('/private', ...middlewares, handler);
    app.use(errorHandler({error: vi.fn()} as unknown as Logger));
    return {app, handler};
}

// Remplace authenticate : simule un utilisateur déjà identifié.
function authenticatedAs(user: AuthUser): RequestHandler {
    return (_req, res, next) => {
        res.locals.auth = user;
        next();
    };
}

function forgeToken(expiresIn = '1h', role: string = USER.role) {
    return new SignJWT({role})
        .setProtectedHeader({alg: 'HS256'})
        .setSubject(USER.id)
        .setIssuer('claimflow')
        .setAudience('claimflow-api')
        .setIssuedAt()
        .setExpirationTime(expiresIn)
        .sign(new TextEncoder().encode(SECRET));
}

describe('authenticate', () => {
    it('range l\'utilisateur dans res.locals.auth', async () => {
        const {service} = createTokenService();
        const {app} = createApp(authenticate(service));

        await request(app)
            .get('/private')
            .set('Authorization', 'Bearer valid-token')
            .expect(200, {auth: USER});
    });

    it('transmet uniquement le token à TokenService', async () => {
        const {service, verify} = createTokenService();
        const {app} = createApp(authenticate(service));

        await request(app).get('/private').set('Authorization', 'Bearer valid-token');

        expect(verify).toHaveBeenCalledExactlyOnceWith('valid-token');
    });

    it('refuse une requête sans en-tête Authorization', async () => {
        const {service, verify} = createTokenService();
        const {app, handler} = createApp(authenticate(service));

        await request(app)
            .get('/private')
            .expect(401, {statusCode: 401, message: 'Please Authenticate'});

        expect(verify).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });

    it.each([
        ['schéma Basic', 'Basic dXNlcjpwYXNz'],
        ['token seul', 'valid-token'],
        ['Bearer sans espace', 'Bearervalid-token'],
        ['Bearer sans token', 'Bearer'],
        ['schéma en minuscules', 'bearer valid-token'],
    ])('refuse un en-tête invalide : %s', async (_label, header) => {
        const {service, verify} = createTokenService();
        const {app, handler} = createApp(authenticate(service));

        await request(app)
            .get('/private')
            .set('Authorization', header)
            .expect(401, {statusCode: 401, message: 'Please Authenticate'});

        expect(verify).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
    });

    it('propage le refus de TokenService', async () => {
        const {service} = createTokenService(async () => {
            throw new UnauthorizedError('invalid token');
        });
        const {app, handler} = createApp(authenticate(service));

        await request(app)
            .get('/private')
            .set('Authorization', 'Bearer invalid-token')
            .expect(401, {statusCode: 401, message: 'invalid token'});

        expect(handler).not.toHaveBeenCalled();
    });

    it('ne divulgue pas une erreur inattendue', async () => {
        const {service} = createTokenService(async () => {
            throw new Error('secret interne');
        });
        const {app} = createApp(authenticate(service));

        await request(app)
            .get('/private')
            .set('Authorization', 'Bearer valid-token')
            .expect(500, {statusCode: 500, message: 'Internal server error'});
    });
});

describe('authorize', () => {
    it('laisse passer un rôle autorisé', async () => {
        const {app, handler} = createApp(authenticatedAs(USER), authorize(Role.HANDLER));

        await request(app).get('/private').expect(200);

        expect(handler).toHaveBeenCalledOnce();
    });

    it('accepte n\'importe lequel des rôles autorisés', async () => {
        const {app} = createApp(authenticatedAs(USER), authorize(Role.ADMIN, Role.HANDLER));

        await request(app).get('/private').expect(200);
    });

    it('refuse un rôle non autorisé', async () => {
        const {app, handler} = createApp(authenticatedAs(USER), authorize(Role.ADMIN));

        await request(app)
            .get('/private')
            .expect(403, {statusCode: 403, message: 'Forbidden'});

        expect(handler).not.toHaveBeenCalled();
    });

    it('refuse tout le monde sans rôle autorisé', async () => {
        const {app} = createApp(authenticatedAs({...USER, role: Role.ADMIN}), authorize());

        await request(app).get('/private').expect(403);
    });

    it.each(Object.values(Role))('applique la règle au rôle %s', async (role) => {
        const {app} = createApp(authenticatedAs({...USER, role}), authorize(Role.EXPERT));

        await request(app).get('/private').expect(role === Role.EXPERT ? 200 : 403);
    });

    it('renvoie 401 si authenticate n\'a pas été exécuté', async () => {
        const {app, handler} = createApp(authorize(Role.ADMIN));

        await request(app)
            .get('/private')
            .expect(401, {statusCode: 401, message: 'Unauthorized'});

        expect(handler).not.toHaveBeenCalled();
    });
});

describe('currentUser', () => {
    it('renvoie l\'utilisateur authentifié', () => {
        const res = {locals: {auth: USER}} as unknown as Response;

        expect(currentUser(res)).toEqual(USER);
    });

    it('lève UnauthorizedError sans utilisateur', () => {
        const res = {locals: {}} as unknown as Response;

        expect(() => currentUser(res)).toThrow(UnauthorizedError);
    });
});

describe('authenticate et authorize avec le vrai TokenService', () => {
    const tokens = new TokenService(SECRET, 3600);

    it('accepte un token valide avec le bon rôle', async () => {
        const {app} = createApp(authenticate(tokens), authorize(Role.HANDLER));

        await request(app)
            .get('/private')
            .set('Authorization', `Bearer ${await forgeToken()}`)
            .expect(200, {auth: USER});
    });

    it('refuse un token valide avec le mauvais rôle', async () => {
        const {app, handler} = createApp(authenticate(tokens), authorize(Role.ADMIN));

        await request(app)
            .get('/private')
            .set('Authorization', `Bearer ${await forgeToken()}`)
            .expect(403);

        expect(handler).not.toHaveBeenCalled();
    });

    it('refuse un token expiré', async () => {
        const {app} = createApp(authenticate(tokens), authorize(Role.HANDLER));

        await request(app)
            .get('/private')
            .set('Authorization', `Bearer ${await forgeToken('-1s')}`)
            .expect(401, {statusCode: 401, message: 'Token expired'});
    });

    it('refuse un rôle inconnu dans le token', async () => {
        const {app} = createApp(authenticate(tokens), authorize(Role.HANDLER));

        await request(app)
            .get('/private')
            .set('Authorization', `Bearer ${await forgeToken('1h', 'SUPERADMIN')}`)
            .expect(401, {statusCode: 401, message: 'invalid token'});
    });

    it('refuse un token illisible', async () => {
        const {app} = createApp(authenticate(tokens));

        await request(app)
            .get('/private')
            .set('Authorization', 'Bearer pas-un-token')
            .expect(401, {statusCode: 401, message: 'invalid token'});
    });
});
