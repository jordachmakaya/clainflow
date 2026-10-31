import request from "supertest";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PolicyProduct, Role} from "../../src/generated/prisma/enums.js";
import {
    ADMIN_ID,
    createPoliciesStack,
    EXPERT_ID,
    HANDLER_ID,
    HOLDER_ID,
    OTHER_HOLDER_ID,
    POLICY_BODY,
    UNKNOWN_ID,
    uniqueNumberError,
} from "../modules/policies/policies.fakes.js";

// 🌐 Circuit HTTP complet : vraies routes, vrais schémas, vrai JWT. Seule la base est en mémoire.
describe('routes /policies en HTTP', () => {
    let stack: ReturnType<typeof createPoliciesStack>;
    let adminBearer: string;

    const asHolder = () => stack.bearer(HOLDER_ID, Role.POLICYHOLDER);
    const asOtherHolder = () => stack.bearer(OTHER_HOLDER_ID, Role.POLICYHOLDER);
    const asAdmin = () => stack.bearer(ADMIN_ID, Role.ADMIN);

    const create = (body: object = POLICY_BODY) => request(stack.app)
        .post('/policies')
        .set('Authorization', adminBearer)
        .send(body);
    const list = (bearer: string, query = '') => request(stack.app)
        .get(`/policies${query}`)
        .set('Authorization', bearer);
    const read = (bearer: string, id: string) => request(stack.app)
        .get(`/policies/${id}`)
        .set('Authorization', bearer);

    beforeEach(async () => {
        stack = createPoliciesStack();
        adminBearer = await asAdmin();
    });

    describe('parcours', () => {
        it('l\'admin souscrit, l\'assuré retrouve son contrat dans sa liste et le lit', async () => {
            const created = await create().expect(201);
            const bearer = await asHolder();

            const page = await list(bearer).expect(200);
            const detail = await read(bearer, created.body.id).expect(200);

            expect(page.body).toEqual({items: [created.body], total: 1, page: 1, pageSize: 20});
            expect(detail.body).toEqual(created.body);
        });

        it('renvoie un contrat complet à la souscription', async () => {
            const res = await create({...POLICY_BODY, product: PolicyProduct.MOTOR});

            expect(res.body).toEqual({
                id: expect.any(String),
                number: expect.stringMatching(/^AUT-2026-/),
                product: PolicyProduct.MOTOR,
                holderId: HOLDER_ID,
                coverageStart: '2026-01-01',
                coverageEnd: '2026-12-31',
                deductible: 15_000,
            });
        });

        it('conserve les dates telles que saisies', async () => {
            const body = {...POLICY_BODY, coverageStart: '2028-02-29', coverageEnd: '2029-02-28'};

            const created = await create(body).expect(201);
            const detail = await read(await asHolder(), created.body.id).expect(200);

            expect(detail.body).toMatchObject({coverageStart: '2028-02-29', coverageEnd: '2029-02-28'});
        });
    });

    describe('visibilité', () => {
        beforeEach(async () => {
            await create().expect(201);
            await create({...POLICY_BODY, holderId: OTHER_HOLDER_ID}).expect(201);
        });

        it('sépare les contrats de deux assurés', async () => {
            const mine = await list(await asHolder()).expect(200);
            const theirs = await list(await asOtherHolder()).expect(200);

            expect(mine.body.items.map((p: {holderId: string}) => p.holderId)).toEqual([HOLDER_ID]);
            expect(theirs.body.items.map((p: {holderId: string}) => p.holderId)).toEqual([OTHER_HOLDER_ID]);
        });

        it.each([
            [Role.ADMIN, ADMIN_ID],
            [Role.HANDLER, HANDLER_ID],
            [Role.EXPERT, EXPERT_ID],
        ])('montre tout le portefeuille à %s', async (role, id) => {
            const res = await list(await stack.bearer(id, role)).expect(200);

            expect(res.body.total).toBe(2);
        });

        it('laisse le personnel lire n\'importe quel contrat', async () => {
            const [policy] = stack.policies.policies;

            await read(await stack.bearer(EXPERT_ID, Role.EXPERT), policy?.id ?? '').expect(200);
        });

        it('renvoie 404 pour le contrat d\'un autre assuré', async () => {
            const [policy] = stack.policies.policies;

            await read(await asOtherHolder(), policy?.id ?? '').expect(404);
        });
    });

    describe('pagination', () => {
        beforeEach(async () => {
            for (let i = 0; i < 5; i++) await create().expect(201);
        });

        it('parcourt chaque contrat une seule fois, du plus récent au plus ancien', async () => {
            const bearer = await asHolder();

            const first = await list(bearer, '?page=1&pageSize=2').expect(200);
            const second = await list(bearer, '?page=2&pageSize=2').expect(200);
            const third = await list(bearer, '?page=3&pageSize=2').expect(200);

            const ids = [first, second, third].flatMap((res) => res.body.items.map((p: {id: string}) => p.id));
            expect(ids).toEqual(stack.policies.policies.map((policy) => policy.id).reverse());
            expect(first.body.total).toBe(5);
        });

        it('renvoie une page vide au-delà de la fin', async () => {
            const res = await list(await asHolder(), '?page=9&pageSize=2').expect(200);

            expect(res.body).toEqual({items: [], total: 5, page: 9, pageSize: 2});
        });
    });

    describe('refus', () => {
        it('renvoie 422 pour un titulaire inconnu', async () => {
            const res = await create({...POLICY_BODY, holderId: UNKNOWN_ID});

            expect(res.status).toBe(422);
            expect(res.body.message).toBe('holderId must reference a policyholder');
        });

        it('renvoie 422 pour un titulaire qui n\'est pas assuré', async () => {
            await create({...POLICY_BODY, holderId: EXPERT_ID}).expect(422);

            expect(stack.policies.policies).toHaveLength(0);
        });

        it('absorbe une collision de numéro isolée', async () => {
            vi.spyOn(stack.policies, 'create').mockRejectedValueOnce(uniqueNumberError());

            await create().expect(201);

            expect(stack.policies.policies).toHaveLength(1);
        });

        it('renvoie 409 si les collisions persistent, sans contrat créé', async () => {
            vi.spyOn(stack.policies, 'create').mockRejectedValue(uniqueNumberError());

            const res = await create();

            expect(res.status).toBe(409);
            expect(res.body).toEqual({statusCode: 409, message: 'Resource already exists'});
            expect(stack.policies.policies).toHaveLength(0);
        });

        it('détaille une validation refusée', async () => {
            const res = await create({...POLICY_BODY, coverageEnd: '2025-01-01'}).expect(400);

            expect(res.body.details).toEqual([
                {part: 'coverageEnd', message: 'coverage end must be after coverage start'},
            ]);
        });

        it('renvoie 400 sur un JSON cassé', async () => {
            await request(stack.app)
                .post('/policies')
                .set('Authorization', await asAdmin())
                .set('Content-Type', 'application/json')
                .send('{"holderId":')
                .expect(400);
        });

        it('renvoie 404 sur une méthode absente', async () => {
            await request(stack.app)
                .delete('/policies')
                .set('Authorization', await asAdmin())
                .expect(404);
        });
    });

    it.todo('monte /policies derrière authenticate dans createApp (app.ts ne monte pas encore le routeur)');
});
