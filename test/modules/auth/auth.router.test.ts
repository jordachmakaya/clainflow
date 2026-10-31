import express from "express";
import type {Logger} from "pino";
import request from "supertest";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import {createAuthRouter} from "../../../src/modules/auth/auth.router.js";
import type {AuthService} from "../../../src/modules/auth/auth.service.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import {errorHandler} from "../../../src/shared/http/error-handler.js";
import {ConflictError, NotFoundError, UnauthorizedError} from "../../../src/shared/http/http-error.js";
import {ALICE, SECRET, TTL_SECONDS} from "./auth.fakes.js";

const tokens = new TokenService(SECRET, TTL_SECONDS);
const CREDENTIALS = {email: ALICE.email, password: ALICE.password};
const PROFILE = {id: 'user-1', email: ALICE.email, fullName: ALICE.fullName, role: Role.POLICYHOLDER};
const SESSION = {accessToken: 'signed-token', tokenType: 'Bearer', expiresIn: TTL_SECONDS, user: PROFILE};

describe('auth router', () => {
    const auth = {register: vi.fn(), login: vi.fn(), me: vi.fn()};
    const app = express();
    app.use(express.json());
    app.use('/auth', createAuthRouter(auth as unknown as AuthService, tokens));
    app.use(errorHandler({error: vi.fn()} as unknown as Logger));

    beforeEach(() => {
        vi.resetAllMocks();
        auth.register.mockResolvedValue(SESSION);
        auth.login.mockResolvedValue(SESSION);
        auth.me.mockResolvedValue(PROFILE);
    });

    describe('POST /auth/register', () => {
        it('renvoie 201 et la session', async () => {
            await request(app).post('/auth/register').send(ALICE).expect(201, SESSION);
        });

        it('transmet uniquement l\'entrée validée et normalisée', async () => {
            await request(app)
                .post('/auth/register')
                .send({...ALICE, email: ' ALICE@ClaimFlow.Test ', role: Role.ADMIN});

            expect(auth.register).toHaveBeenCalledExactlyOnceWith(ALICE);
        });

        it.each([
            ['corps vide', {}],
            ['email invalide', {...ALICE, email: 'pas-un-email'}],
            ['mot de passe faible', {...ALICE, password: 'passwordpassword'}],
            ['nom piégé', {...ALICE, fullName: 'Alice\nDurand'}],
        ])('renvoie 400 sans appeler le service : %s', async (_label, body) => {
            const res = await request(app).post('/auth/register').send(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
            expect(auth.register).not.toHaveBeenCalled();
        });

        it('propage un conflit', async () => {
            auth.register.mockRejectedValueOnce(new ConflictError('Email already exists'));

            await request(app)
                .post('/auth/register')
                .send(ALICE)
                .expect(409, {statusCode: 409, message: 'Email already exists'});
        });
    });

    describe('POST /auth/login', () => {
        it('renvoie 200 et la session', async () => {
            await request(app).post('/auth/login').send(CREDENTIALS).expect(200, SESSION);
        });

        it('appelle login et jamais register', async () => {
            await request(app).post('/auth/login').send(CREDENTIALS);

            expect(auth.login).toHaveBeenCalledExactlyOnceWith(CREDENTIALS);
            expect(auth.register).not.toHaveBeenCalled();
        });

        it('transmet un mot de passe court au service', async () => {
            await request(app).post('/auth/login').send({...CREDENTIALS, password: 'x'});

            expect(auth.login).toHaveBeenCalledExactlyOnceWith({...CREDENTIALS, password: 'x'});
        });

        it.each([
            ['corps vide', {}],
            ['email invalide', {...CREDENTIALS, email: 'pas-un-email'}],
            ['mot de passe vide', {...CREDENTIALS, password: ''}],
        ])('renvoie 400 sans appeler le service : %s', async (_label, body) => {
            const res = await request(app).post('/auth/login').send(body);

            expect(res.status).toBe(400);
            expect(auth.login).not.toHaveBeenCalled();
            expect(auth.register).not.toHaveBeenCalled();
        });

        it('propage un refus', async () => {
            auth.login.mockRejectedValueOnce(new UnauthorizedError('Invalid credentials'));

            await request(app)
                .post('/auth/login')
                .send(CREDENTIALS)
                .expect(401, {statusCode: 401, message: 'Invalid credentials'});
        });
    });

    describe('limite de débit', () => {
        const limited = express();
        limited.use(express.json());
        limited.use('/auth', createAuthRouter(auth as unknown as AuthService, tokens, {
            windowMs: 60_000,
            maxFailuresPerAccount: 2,
            maxFailuresPerIp: 3,
            maxRegistrationsPerIp: 1,
        }));
        limited.use(errorHandler({error: vi.fn()} as unknown as Logger));

        const login = (email = ALICE.email) => request(limited).post('/auth/login').send({...CREDENTIALS, email});

        it('renvoie 429 après trop d\'échecs sur un compte, sans appeler le service', async () => {
            auth.login.mockRejectedValue(new UnauthorizedError('Invalid credentials'));
            await login().expect(401);
            await login().expect(401);
            auth.login.mockClear();

            const res = await login();

            expect(res.status).toBe(429);
            expect(res.body).toEqual({statusCode: 429, message: 'Too many requests, please try again later'});
            expect(res.headers['retry-after']).toBeDefined();
            expect(auth.login).not.toHaveBeenCalled();
        });

        it('renvoie 429 sur l\'inscription au-delà de la limite, avant la validation', async () => {
            await request(limited).post('/auth/register').send({}).expect(400);

            await request(limited).post('/auth/register').send({}).expect(429);
        });
    });

    describe('GET /auth/me', () => {
        const bearer = async () => `Bearer ${await tokens.sign({id: 'user-1', role: Role.POLICYHOLDER})}`;

        it('renvoie 200 et le profil', async () => {
            await request(app).get('/auth/me').set('Authorization', await bearer()).expect(200, PROFILE);
        });

        it('lit l\'identifiant dans le token', async () => {
            await request(app).get('/auth/me?id=autre').set('Authorization', await bearer());

            expect(auth.me).toHaveBeenCalledExactlyOnceWith('user-1');
        });

        it('renvoie 401 sans token', async () => {
            await request(app).get('/auth/me').expect(401);

            expect(auth.me).not.toHaveBeenCalled();
        });

        it('renvoie 401 avec un token invalide', async () => {
            await request(app).get('/auth/me').set('Authorization', 'Bearer pas-un-token').expect(401);

            expect(auth.me).not.toHaveBeenCalled();
        });

        it('propage un compte introuvable', async () => {
            auth.me.mockRejectedValueOnce(new NotFoundError('Not Found'));

            await request(app).get('/auth/me').set('Authorization', await bearer()).expect(404);
        });
    });
});
