import type {Logger} from "pino";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import {AuthService} from "../../../src/modules/auth/auth.service.js";
import type {PasswordHasher} from "../../../src/modules/auth/password-hasher.js";
import type {TokenService} from "../../../src/modules/auth/token-service.js";
import {UsersService} from "../../../src/modules/users/users.service.js";
import {ConflictError, NotFoundError, UnauthorizedError} from "../../../src/shared/http/http-error.js";
import {fakeHasher, InMemoryUserRepository} from "../users/users.fakes.js";
import {ALICE, seedUser, TTL_SECONDS} from "./auth.fakes.js";

const CREDENTIALS = {email: ALICE.email, password: ALICE.password};
const STORED_HASH = `hashed:${ALICE.password}`;

describe('AuthService', () => {
    let repository: InMemoryUserRepository;
    let hasher: PasswordHasher;
    let sign: ReturnType<typeof vi.fn>;
    let warn: ReturnType<typeof vi.fn>;
    let service: AuthService;

    beforeEach(() => {
        repository = new InMemoryUserRepository();
        hasher = {...fakeHasher};
        sign = vi.fn(async () => 'signed-token');
        warn = vi.fn();
        service = new AuthService(
            repository,
            new UsersService(repository, hasher),
            hasher,
            {sign} as unknown as TokenService,
            TTL_SECONDS,
            {warn} as unknown as Logger,
        );
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('register', () => {
        it('crée un assuré et renvoie une session', async () => {
            const session = await service.register(ALICE);

            expect(session).toEqual({
                accessToken: 'signed-token',
                tokenType: 'Bearer',
                expiresIn: TTL_SECONDS,
                user: {
                    id: 'user-1',
                    email: ALICE.email,
                    fullName: ALICE.fullName,
                    role: Role.POLICYHOLDER,
                },
            });
            expect(sign).toHaveBeenCalledExactlyOnceWith({id: 'user-1', role: Role.POLICYHOLDER});
        });

        it('stocke le hachage, jamais le mot de passe', async () => {
            await service.register(ALICE);

            expect(repository.users[0]?.passwordHash).toBe(STORED_HASH);
        });

        it('ne signe aucun token si l\'email est pris', async () => {
            await seedUser(repository, STORED_HASH);

            await expect(service.register(ALICE)).rejects.toBeInstanceOf(ConflictError);

            expect(sign).not.toHaveBeenCalled();
        });
    });

    describe('login', () => {
        it('renvoie une session avec les bons identifiants', async () => {
            await seedUser(repository, STORED_HASH);

            const session = await service.login(CREDENTIALS);

            expect(session).toMatchObject({
                accessToken: 'signed-token',
                tokenType: 'Bearer',
                expiresIn: TTL_SECONDS,
                user: {id: 'user-1', email: ALICE.email},
            });
        });

        it('refuse un mot de passe faux', async () => {
            await seedUser(repository, STORED_HASH);

            await expect(service.login({...CREDENTIALS, password: 'mauvais mot de passe'}))
                .rejects.toThrow(new UnauthorizedError('Invalid credentials'));

            expect(sign).not.toHaveBeenCalled();
        });

        it('refuse un email inconnu avec le même message', async () => {
            await expect(service.login(CREDENTIALS))
                .rejects.toThrow(new UnauthorizedError('Invalid credentials'));

            expect(sign).not.toHaveBeenCalled();
        });

        it('propage un échec de vérification', async () => {
            await seedUser(repository, STORED_HASH);
            vi.spyOn(hasher, 'verify').mockRejectedValueOnce(new Error('scrypt failed'));

            await expect(service.login(CREDENTIALS)).rejects.toThrow('scrypt failed');

            expect(sign).not.toHaveBeenCalled();
        });

        it('propage un échec de signature', async () => {
            await seedUser(repository, STORED_HASH);
            sign.mockRejectedValueOnce(new Error('sign failed'));

            await expect(service.login(CREDENTIALS)).rejects.toThrow('sign failed');
        });
    });

    describe('renouvellement du hachage', () => {
        beforeEach(async () => {
            await seedUser(repository, STORED_HASH);
        });

        it('ne réécrit pas un hachage à jour', async () => {
            const update = vi.spyOn(repository, 'updatePasswordHash');
            const hash = vi.spyOn(hasher, 'hash');

            await service.login(CREDENTIALS);

            expect(hash).not.toHaveBeenCalled();
            expect(update).not.toHaveBeenCalled();
        });

        it('remplace un hachage obsolète', async () => {
            vi.spyOn(hasher, 'needsRehashedPassword').mockResolvedValue(true);
            vi.spyOn(hasher, 'hash').mockResolvedValue('new-hash');

            await service.login(CREDENTIALS);

            expect(repository.users[0]?.passwordHash).toBe('new-hash');
        });

        it('ne touche pas au hachage si le mot de passe est faux', async () => {
            const update = vi.spyOn(repository, 'updatePasswordHash');
            vi.spyOn(hasher, 'needsRehashedPassword').mockResolvedValue(true);

            await expect(service.login({...CREDENTIALS, password: 'mauvais mot de passe'}))
                .rejects.toBeInstanceOf(UnauthorizedError);

            expect(update).not.toHaveBeenCalled();
        });

        it('connecte l\'utilisateur même si le renouvellement échoue', async () => {
            vi.spyOn(hasher, 'needsRehashedPassword').mockResolvedValue(true);
            vi.spyOn(repository, 'updatePasswordHash').mockRejectedValueOnce(new Error('db down'));

            await expect(service.login(CREDENTIALS)).resolves.toMatchObject({accessToken: 'signed-token'});
        });

        it('journalise l\'échec du renouvellement sans le mot de passe', async () => {
            const error = new Error('db down');
            vi.spyOn(hasher, 'needsRehashedPassword').mockResolvedValue(true);
            vi.spyOn(repository, 'updatePasswordHash').mockRejectedValueOnce(error);

            await service.login(CREDENTIALS);

            expect(warn).toHaveBeenCalledExactlyOnceWith({err: error, userId: 'user-1'}, 'Password rehash failed');
        });

        it('connecte l\'utilisateur même si le nouveau hachage échoue', async () => {
            vi.spyOn(hasher, 'needsRehashedPassword').mockResolvedValue(true);
            vi.spyOn(hasher, 'hash').mockRejectedValueOnce(new Error('out of memory'));

            await expect(service.login(CREDENTIALS)).resolves.toMatchObject({accessToken: 'signed-token'});
        });
    });

    describe('hachage leurre', () => {
        it('compare le mot de passe reçu au leurre', async () => {
            vi.spyOn(hasher, 'hash').mockResolvedValue('dummy-hash');
            const verify = vi.spyOn(hasher, 'verify');

            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);

            expect(verify).toHaveBeenCalledExactlyOnceWith(ALICE.password, 'dummy-hash');
        });

        it('ne le calcule qu\'une fois', async () => {
            const hash = vi.spyOn(hasher, 'hash');

            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);
            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);

            expect(hash).toHaveBeenCalledOnce();
        });

        it('retente le calcul après un échec', async () => {
            const hash = vi.spyOn(hasher, 'hash').mockRejectedValueOnce(new Error('out of memory'));

            await expect(service.login(CREDENTIALS)).rejects.toThrow('out of memory');
            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);

            expect(hash).toHaveBeenCalledTimes(2);
        });

        it('garde le calcul en cache une fois réussi après un échec', async () => {
            const hash = vi.spyOn(hasher, 'hash').mockRejectedValueOnce(new Error('out of memory'));

            await expect(service.login(CREDENTIALS)).rejects.toThrow('out of memory');
            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);
            await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);

            expect(hash).toHaveBeenCalledTimes(2);
        });
    });

    describe('me', () => {
        it('renvoie le profil public', async () => {
            await seedUser(repository, STORED_HASH);

            await expect(service.me('user-1')).resolves.toEqual({
                id: 'user-1',
                email: ALICE.email,
                fullName: ALICE.fullName,
                role: Role.POLICYHOLDER,
            });
        });

        it('renvoie NotFoundError pour un compte inconnu', async () => {
            await expect(service.me('inconnu')).rejects.toBeInstanceOf(NotFoundError);
        });
    });
});
