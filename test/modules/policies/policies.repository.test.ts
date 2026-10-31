import {beforeEach, describe, expect, it, vi} from "vitest";
import type {PrismaClient} from "../../../src/generated/prisma/client.js";
import {PolicyProduct} from "../../../src/generated/prisma/enums.js";
import {
    type NewPolicy,
    type Policy,
    PrismaPolicyRepository,
} from "../../../src/modules/policies/policies.repository.js";

const HOLDER_ID = '0194e6a0-0000-7000-8000-000000000001';

const DATA: NewPolicy = {
    number: 'HAB-2026-ABC234',
    holderId: HOLDER_ID,
    product: PolicyProduct.HOME,
    coverageStart: new Date('2026-01-01T00:00:00.000Z'),
    coverageEnd: new Date('2026-12-31T00:00:00.000Z'),
    deductible: 15_000,
};

const POLICY: Policy = {
    ...DATA,
    id: '0194e6a1-0000-7000-8000-000000000001',
    createdAt: new Date('2026-03-02T10:00:00.000Z'),
};

const policyDelegate = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
};

const userDelegate = {
    findMany: vi.fn(),
    count: vi.fn(),
};

const prisma = {
    policy: policyDelegate,
    user: userDelegate,
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
};

const repository = new PrismaPolicyRepository(prisma as unknown as PrismaClient);

describe('PrismaPolicyRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('create', () => {
        it('crée le contrat et le renvoie', async () => {
            policyDelegate.create.mockResolvedValue(POLICY);

            await expect(repository.create(DATA)).resolves.toEqual(POLICY);
            expect(policyDelegate.create).toHaveBeenCalledExactlyOnceWith({data: DATA});
        });

        it('propage une erreur de la base', async () => {
            policyDelegate.create.mockRejectedValue(new Error('unique constraint'));

            await expect(repository.create(DATA)).rejects.toThrow('unique constraint');
        });
    });

    describe('findById', () => {
        it('cherche par identifiant', async () => {
            policyDelegate.findUnique.mockResolvedValue(POLICY);

            await expect(repository.findById(POLICY.id)).resolves.toEqual(POLICY);
            expect(policyDelegate.findUnique).toHaveBeenCalledExactlyOnceWith({where: {id: POLICY.id}});
        });

        it('renvoie null si l\'identifiant est inconnu', async () => {
            policyDelegate.findUnique.mockResolvedValue(null);

            await expect(repository.findById('inconnu')).resolves.toBeNull();
        });
    });

    describe('list', () => {
        beforeEach(() => {
            policyDelegate.findMany.mockResolvedValue([POLICY]);
            policyDelegate.count.mockResolvedValue(41);
        });

        it('filtre par titulaire, trie de façon stable et pagine', async () => {
            await expect(repository.list(HOLDER_ID, {page: 3, pageSize: 20}))
                .resolves.toEqual({items: [POLICY], total: 41});
            expect(policyDelegate.findMany).toHaveBeenCalledExactlyOnceWith({
                where: {holderId: HOLDER_ID},
                orderBy: [{createdAt: 'desc'}, {id: 'asc'}],
                skip: 40,
                take: 20,
            });
        });

        it('compte tous les contrats du titulaire, pas seulement la page', async () => {
            await repository.list(HOLDER_ID, {page: 1, pageSize: 20});

            expect(policyDelegate.count).toHaveBeenCalledExactlyOnceWith({where: {holderId: HOLDER_ID}});
        });

        it('lit la page et le total dans une même transaction', async () => {
            await repository.list(HOLDER_ID, {page: 1, pageSize: 20});

            expect(prisma.$transaction).toHaveBeenCalledOnce();
        });

        it('ne lit jamais la table des utilisateurs', async () => {
            await repository.list(HOLDER_ID, {page: 1, pageSize: 20});

            expect(userDelegate.findMany).not.toHaveBeenCalled();
            expect(userDelegate.count).not.toHaveBeenCalled();
        });

        it('renvoie une liste vide', async () => {
            policyDelegate.findMany.mockResolvedValue([]);
            policyDelegate.count.mockResolvedValue(0);

            await expect(repository.list(HOLDER_ID, {page: 1, pageSize: 20}))
                .resolves.toEqual({items: [], total: 0});
        });
    });
});
