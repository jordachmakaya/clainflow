import {SignJWT} from "jose";
import request from "supertest";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../src/generated/prisma/enums.js";
import {SECRET} from "../modules/auth/auth.fakes.js";
import {
    ADMIN_ID,
    createPoliciesStack,
    foreignKeyError,
    HOLDER_ID,
    OTHER_HOLDER_ID,
    POLICY_BODY,
    UNKNOWN_ID,
    uniqueNumberError,
} from "../modules/policies/policies.fakes.js";

// 🕵️ Oracle de sécurité : chaque test joue un attaquant, puis vérifie un invariant.
// Un test rouge n'est pas un test à ajuster, c'est une faille à corriger dans le code.

const encoder = new TextEncoder();

function forge(claims: {role?: unknown, sub?: string}, key = SECRET) {
    return new SignJWT({role: claims.role ?? Role.ADMIN})
        .setProtectedHeader({alg: 'HS256'})
        .setSubject(claims.sub ?? ADMIN_ID)
        .setIssuer('claimflow')
        .setAudience('claimflow-api')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(encoder.encode(key));
}

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('oracle : contrats', () => {
    let stack: ReturnType<typeof createPoliciesStack>;

    const asHolder = () => stack.bearer(HOLDER_ID, Role.POLICYHOLDER);
    const asIntruder = () => stack.bearer(OTHER_HOLDER_ID, Role.POLICYHOLDER);
    const asAdmin = () => stack.bearer(ADMIN_ID, Role.ADMIN);

    const post = async (body: object | string) => request(stack.app)
        .post('/policies')
        .set('Authorization', await asAdmin())
        .set('Content-Type', 'application/json')
        .send(body);
    const get = (path: string, bearer: string) => request(stack.app)
        .get(path)
        .set('Authorization', bearer);

    beforeEach(() => {
        stack = createPoliciesStack();
    });

    describe('accès au contrat d\'autrui (IDOR)', () => {
        let policyId: string;

        beforeEach(async () => {
            policyId = (await post(POLICY_BODY)).body.id;
        });

        it('rend un contrat étranger indiscernable d\'un contrat inexistant', async () => {
            const bearer = await asIntruder();

            const foreign = await get(`/policies/${policyId}`, bearer);
            const missing = await get(`/policies/${UNKNOWN_ID}`, bearer);

            expect(foreign.status).toBe(404);
            expect(foreign.body).toEqual(missing.body);
        });

        it.each([
            ['holderId', `?holderId=${HOLDER_ID}`],
            ['id', `?id=${HOLDER_ID}`],
            ['opérateur Prisma', `?holderId[not]=${OTHER_HOLDER_ID}`],
            ['where', `?where[holderId]=${HOLDER_ID}`],
        ])('n\'élargit pas la liste via la query string : %s', async (_label, query) => {
            const res = await get(`/policies${query}`, await asIntruder());

            expect(res.status).toBe(200);
            expect(res.body).toMatchObject({items: [], total: 0});
        });

        it('lit le titulaire dans le token, jamais dans la requête', async () => {
            const res = await get(`/policies/${policyId}?id=${HOLDER_ID}&role=ADMIN`, await asIntruder());

            expect(res.status).toBe(404);
        });
    });

    describe('élévation de privilèges', () => {
        it('refuse la souscription à un assuré qui se déclare admin dans le corps', async () => {
            const res = await request(stack.app)
                .post('/policies')
                .set('Authorization', await asHolder())
                .send({...POLICY_BODY, role: Role.ADMIN});

            expect(res.status).toBe(403);
            expect(stack.policies.policies).toHaveLength(0);
        });

        it('refuse de rattacher un contrat à un compte du personnel', async () => {
            const res = await post({...POLICY_BODY, holderId: ADMIN_ID});

            expect(res.status).toBe(422);
            expect(stack.policies.policies).toHaveLength(0);
        });
    });

    describe('tokens forgés', () => {
        const attack = async (token: string) => {
            const res = await request(stack.app)
                .post('/policies')
                .set('Authorization', `Bearer ${token}`)
                .send(POLICY_BODY);

            expect(res.status).toBe(401);
            expect(stack.policies.policies).toHaveLength(0);
        };

        it('refuse un token signé avec une autre clé', async () => {
            await attack(await forge({}, 'une-autre-cle-de-plus-de-32-caracteres'));
        });

        it('refuse un token sans signature (alg none)', async () => {
            const header = base64url({alg: 'none', typ: 'JWT'});
            const payload = base64url({
                sub: ADMIN_ID,
                role: Role.ADMIN,
                iss: 'claimflow',
                aud: 'claimflow-api',
                exp: Math.floor(Date.now() / 1000) + 3600,
            });

            await attack(`${header}.${payload}.`);
        });

        it('refuse un token dont le rôle a été réécrit', async () => {
            const [header, , signature] = (await stack.tokens.sign({id: HOLDER_ID, role: Role.POLICYHOLDER})).split('.');
            const payload = base64url({sub: HOLDER_ID, role: Role.ADMIN, iss: 'claimflow', aud: 'claimflow-api'});

            await attack(`${header}.${payload}.${signature}`);
        });

        it('refuse un token avec un rôle inconnu', async () => {
            await attack(await forge({role: 'SUPERADMIN'}));
        });

        it('refuse un token expiré', async () => {
            const expired = await new SignJWT({role: Role.ADMIN})
                .setProtectedHeader({alg: 'HS256'})
                .setSubject(ADMIN_ID)
                .setIssuer('claimflow')
                .setAudience('claimflow-api')
                .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
                .sign(encoder.encode(SECRET));

            await attack(expired);
        });
    });

    describe('assignation de masse', () => {
        it('ignore les champs serveur envoyés par le client', async () => {
            const res = await post({
                ...POLICY_BODY,
                id: UNKNOWN_ID,
                number: 'HAB-2026-PIRATE',
                createdAt: '2000-01-01T00:00:00.000Z',
            });

            expect(res.status).toBe(201);
            expect(res.body.id).not.toBe(UNKNOWN_ID);
            expect(res.body.number).not.toBe('HAB-2026-PIRATE');
            expect(stack.policies.policies[0]?.createdAt.getFullYear()).toBe(2026);
        });

        it('ne pollue pas les prototypes', async () => {
            const raw = JSON.stringify(POLICY_BODY).replace(/^\{/, '{"__proto__":{"polluted":true},');

            const res = await post(raw);

            expect(res.status).toBe(201);
            expect(({} as {polluted?: boolean}).polluted).toBeUndefined();
            expect(stack.policies.policies[0]).not.toHaveProperty('polluted');
        });

        it('ne fournit pas un champ obligatoire via __proto__', async () => {
            const {deductible: _deductible, ...rest} = POLICY_BODY;
            const raw = JSON.stringify(rest).replace(/^\{/, '{"__proto__":{"deductible":0},');

            const res = await post(raw);

            expect(res.status).toBe(400);
        });
    });

    describe('confusion de types et injections', () => {
        it.each([
            ['opérateur Prisma dans holderId', {holderId: {not: HOLDER_ID}}],
            ['tableau dans holderId', {holderId: [HOLDER_ID]}],
            ['injection SQL dans holderId', {holderId: `${HOLDER_ID}' OR '1'='1`}],
            ['franchise en chaîne', {deductible: '0'}],
            ['franchise en objet', {deductible: {set: 0}}],
            ['franchise négative', {deductible: -15_000}],
            ['franchise décimale', {deductible: 0.1}],
            ['franchise en notation géante', {deductible: 1e21}],
            ['franchise au-delà du Int de la colonne', {deductible: 2_147_483_648}],
            ['date avec heure', {coverageStart: '2026-01-01T23:59:59+14:00'}],
            ['date en timestamp', {coverageStart: 1_767_225_600_000}],
            ['date inexistante', {coverageStart: '2026-02-30'}],
            ['couverture inversée', {coverageStart: '2027-01-01', coverageEnd: '2026-01-01'}],
            ['couverture de durée nulle', {coverageEnd: POLICY_BODY.coverageStart}],
            ['produit piégé', {product: {in: ['HOME']}}],
        ])('renvoie 400 sans écrire : %s', async (_label, overrides) => {
            const res = await post({...POLICY_BODY, ...overrides});

            expect(res.status).toBe(400);
            expect(stack.policies.policies).toHaveLength(0);
        });

        it.each([
            ['injection SQL', '\' OR 1=1--'],
            ['remontée de chemin', '..%2f..%2fusers'],
            ['octet nul', `${HOLDER_ID}%00`],
            ['tableau', `${HOLDER_ID},${OTHER_HOLDER_ID}`],
        ])('renvoie 400 sur un identifiant piégé : %s', async (_label, id) => {
            const findById = vi.spyOn(stack.policies, 'findById');

            const res = await get(`/policies/${id}`, await asAdmin());

            expect(res.status).toBe(400);
            expect(findById).not.toHaveBeenCalled();
        });
    });

    describe('abus de pagination', () => {
        it.each([
            ['taille démesurée', '?pageSize=1000000'],
            ['page nulle', '?page=0'],
            ['page négative', '?page=-1'],
            ['page décimale', '?page=1.5'],
            ['page hors limite', '?page=1000001'],
            ['valeurs multiples', '?page=1&page=2'],
            ['infini', '?page=Infinity'],
        ])('renvoie 400 : %s', async (_label, query) => {
            const list = vi.spyOn(stack.policies, 'list');

            const res = await get(`/policies${query}`, await asHolder());

            expect(res.status).toBe(400);
            expect(list).not.toHaveBeenCalled();
        });
    });

    describe('fuites d\'information', () => {
        it('n\'expose que les champs publics du contrat', async () => {
            const res = await post(POLICY_BODY);

            expect(Object.keys(res.body).sort()).toEqual([
                'coverageEnd',
                'coverageStart',
                'deductible',
                'holderId',
                'id',
                'number',
                'product',
            ]);
        });

        it('n\'expose jamais les données du compte titulaire', async () => {
            const res = await post(POLICY_BODY);

            expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|hashed:|@claimflow/);
        });

        it.each([
            ['clé étrangère', foreignKeyError],
            ['unicité', uniqueNumberError],
        ])('masque le schéma SQL : %s', async (_label, error) => {
            vi.spyOn(stack.policies, 'create').mockRejectedValue(error());

            const res = await post(POLICY_BODY);

            expect(res.status).toBe(409);
            expect(JSON.stringify(res.body)).not.toMatch(/holder_id|fkey|number|Prisma/);
        });

        it('masque une panne de la base', async () => {
            vi.spyOn(stack.users, 'findById').mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

            const res = await post(POLICY_BODY);

            expect(res.status).toBe(500);
            expect(res.body).toEqual({statusCode: 500, message: 'Internal server error'});
        });

        it('ne confirme pas l\'existence d\'un titulaire par le message d\'erreur', async () => {
            const unknown = await post({...POLICY_BODY, holderId: UNKNOWN_ID});
            const staff = await post({...POLICY_BODY, holderId: ADMIN_ID});

            expect(unknown.status).toBe(422);
            expect(unknown.body).toEqual(staff.body);
        });
    });

    describe('numéros de contrat', () => {
        it('produit des numéros imprévisibles', async () => {
            const numbers = new Set<string>();
            for (let i = 0; i < 50; i++) numbers.add((await post(POLICY_BODY)).body.number);

            expect(numbers.size).toBe(50);
        });

        it('ne laisse pas une collision bloquer une souscription', async () => {
            const create = vi.spyOn(stack.policies, 'create');
            create.mockRejectedValueOnce(uniqueNumberError()).mockRejectedValueOnce(uniqueNumberError());

            const res = await post(POLICY_BODY);

            expect(res.status).toBe(201);
            expect(create).toHaveBeenCalledTimes(3);
        });
    });
});
