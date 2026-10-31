import {beforeEach, describe, expect, it, vi} from "vitest";
import type {PrismaClient} from "../../../src/generated/prisma/client.js";
import {Role} from "../../../src/generated/prisma/enums.js";
import {
    type NewUser,
    PrismaUserRepository,
    type User,
} from "../../../src/modules/users/users.repository.js";

const USER: User = {
    id: '0194e6a0-0000-7000-8000-000000000001',
    email: 'alice@claimflow.test',
    passwordHash: 'scrypt$17$8$1$sel$cle',
    fullName: 'Alice Durand',
    role: Role.POLICYHOLDER,
    createdAt: new Date('2026-03-02T10:00:00.000Z'),
};

const delegate = {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
};

const prisma = {
    user: delegate,
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
};

const repository = new PrismaUserRepository(prisma as unknown as PrismaClient);

describe('PrismaUserRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('create', () => {
        const data: NewUser = {
            email: USER.email,
            passwordHash: USER.passwordHash,
            fullName: USER.fullName,
            role: USER.role,
        };

        it('crée l\'utilisateur et le renvoie', async () => {
            delegate.create.mockResolvedValue(USER);

            await expect(repository.create(data)).resolves.toEqual(USER);
            expect(delegate.create).toHaveBeenCalledExactlyOnceWith({data});
        });

        it('propage une erreur de la base', async () => {
            delegate.create.mockRejectedValue(new Error('unique constraint'));

            await expect(repository.create(data)).rejects.toThrow('unique constraint');
        });
    });

    describe('findByEmail', () => {
        it('cherche par email', async () => {
            delegate.findUnique.mockResolvedValue(USER);

            await expect(repository.findByEmail(USER.email)).resolves.toEqual(USER);
            expect(delegate.findUnique).toHaveBeenCalledExactlyOnceWith({where: {email: USER.email}});
        });

        it('renvoie null si l\'email est inconnu', async () => {
            delegate.findUnique.mockResolvedValue(null);

            await expect(repository.findByEmail('inconnu@claimflow.test')).resolves.toBeNull();
        });
    });

    describe('findById', () => {
        it('cherche par identifiant', async () => {
            delegate.findUnique.mockResolvedValue(USER);

            await expect(repository.findById(USER.id)).resolves.toEqual(USER);
            expect(delegate.findUnique).toHaveBeenCalledExactlyOnceWith({where: {id: USER.id}});
        });

        it('renvoie null si l\'identifiant est inconnu', async () => {
            delegate.findUnique.mockResolvedValue(null);

            await expect(repository.findById('inconnu')).resolves.toBeNull();
        });
    });

    describe('listByRole', () => {
        it('filtre par rôle, trie de façon stable et pagine', async () => {
            delegate.findMany.mockResolvedValue([USER]);
            delegate.count.mockResolvedValue(41);

            await expect(repository.listByRole(Role.POLICYHOLDER, {page: 3, pageSize: 20}))
                .resolves.toEqual({items: [USER], total: 41});
            expect(delegate.findMany).toHaveBeenCalledExactlyOnceWith({
                where: {role: Role.POLICYHOLDER},
                orderBy: [{fullName: 'asc'}, {id: 'asc'}],
                skip: 40,
                take: 20,
            });
        });

        it('compte tous les utilisateurs du rôle, pas seulement la page', async () => {
            delegate.findMany.mockResolvedValue([]);
            delegate.count.mockResolvedValue(0);

            await repository.listByRole(Role.EXPERT, {page: 1, pageSize: 20});

            expect(delegate.count).toHaveBeenCalledExactlyOnceWith({where: {role: Role.EXPERT}});
        });

        it('lit la page et le total dans une même transaction', async () => {
            delegate.findMany.mockResolvedValue([]);
            delegate.count.mockResolvedValue(0);

            await repository.listByRole(Role.EXPERT, {page: 1, pageSize: 20});

            expect(prisma.$transaction).toHaveBeenCalledOnce();
        });

        it('renvoie une liste vide', async () => {
            delegate.findMany.mockResolvedValue([]);
            delegate.count.mockResolvedValue(0);

            await expect(repository.listByRole(Role.EXPERT, {page: 1, pageSize: 20}))
                .resolves.toEqual({items: [], total: 0});
        });
    });

    describe('updatePasswordHash', () => {
        it('met à jour uniquement le hachage', async () => {
            delegate.update.mockResolvedValue(USER);

            await repository.updatePasswordHash(USER.id, 'nouveau-hachage');

            expect(delegate.update).toHaveBeenCalledExactlyOnceWith({
                where: {id: USER.id},
                data: {passwordHash: 'nouveau-hachage'},
            });
        });

        it('ne renvoie pas l\'utilisateur', async () => {
            delegate.update.mockResolvedValue(USER);

            await expect(repository.updatePasswordHash(USER.id, 'x')).resolves.toBeUndefined();
        });

        it('propage une erreur de la base', async () => {
            delegate.update.mockRejectedValue(new Error('record not found'));

            await expect(repository.updatePasswordHash('inconnu', 'x')).rejects.toThrow('record not found');
        });
    });
});
