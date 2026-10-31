import type {Logger} from "pino";
import {Role} from "../../../src/generated/prisma/enums.js";
import {AuthService} from "../../../src/modules/auth/auth.service.js";
import {type PasswordHasher, ScryptPasswordHasher} from "../../../src/modules/auth/password-hasher.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import type {BreachChecker} from "../../../src/modules/users/breached-password.js";
import {UsersService} from "../../../src/modules/users/users.service.js";
import {InMemoryUserRepository, noBreaches} from "../users/users.fakes.js";

export const SECRET = 'test-secret-of-at-least-32-characters';
export const TTL_SECONDS = 3600;

export const ALICE = {
    email: 'alice@claimflow.test',
    password: 'correct horse battery',
    fullName: 'Alice Durand',
};

/** Mot de passe solide de la longueur voulue (éviter les multiples de 22, qui forment un motif répété). */
export const passwordOfLength = (length: number) => `${ALICE.password} `.repeat(500).slice(0, length);

export function seedUser(
    repository: InMemoryUserRepository,
    passwordHash: string,
    overrides: {email?: string, role?: Role} = {},
) {
    return repository.create({
        email: overrides.email ?? ALICE.email,
        fullName: ALICE.fullName,
        role: overrides.role ?? Role.POLICYHOLDER,
        passwordHash,
    });
}

// Tout est réel sauf la base : scrypt au coût minimal pour garder des tests rapides.
export function createAuthStack(
    hasher: PasswordHasher = new ScryptPasswordHasher(14),
    repository = new InMemoryUserRepository(),
    breaches: BreachChecker = noBreaches,
) {
    const tokens = new TokenService(SECRET, TTL_SECONDS);
    const service = new AuthService(
        repository,
        new UsersService(repository, hasher, breaches),
        hasher,
        tokens,
        TTL_SECONDS,
        {warn: () => undefined} as unknown as Logger,
    );
    return {service, repository, hasher, tokens};
}
