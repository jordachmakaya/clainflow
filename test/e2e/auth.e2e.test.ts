import {beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../src/generated/prisma/enums.js";
import {loginSchema, registerSchema} from "../../src/modules/auth/auth.schemas.js";
import {ScryptPasswordHasher} from "../../src/modules/auth/password-hasher.js";
import {ConflictError, NotFoundError, UnauthorizedError} from "../../src/shared/http/http-error.js";
import {ALICE, createAuthStack, passwordOfLength, seedUser} from "../modules/auth/auth.fakes.js";

// 🔁 Circuit complet sans HTTP (aucune route auth n'existe encore) :
// entrée brute → schéma → AuthService → vrai scrypt + vrai JWT, dépôt en mémoire.
describe('circuit d\'authentification', () => {
    let stack: ReturnType<typeof createAuthStack>;

    const register = (raw: unknown) => stack.service.register(registerSchema.parse(raw));
    const login = (raw: unknown) => stack.service.login(loginSchema.parse(raw));
    const credentials = {email: ALICE.email, password: ALICE.password};

    beforeEach(() => {
        stack = createAuthStack();
    });

    it('inscrit, authentifie puis retrouve le compte', async () => {
        const registered = await register(ALICE);
        const auth = await stack.tokens.verify(registered.accessToken);
        const profile = await stack.service.me(auth?.id ?? '');

        expect(auth).toEqual({id: 'user-1', role: Role.POLICYHOLDER});
        expect(profile).toEqual(registered.user);

        const session = await login(credentials);

        expect(session?.user).toEqual(registered.user);
        await expect(stack.tokens.verify(session?.accessToken ?? '')).resolves.toEqual(auth);
    });

    it('reconnaît un email saisi autrement', async () => {
        await register({...ALICE, email: '  Alice@ClaimFlow.TEST '});

        const session = await login({...credentials, email: 'ALICE@claimflow.test'});

        expect(session?.user.email).toBe(ALICE.email);
    });

    it('laisse se connecter après un mot de passe faux', async () => {
        await register(ALICE);

        await expect(login({...credentials, password: 'mauvais mot de passe'}))
            .rejects.toBeInstanceOf(UnauthorizedError);

        await expect(login(credentials)).resolves.toMatchObject({user: {email: ALICE.email}});
    });

    it('refuse un email inconnu', async () => {
        await expect(login(credentials)).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it('garde le premier mot de passe après une inscription en double', async () => {
        await register(ALICE);

        await expect(register({...ALICE, password: 'autre mot de passe long'}))
            .rejects.toBeInstanceOf(ConflictError);

        await expect(login(credentials)).resolves.toMatchObject({user: {email: ALICE.email}});
    });

    it('connecte avec un mot de passe de longueur maximale', async () => {
        const password = passwordOfLength(128);
        await register({...ALICE, password});

        await expect(login({...credentials, password})).resolves.toMatchObject({user: {email: ALICE.email}});
    });

    it('conserve le hachage d\'un compte à jour', async () => {
        await register(ALICE);
        const before = stack.repository.users[0]?.passwordHash;

        await login(credentials);

        expect(stack.repository.users[0]?.passwordHash).toBe(before);
    });

    it('renforce un hachage ancien une seule fois', async () => {
        await register(ALICE);
        const legacy = stack.repository.users[0]?.passwordHash ?? '';
        const upgraded = createAuthStack(new ScryptPasswordHasher(15), stack.repository);

        await upgraded.service.login(credentials);
        const rehashed = stack.repository.users[0]?.passwordHash ?? '';
        await upgraded.service.login(credentials);

        expect(rehashed.startsWith('scrypt$15$')).toBe(true);
        expect(rehashed).not.toBe(legacy);
        expect(stack.repository.users[0]?.passwordHash).toBe(rehashed);
    });

    it('connecte même si la base refuse le renforcement', async () => {
        await register(ALICE);
        const upgraded = createAuthStack(new ScryptPasswordHasher(15), stack.repository);
        vi.spyOn(stack.repository, 'updatePasswordHash').mockRejectedValueOnce(new Error('db down'));

        await expect(upgraded.service.login(credentials))
            .resolves.toMatchObject({user: {email: ALICE.email}});
    });

    it('invalide le profil d\'un compte supprimé malgré un token valide', async () => {
        const {accessToken} = await register(ALICE);
        const auth = await stack.tokens.verify(accessToken);
        stack.repository.users.length = 0;

        await expect(stack.service.me(auth?.id ?? '')).rejects.toBeInstanceOf(NotFoundError);
    });

    it('signe le rôle enregistré pour le personnel', async () => {
        const hash = await stack.hasher.hash(ALICE.password);
        await seedUser(stack.repository, hash, {role: Role.EXPERT});

        const session = await login(credentials);

        await expect(stack.tokens.verify(session?.accessToken ?? ''))
            .resolves.toEqual({id: 'user-1', role: Role.EXPERT});
    });
});
