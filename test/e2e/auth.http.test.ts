import express from "express";
import helmet from "helmet";
import type {Logger} from "pino";
import request from "supertest";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../src/generated/prisma/enums.js";
import {createAuthRouter} from "../../src/modules/auth/auth.router.js";
import {TokenService} from "../../src/modules/auth/token-service.js";
import {errorHandler, notFoundHandler} from "../../src/shared/http/error-handler.js";
import {ALICE, createAuthStack, seedUser} from "../modules/auth/auth.fakes.js";

// 🌐 Circuit HTTP complet : vraies routes, vrai scrypt, vrai JWT. Seule la base est en mémoire.
describe('routes /auth en HTTP', () => {
    const credentials = {email: ALICE.email, password: ALICE.password};
    let stack: ReturnType<typeof createAuthStack>;
    let app: express.Express;

    const register = (body: object = ALICE) => request(app).post('/auth/register').send(body);
    const login = (body: object = credentials) => request(app).post('/auth/login').send(body);
    const me = (token: string) => request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);

    beforeEach(() => {
        stack = createAuthStack();
        app = express();
        app.use(helmet());
        app.use(express.json({limit: '100kb'}));
        app.use('/auth', createAuthRouter(stack.service, stack.tokens));
        app.use(notFoundHandler);
        app.use(errorHandler({error: vi.fn()} as unknown as Logger));
    });

    describe('parcours', () => {
        it('inscrit, lit le profil, se reconnecte et relit le profil', async () => {
            const registered = await register().expect(201);
            const profile = await me(registered.body.accessToken).expect(200);
            const session = await login().expect(200);
            const again = await me(session.body.accessToken).expect(200);

            expect(profile.body).toEqual(registered.body.user);
            expect(session.body.user).toEqual(registered.body.user);
            expect(again.body).toEqual(registered.body.user);
        });

        it('renvoie une session complète à l\'inscription', async () => {
            const res = await register({...ALICE, email: ' ALICE@ClaimFlow.Test '});

            expect(res.body).toMatchObject({
                tokenType: 'Bearer',
                expiresIn: 3600,
                user: {email: ALICE.email, fullName: ALICE.fullName, role: Role.POLICYHOLDER},
            });
        });

        it('se connecte avec un email saisi autrement', async () => {
            await register();

            await login({...credentials, email: 'ALICE@CLAIMFLOW.TEST'}).expect(200);
        });

        it('se connecte avec le rôle enregistré', async () => {
            await seedUser(stack.repository, await stack.hasher.hash(ALICE.password), {role: Role.EXPERT});

            const res = await login().expect(200);

            expect(res.body.user.role).toBe(Role.EXPERT);
        });
    });

    describe('refus', () => {
        it('ne distingue pas email inconnu et mot de passe faux', async () => {
            await register();

            const wrong = await login({...credentials, password: 'mauvais mot de passe'}).expect(401);
            const unknown = await login({...credentials, email: 'inconnu@claimflow.test'}).expect(401);

            expect(wrong.body).toEqual({statusCode: 401, message: 'Invalid credentials'});
            expect(unknown.body).toEqual(wrong.body);
        });

        it('refuse une inscription en double', async () => {
            await register();

            await register().expect(409, {statusCode: 409, message: 'Email already exists'});
            expect(stack.repository.users).toHaveLength(1);
        });

        it.each([
            ['register', '/auth/register'],
            ['login', '/auth/login'],
        ])('renvoie 400 sur un JSON cassé : %s', async (_label, path) => {
            await request(app)
                .post(path)
                .set('Content-Type', 'application/json')
                .send('{ "email": ')
                .expect(400, {statusCode: 400, message: 'invalid JSON body'});
        });

        it('ne renvoie pas le mot de passe dans une erreur de validation', async () => {
            const res = await register({...ALICE, password: 'passwordpassword'}).expect(400);

            expect(JSON.stringify(res.body)).not.toContain('passwordpassword');
        });

        it('renvoie 401 sans token', async () => {
            await request(app).get('/auth/me').expect(401);
        });

        it('renvoie 401 avec un token signé par un autre secret', async () => {
            const forged = await new TokenService('autre-secret-de-plus-de-32-caracteres', 3600)
                .sign({id: 'user-1', role: Role.ADMIN});

            await me(forged).expect(401);
        });

        it('renvoie 404 pour le token d\'un compte supprimé', async () => {
            const {body} = await register();
            stack.repository.users.length = 0;

            await me(body.accessToken).expect(404);
        });
    });

    describe('sécurité', () => {
        it('impose le rôle assuré malgré le corps envoyé', async () => {
            const res = await register({...ALICE, role: Role.ADMIN}).expect(201);

            expect(res.body.user.role).toBe(Role.POLICYHOLDER);
        });

        it('ne crée aucun compte au login', async () => {
            await login({...credentials, email: 'inconnu@claimflow.test'});

            expect(stack.repository.users).toHaveLength(0);
        });

        it('n\'expose ni mot de passe ni hachage', async () => {
            const registered = await register();
            const session = await login();
            const profile = await me(registered.body.accessToken);

            for (const res of [registered, session, profile]) {
                expect(res.text).not.toContain(ALICE.password);
                expect(res.text).not.toContain('scrypt$');
            }
        });

        it('ajoute les en-têtes de sécurité', async () => {
            const res = await register();

            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        it.each([
            ['GET', '/auth/login'],
            ['GET', '/auth/register'],
            ['POST', '/auth/me'],
        ])('ne répond pas à %s %s', async (method, path) => {
            const res = method === 'GET' ? await request(app).get(path) : await request(app).post(path);

            expect(res.status).toBe(404);
        });
    });
});

// À activer quand le routeur sera monté dans app.ts, avec createTestApp() :
// sans base, la validation (400) et l'authentification (401) répondent avant toute requête SQL.
describe('routes /auth montées dans l\'application réelle', () => {
    it.todo('expose POST /auth/register : corps vide → 400');
    it.todo('expose POST /auth/login : corps vide → 400');
    it.todo('expose GET /auth/me : sans token → 401');
});
