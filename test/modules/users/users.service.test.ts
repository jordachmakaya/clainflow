import {afterEach, beforeEach, describe, expect, it, type Mock, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import type {PasswordHasher} from "../../../src/modules/auth/password-hasher.js";
import {UsersService} from "../../../src/modules/users/users.service.js";
import {ConflictError} from "../../../src/shared/http/http-error.js";
import {fakeHasher, InMemoryUserRepository, uniqueEmailError} from "./users.fakes.js";

const STAFF = {
    email: 'gaelle@claimflow.test',
    password: 'correct horse battery',
    fullName: 'Gaëlle Martin',
    role: Role.HANDLER,
} as const;

const PAGE = {page: 1, pageSize: 20};

describe('UsersService', () => {
    let repository: InMemoryUserRepository;
    let hash: Mock<PasswordHasher['hash']>;
    let service: UsersService;

    beforeEach(() => {
        repository = new InMemoryUserRepository();
        hash = vi.fn(async (password: string) => `hashed:${password}`);
        service = new UsersService(repository, {...fakeHasher, hash});
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('createAccount', () => {
        it('renvoie l\'utilisateur public', async () => {
            await expect(service.createAccount(STAFF)).resolves.toEqual({
                id: 'user-1',
                email: STAFF.email,
                fullName: STAFF.fullName,
                role: STAFF.role,
            });
        });

        it('n\'expose pas le hachage', async () => {
            expect(await service.createAccount(STAFF)).not.toHaveProperty('passwordHash');
        });

        it('stocke le hachage et jamais le mot de passe', async () => {
            await service.createAccount(STAFF);

            expect(repository.users[0]?.passwordHash).toBe(`hashed:${STAFF.password}`);
            expect(repository.users[0]).not.toHaveProperty('password');
        });

        it('accepte le rôle POLICYHOLDER pour l\'inscription', async () => {
            const account = await service.createAccount({...STAFF, role: Role.POLICYHOLDER});

            expect(account.role).toBe(Role.POLICYHOLDER);
        });

        it('refuse un email déjà pris', async () => {
            await service.createAccount(STAFF);

            const error = await service.createAccount(STAFF).catch((err: unknown) => err);

            expect(error).toBeInstanceOf(ConflictError);
            expect(error).toMatchObject({statusCode: 409, message: 'Email already exists'});
        });

        it('ne hache pas le mot de passe si l\'email est pris', async () => {
            await service.createAccount(STAFF);
            hash.mockClear();

            await service.createAccount(STAFF).catch(() => undefined);

            expect(hash).not.toHaveBeenCalled();
        });

        it('ne crée rien si le hachage échoue', async () => {
            hash.mockRejectedValueOnce(new Error('hash failed'));

            await expect(service.createAccount(STAFF)).rejects.toThrow('hash failed');
            expect(repository.users).toHaveLength(0);
        });

        it('refuse un hachage vide', async () => {
            hash.mockResolvedValueOnce('');

            await expect(service.createAccount(STAFF)).rejects.toThrow();
            expect(repository.users).toHaveLength(0);
        });

        it('propage une erreur inattendue de la base', async () => {
            vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('connection lost'));

            await expect(service.createAccount(STAFF)).rejects.toThrow('connection lost');
        });

        it('renvoie 409 si un autre appel prend l\'email entre le contrôle et la création', async () => {
            vi.spyOn(repository, 'create').mockRejectedValueOnce(uniqueEmailError());

            await expect(service.createAccount(STAFF)).rejects.toBeInstanceOf(ConflictError);
        });

        it('renvoie 409 à la seconde de deux créations simultanées', async () => {
            const results = await Promise.allSettled([service.createAccount(STAFF), service.createAccount(STAFF)]);
            const rejected = results.find((result) => result.status === 'rejected');

            expect(rejected?.reason).toBeInstanceOf(ConflictError);
        });

        it('n\'écrit pas directement dans la console', async () => {
            vi.spyOn(repository, 'create').mockRejectedValueOnce(new Error('connection lost'));

            await service.createAccount(STAFF).catch(() => undefined);

            expect(console.error).not.toHaveBeenCalled();
        });
    });

    describe('createStaff', () => {
        it.each([Role.HANDLER, Role.EXPERT, Role.ADMIN])('crée un compte %s', async (role) => {
            const account = await service.createStaff({...STAFF, role});

            expect(account).toMatchObject({email: STAFF.email, role});
            expect(repository.users).toHaveLength(1);
        });
    });

    describe('listByRole', () => {
        beforeEach(async () => {
            await service.createAccount({...STAFF, email: 'zoe@claimflow.test', fullName: 'Zoé', role: Role.EXPERT});
            await service.createAccount({...STAFF, email: 'anne@claimflow.test', fullName: 'Anne', role: Role.EXPERT});
            await service.createAccount({...STAFF, email: 'bob@claimflow.test', fullName: 'Bob', role: Role.ADMIN});
        });

        it('filtre par rôle', async () => {
            const experts = await service.listByRole(Role.EXPERT, PAGE);

            expect(experts.items.map((user) => user.role)).toEqual([Role.EXPERT, Role.EXPERT]);
        });

        it('conserve l\'ordre du dépôt', async () => {
            const experts = await service.listByRole(Role.EXPERT, PAGE);

            expect(experts.items.map((user) => user.fullName)).toEqual(['Anne', 'Zoé']);
        });

        it('n\'expose aucun hachage', async () => {
            expect(JSON.stringify(await service.listByRole(Role.EXPERT, PAGE))).not.toContain('hashed:');
        });

        it('renvoie la page demandée et le total', async () => {
            const result = await service.listByRole(Role.EXPERT, {page: 2, pageSize: 1});

            expect(result).toMatchObject({page: 2, pageSize: 1, total: 2});
            expect(result.items.map((user) => user.fullName)).toEqual(['Zoé']);
        });

        it('n\'expose aucun hachage dans la page', async () => {
            const {items} = await service.listByRole(Role.EXPERT, PAGE);

            expect(items[0]).not.toHaveProperty('passwordHash');
        });

        it('renvoie une liste vide', async () => {
            await expect(service.listByRole(Role.POLICYHOLDER, PAGE)).resolves.toEqual({...PAGE, items: [], total: 0});
        });
    });
});
