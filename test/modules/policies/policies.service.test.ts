import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {PolicyProduct, Role} from "../../../src/generated/prisma/enums.js";
import {PolicyService} from "../../../src/modules/policies/policies.service.js";
import {NotFoundError, UnprocessableEntityError} from "../../../src/shared/http/http-error.js";
import {fixedClock} from "../../../src/shared/time/clock.js";
import {InMemoryUserRepository} from "../users/users.fakes.js";
import {
    ADMIN_ID,
    EXPERT_ID,
    foreignKeyError,
    HANDLER_ID,
    HOLDER_ID,
    InMemoryPolicyRepository,
    NOW,
    OTHER_HOLDER_ID,
    POLICY_INPUT,
    seedAccount,
    UNKNOWN_ID,
    uniqueNumberError,
} from "./policies.fakes.js";

const HOLDER = {id: HOLDER_ID, role: Role.POLICYHOLDER};
const OTHER_HOLDER = {id: OTHER_HOLDER_ID, role: Role.POLICYHOLDER};
const STAFF = [
    {id: ADMIN_ID, role: Role.ADMIN},
    {id: HANDLER_ID, role: Role.HANDLER},
    {id: EXPERT_ID, role: Role.EXPERT},
];
const PAGINATION = {page: 1, pageSize: 20};

