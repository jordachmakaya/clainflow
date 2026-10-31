import express from "express";
import type {Logger} from "pino";
import request from "supertest";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import {authenticate} from "../../../src/modules/auth/auth.middleware.js";
import {ScryptPasswordHasher} from "../../../src/modules/auth/password-hasher.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import {createUserRouter} from "../../../src/modules/users/users.router.js";
import {UsersService} from "../../../src/modules/users/users.service.js";
import {errorHandler} from "../../../src/shared/http/error-handler.js";
import {fakeHasher, InMemoryUserRepository, uniqueEmailError} from "./users.fakes.js";

const tokens = new TokenService('test-secret-of-at-least-32-characters', 3600);

const STAFF = {
    email: 'gaelle@claimflow.test',
    password: 'correct horse battery',
    fullName: 'Gaëlle Martin',
    role: Role.HANDLER,
};

function createApp(repository: InMemoryUserRepository, hasher = fakeHasher) {
    const app = express();
    app.use(express.json());
    app.use('/users', authenticate(tokens), createUserRouter(new UsersService(repository, hasher)));
    app.use(errorHandler({error: vi.fn()} as unknown as Logger));
    return app;
}

const bearer = async (role: Role) => `Bearer ${await tokens.sign({id: 'actor', role})}`;

describe('users router', () => {
    let repository: InMemoryUserRepository;
    let app: express.Express;

    beforeEach(() => {
        repository = new InMemoryUserRepository();
        app = createApp(repository);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const postStaff = async (body: object, role: Role = Role.ADMIN) => request(app)
        .post('/users')
        .set('Authorization', await bearer(role))
        .send(body);

    describe('POST /users', () => {
        it('crée un compte et renvoie 201', async () => {
            const res = await postStaff(STAFF);

            expect(res.status).toBe(201);
            expect(res.body).toEqual({
                id: 'user-1',
                email: STAFF.email,
                fullName: STAFF.fullName,
                role: STAFF.role,
            });
        });

        it('ne renvoie ni le mot de passe ni le hachage', async () => {
            const res = await postStaff(STAFF);

            expect(res.body).not.toHaveProperty('password');
            expect(res.body).not.toHaveProperty('passwordHash');
        });

        it('normalise l\'email', async () => {
            const res = await postStaff({...STAFF, email: '  GAELLE@ClaimFlow.Test '});

            expect(res.body.email).toBe('gaelle@claimflow.test');
        });

        it('ignore les champs envoyés en plus', async () => {
            await postStaff({...STAFF, id: 'attacker', passwordHash: 'x'});

            expect(repository.users[0]?.id).toBe('user-1');
            expect(repository.users[0]?.passwordHash).toBe(`hashed:${STAFF.password}`);
        });

        it('fonctionne avec le vrai hasher', async () => {
            const hasher = new ScryptPasswordHasher(14);
            const res = await request(createApp(repository, hasher))
                .post('/users')
                .set('Authorization', await bearer(Role.ADMIN))
                .send(STAFF);

            expect(res.status).toBe(201);
            expect(await hasher.verify(STAFF.password, repository.users[0]?.passwordHash ?? '')).toBe(true);
        });

        it('renvoie 401 sans token', async () => {
            await request(app).post('/users').send(STAFF).expect(401);

            expect(repository.users).toHaveLength(0);
        });

        it.each([Role.POLICYHOLDER, Role.HANDLER, Role.EXPERT])('renvoie 403 au rôle %s', async (role) => {
            const res = await postStaff(STAFF, role);

            expect(res.status).toBe(403);
            expect(repository.users).toHaveLength(0);
        });

        it('vérifie les droits avant de valider le corps', async () => {
            const res = await postStaff({}, Role.EXPERT);

            expect(res.status).toBe(403);
        });

        it.each([
            ['email invalide', {email: 'pas-un-email'}],
            ['mot de passe trop court', {password: 'court'}],
            ['nom vide', {fullName: '   '}],
            ['rôle POLICYHOLDER', {role: Role.POLICYHOLDER}],
            ['rôle inconnu', {role: 'SUPERADMIN'}],
        ])('renvoie 400 : %s', async (_label, override) => {
            const res = await postStaff({...STAFF, ...override});

            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({statusCode: 400, message: 'Validation failed'});
            expect(res.body.details).toHaveLength(1);
            expect(repository.users).toHaveLength(0);
        });

        it('détaille chaque champ invalide', async () => {
            const res = await postStaff({});

            expect(res.body.details.map((issue: {part: string}) => issue.part).sort())
                .toEqual(['email', 'fullName', 'password', 'role']);
        });

        it('ne renvoie pas le mot de passe dans une erreur', async () => {
            const res = await postStaff({...STAFF, password: 'mon-secret'});

            expect(JSON.stringify(res.body)).not.toContain('mon-secret');
        });

        it('renvoie 409 si l\'email est pris', async () => {
            await postStaff(STAFF);

            const res = await postStaff(STAFF);

            expect(res.status).toBe(409);
            expect(res.body).toEqual({statusCode: 409, message: 'Email already exists'});
        });

        it('compare les emails après normalisation', async () => {
            await postStaff(STAFF);

            const res = await postStaff({...STAFF, email: STAFF.email.toUpperCase()});

            expect(res.status).toBe(409);
        });

        it('ne divulgue pas une erreur de la base', async () => {
            vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('password=secret'));

            const res = await postStaff(STAFF);

            expect(res.status).toBe(500);
            expect(res.body).toEqual({statusCode: 500, message: 'Internal server error'});
        });

        it('renvoie 409 quand la base refuse un email en double', async () => {
            vi.spyOn(repository, 'create').mockRejectedValueOnce(uniqueEmailError());

            const res = await postStaff(STAFF);

            expect(res.status).toBe(409);
        });
    });

    describe('GET /users', () => {
        beforeEach(async () => {
            await postStaff({...STAFF, email: 'zoe@claimflow.test', fullName: 'Zoé', role: Role.EXPERT});
            await postStaff({...STAFF, email: 'anne@claimflow.test', fullName: 'Anne', role: Role.EXPERT});
        });

        const list = async (role: Role, query: string) => request(app)
            .get(`/users${query}`)
            .set('Authorization', await bearer(role));

        it.each([Role.ADMIN, Role.HANDLER])('liste les experts pour le rôle %s', async (role) => {
            const res = await list(role, '?role=EXPERT');

            expect(res.status).toBe(200);
            expect(res.body.items.map((user: {fullName: string}) => user.fullName)).toEqual(['Anne', 'Zoé']);
        });

        it('renvoie la page demandée et le total', async () => {
            const res = await list(Role.ADMIN, '?role=EXPERT&page=2&pageSize=1');

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({total: 2, page: 2, pageSize: 1});
            expect(res.body.items.map((user: {fullName: string}) => user.fullName)).toEqual(['Zoé']);
        });

        it('renvoie une page vide au-delà de la fin', async () => {
            const res = await list(Role.ADMIN, '?role=EXPERT&page=9');

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({items: [], total: 2, page: 9});
        });

        it.each(['page=0', 'page=abc', 'pageSize=0', 'pageSize=101', 'page=1&page=2'])(
            'renvoie 400 : %s',
            async (query) => {
                const res = await list(Role.ADMIN, `?role=EXPERT&${query}`);

                expect(res.status).toBe(400);
            },
        );

        it('n\'expose aucun hachage', async () => {
            const res = await list(Role.ADMIN, '?role=EXPERT');

            expect(JSON.stringify(res.body)).not.toContain('hashed:');
        });

        it.each([Role.POLICYHOLDER, Role.HANDLER, Role.ADMIN])(
            'refuse au gestionnaire la liste du rôle %s',
            async (role) => {
                const listByRole = vi.spyOn(repository, 'listByRole');

                const res = await list(Role.HANDLER, `?role=${role}`);

                expect(res.status).toBe(403);
                expect(res.body).toEqual({statusCode: 403, message: 'Forbidden'});
                expect(listByRole).not.toHaveBeenCalled();
            },
        );

        it.each(Object.values(Role))('laisse l\'admin lister le rôle %s', async (role) => {
            const res = await list(Role.ADMIN, `?role=${role}`);

            expect(res.status).toBe(200);
        });

        it('valide le rôle demandé avant de contrôler le gestionnaire', async () => {
            const res = await list(Role.HANDLER, '?role=SUPERADMIN');

            expect(res.status).toBe(400);
        });

        it('renvoie une liste vide', async () => {
            const res = await list(Role.ADMIN, '?role=POLICYHOLDER');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({items: [], total: 0, page: 1, pageSize: 20});
        });

        it('renvoie 401 sans token', async () => {
            await request(app).get('/users?role=EXPERT').expect(401);
        });

        it.each([Role.POLICYHOLDER, Role.EXPERT])('renvoie 403 au rôle %s', async (role) => {
            const res = await list(role, '?role=EXPERT');

            expect(res.status).toBe(403);
        });

        it.each([
            ['rôle absent', ''],
            ['rôle inconnu', '?role=SUPERADMIN'],
            ['rôle en minuscules', '?role=expert'],
            ['rôle en double', '?role=EXPERT&role=ADMIN'],
        ])('renvoie 400 : %s', async (_label, query) => {
            const res = await list(Role.ADMIN, query);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
        });
    });
});
