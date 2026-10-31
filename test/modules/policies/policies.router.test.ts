import express from "express";
import type {Logger} from "pino";
import request from "supertest";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PolicyProduct, Role} from "../../../src/generated/prisma/enums.js";
import {authenticate} from "../../../src/modules/auth/auth.middleware.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import {createPoliciesRouter} from "../../../src/modules/policies/policies.router.js";
import type {PolicyService} from "../../../src/modules/policies/policies.service.js";
import {errorHandler} from "../../../src/shared/http/error-handler.js";
import {NotFoundError, UnprocessableEntityError} from "../../../src/shared/http/http-error.js";
import {SECRET, TTL_SECONDS} from "../auth/auth.fakes.js";
import {ADMIN_ID, HOLDER_ID, POLICY_BODY, POLICY_INPUT, UNKNOWN_ID} from "./policies.fakes.js";

const tokens = new TokenService(SECRET, TTL_SECONDS);
const POLICY_ID = '0194e6a1-0000-7000-8000-000000000001';
const RESPONSE = {
    ...POLICY_BODY,
    id: POLICY_ID,
    number: 'HAB-2026-ABC234',
};
const PAGE = {items: [RESPONSE], total: 1, page: 1, pageSize: 20};

describe('policies router', () => {
    const policy = {create: vi.fn(), list: vi.fn(), get: vi.fn()};
    const app = express();
    app.use(express.json());
    app.use('/policies', authenticate(tokens), createPoliciesRouter(policy as unknown as PolicyService));
    app.use(errorHandler({error: vi.fn()} as unknown as Logger));

    const bearer = async (role: Role = Role.ADMIN, id: string = ADMIN_ID) => `Bearer ${await tokens.sign({id, role})}`;

    beforeEach(() => {
        vi.resetAllMocks();
        policy.create.mockResolvedValue(RESPONSE);
        policy.list.mockResolvedValue(PAGE);
        policy.get.mockResolvedValue(RESPONSE);
    });

    describe('POST /policies', () => {
        const post = async (body: object, role?: Role) => request(app)
            .post('/policies')
            .set('Authorization', await bearer(role))
            .send(body);

        it('renvoie 201 et le contrat', async () => {
            const res = await post(POLICY_BODY);

            expect(res.status).toBe(201);
            expect(res.body).toEqual(RESPONSE);
        });

        it('transmet uniquement l\'entrée validée et convertie', async () => {
            await post({...POLICY_BODY, number: 'HAB-2026-CHOISI', id: 'choisi'});

            expect(policy.create).toHaveBeenCalledExactlyOnceWith(POLICY_INPUT);
        });

        it.each([
            ['corps vide', {}],
            ['titulaire invalide', {...POLICY_BODY, holderId: 'user-1'}],
            ['produit inconnu', {...POLICY_BODY, product: 'LIFE'}],
            ['date invalide', {...POLICY_BODY, coverageStart: '2026-02-30'}],
            ['fin avant le début', {...POLICY_BODY, coverageEnd: '2025-01-01'}],
            ['franchise négative', {...POLICY_BODY, deductible: -1}],
        ])('renvoie 400 sans appeler le service : %s', async (_label, body) => {
            const res = await post(body);

            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Validation failed');
            expect(policy.create).not.toHaveBeenCalled();
        });

        it.each([Role.POLICYHOLDER, Role.HANDLER, Role.EXPERT])('renvoie 403 à %s', async (role) => {
            const res = await post(POLICY_BODY, role);

            expect(res.status).toBe(403);
            expect(policy.create).not.toHaveBeenCalled();
        });

        it('contrôle le rôle avant le corps', async () => {
            const res = await post({}, Role.POLICYHOLDER);

            expect(res.status).toBe(403);
        });

        it('renvoie 401 sans token', async () => {
            await request(app).post('/policies').send(POLICY_BODY).expect(401);

            expect(policy.create).not.toHaveBeenCalled();
        });

        it('propage un refus du service', async () => {
            policy.create.mockRejectedValueOnce(new UnprocessableEntityError('holderId must reference a policyholder'));

            const res = await post(POLICY_BODY);

            expect(res.status).toBe(422);
        });
    });

    describe('GET /policies', () => {
        const list = async (query = '') => request(app)
            .get(`/policies${query}`)
            .set('Authorization', await bearer(Role.POLICYHOLDER, HOLDER_ID));

        it('renvoie 200 et la page de contrats', async () => {
            const res = await list();

            expect(res.status).toBe(200);
            expect(res.body).toEqual(PAGE);
        });

        it('ne renvoie pas l\'identité de l\'appelant à la place des contrats', async () => {
            const res = await list();

            expect(res.body).not.toHaveProperty('role');
        });

        it('applique la pagination par défaut', async () => {
            await list();

            expect(policy.list).toHaveBeenCalledExactlyOnceWith(
                {id: HOLDER_ID, role: Role.POLICYHOLDER},
                {page: 1, pageSize: 20},
            );
        });

        it('transmet la pagination convertie', async () => {
            await list('?page=2&pageSize=5');

            expect(policy.list).toHaveBeenCalledExactlyOnceWith(
                {id: HOLDER_ID, role: Role.POLICYHOLDER},
                {page: 2, pageSize: 5},
            );
        });

        it.each([
            ['page nulle', '?page=0'],
            ['page négative', '?page=-1'],
            ['page non numérique', '?page=abc'],
            ['taille trop grande', '?pageSize=101'],
        ])('renvoie 400 sans appeler le service : %s', async (_label, query) => {
            const res = await list(query);

            expect(res.status).toBe(400);
            expect(policy.list).not.toHaveBeenCalled();
        });

        it('renvoie 401 sans token', async () => {
            await request(app).get('/policies').expect(401);

            expect(policy.list).not.toHaveBeenCalled();
        });
    });

    describe('GET /policies/:policyId', () => {
        const read = async (id: string) => request(app)
            .get(`/policies/${id}`)
            .set('Authorization', await bearer(Role.POLICYHOLDER, HOLDER_ID));

        it('renvoie 200 et le contrat', async () => {
            const res = await read(POLICY_ID);

            expect(res.status).toBe(200);
            expect(res.body).toEqual({...RESPONSE, product: PolicyProduct.HOME});
        });

        it('transmet l\'appelant lu dans le token', async () => {
            await read(POLICY_ID);

            expect(policy.get).toHaveBeenCalledExactlyOnceWith({id: HOLDER_ID, role: Role.POLICYHOLDER}, POLICY_ID);
        });

        it('renvoie 400 pour un identifiant invalide', async () => {
            const res = await read('pas-un-uuid');

            expect(res.status).toBe(400);
            expect(policy.get).not.toHaveBeenCalled();
        });

        it('propage un contrat introuvable', async () => {
            policy.get.mockRejectedValueOnce(new NotFoundError('This Policy does not exist'));

            const res = await read(UNKNOWN_ID);

            expect(res.status).toBe(404);
            expect(res.body).toEqual({statusCode: 404, message: 'This Policy does not exist'});
        });

        it('renvoie 401 sans token', async () => {
            await request(app).get(`/policies/${POLICY_ID}`).expect(401);

            expect(policy.get).not.toHaveBeenCalled();
        });
    });
});