describe('PolicyService', () => {
    let users: InMemoryUserRepository;
    let policies: InMemoryPolicyRepository;
    let service: PolicyService;

    beforeEach(() => {
        users = new InMemoryUserRepository();
        policies = new InMemoryPolicyRepository(users);
        service = new PolicyService(policies, users, fixedClock(NOW));

        seedAccount(users, HOLDER_ID, Role.POLICYHOLDER);
        seedAccount(users, OTHER_HOLDER_ID, Role.POLICYHOLDER);
        seedAccount(users, ADMIN_ID, Role.ADMIN);
        seedAccount(users, HANDLER_ID, Role.HANDLER);
        seedAccount(users, EXPERT_ID, Role.EXPERT);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('create', () => {
        it('crée le contrat et renvoie sa forme publique', async () => {
            const created = await service.create(POLICY_INPUT);

            expect(created).toMatchObject({
                holderId: HOLDER_ID,
                product: PolicyProduct.HOME,
                coverageStart: '2026-01-01',
                coverageEnd: '2026-12-31',
                deductible: 15_000,
            });
            expect(policies.policies).toHaveLength(1);
        });

        it.each([
            [PolicyProduct.HOME, /^HAB-2026-[2-9A-HJKMNP-Z]{6}$/],
            [PolicyProduct.MOTOR, /^AUT-2026-[2-9A-HJKMNP-Z]{6}$/],
        ])('numérote un contrat %s', async (product, format) => {
            const {number} = await service.create({...POLICY_INPUT, product});

            expect(number).toMatch(format);
        });

        it('prend l\'année dans l\'horloge', async () => {
            const later = new PolicyService(policies, users, fixedClock('2031-06-15T12:00:00.000Z'));

            const {number} = await later.create(POLICY_INPUT);

            expect(number).toMatch(/^HAB-2031-/);
        });

        it('donne un numéro différent à chaque contrat', async () => {
            const first = await service.create(POLICY_INPUT);
            const second = await service.create(POLICY_INPUT);

            expect(first.number).not.toBe(second.number);
        });

        it.each([Role.ADMIN, Role.HANDLER, Role.EXPERT])('refuse un titulaire %s', async (role) => {
            const id = {[Role.ADMIN]: ADMIN_ID, [Role.HANDLER]: HANDLER_ID, [Role.EXPERT]: EXPERT_ID}[role];

            await expect(service.create({...POLICY_INPUT, holderId: id}))
                .rejects.toThrow(new UnprocessableEntityError('holderId must reference a policyholder'));

            expect(policies.policies).toHaveLength(0);
        });

        it('refuse un titulaire inconnu sans tenter l\'écriture', async () => {
            const create = vi.spyOn(policies, 'create');

            await expect(service.create({...POLICY_INPUT, holderId: UNKNOWN_ID}))
                .rejects.toThrow(new UnprocessableEntityError('holderId must reference a policyholder'));

            expect(create).not.toHaveBeenCalled();
        });

        it('prend l\'année de Paris, pas celle d\'UTC', async () => {
            const newYearEve = new PolicyService(policies, users, fixedClock('2026-12-31T23:30:00.000Z'));

            const {number} = await newYearEve.create(POLICY_INPUT);

            expect(number).toMatch(/^HAB-2027-/);
        });

        it('retire un autre numéro après une collision', async () => {
            const create = vi.spyOn(policies, 'create').mockRejectedValueOnce(uniqueNumberError());

            const created = await service.create(POLICY_INPUT);

            expect(create).toHaveBeenCalledTimes(2);
            expect(create.mock.calls[0]?.[0].number).not.toBe(created.number);
            expect(created.number).toBe(create.mock.calls[1]?.[0].number);
        });

        it('abandonne après cinq collisions', async () => {
            const error = uniqueNumberError();
            const create = vi.spyOn(policies, 'create').mockRejectedValue(error);

            await expect(service.create(POLICY_INPUT)).rejects.toBe(error);

            expect(create).toHaveBeenCalledTimes(5);
        });

        it('ne retente pas une autre erreur de la base', async () => {
            const create = vi.spyOn(policies, 'create').mockRejectedValue(foreignKeyError());

            await expect(service.create(POLICY_INPUT)).rejects.toMatchObject({code: 'P2003'});

            expect(create).toHaveBeenCalledOnce();
        });
    });

    describe('list', () => {
        beforeEach(async () => {
            await service.create(POLICY_INPUT);
            await service.create(POLICY_INPUT);
            await service.create({...POLICY_INPUT, holderId: OTHER_HOLDER_ID});
        });

        it('limite un assuré à ses contrats', async () => {
            const page = await service.list(HOLDER, PAGINATION);

            expect(page.total).toBe(2);
            expect(page.items.map((policy) => policy.holderId)).toEqual([HOLDER_ID, HOLDER_ID]);
        });

        it('renvoie une page vide à un assuré sans contrat', async () => {
            const page = await service.list({id: UNKNOWN_ID, role: Role.POLICYHOLDER}, PAGINATION);

            expect(page).toMatchObject({items: [], total: 0});
        });

        it.each(STAFF)('montre tous les contrats au personnel : $role', async (actor) => {
            const page = await service.list(actor, PAGINATION);

            expect(page.total).toBe(3);
            expect(page.items).toHaveLength(3);
        });

        it('rappelle la pagination dans la réponse', async () => {
            await expect(service.list(HOLDER, {page: 2, pageSize: 1})).resolves.toMatchObject({
                total: 2,
                page: 2,
                pageSize: 1,
            });
        });

        it('renvoie des contrats publics', async () => {
            const page = await service.list(HOLDER, PAGINATION);

            expect(page.items[0]?.coverageStart).toBe('2026-01-01');
            expect(page.items[0]).not.toHaveProperty('createdAt');
        });
    });

    describe('get', () => {
        let policyId: string;

        beforeEach(async () => {
            policyId = (await service.create(POLICY_INPUT)).id;
        });

        it('renvoie son contrat à l\'assuré', async () => {
            await expect(service.get(HOLDER, policyId)).resolves.toMatchObject({id: policyId});
        });

        it.each(STAFF)('renvoie le contrat au personnel : $role', async (actor) => {
            await expect(service.get(actor, policyId)).resolves.toMatchObject({id: policyId});
        });

        it('cache le contrat d\'un autre assuré derrière une 404', async () => {
            await expect(service.get(OTHER_HOLDER, policyId))
                .rejects.toThrow(new NotFoundError('This Policy does not exist'));
        });

        it('renvoie NotFoundError pour un contrat inconnu', async () => {
            await expect(service.get(HOLDER, UNKNOWN_ID))
                .rejects.toThrow(new NotFoundError('This Policy does not exist'));
        });
    });

    describe('getVisiblePolicy', () => {
        it('renvoie le modèle, pas la réponse publique', async () => {
            const {id} = await service.create(POLICY_INPUT);

            const policy = await service.getVisiblePolicy(HOLDER, id);

            expect(policy.coverageStart).toEqual(POLICY_INPUT.coverageStart);
            expect(policy.createdAt).toBeInstanceOf(Date);
        });

        it('applique la même règle de visibilité', async () => {
            const {id} = await service.create(POLICY_INPUT);

            await expect(service.getVisiblePolicy(OTHER_HOLDER, id)).rejects.toBeInstanceOf(NotFoundError);
        });
    });
});
