import {Prisma} from "../../../src/generated/prisma/client.js";
import type {PasswordHasher} from "../../../src/modules/auth/password-hasher.js";
import type {BreachChecker} from "../../../src/modules/users/breached-password.js";
import type {NewUser, User, UserRepository} from "../../../src/modules/users/users.repository.js";
import {type PageResult, type Pagination, toSkipTake} from "../../../src/shared/http/pagination.js";

export const uniqueEmailError = () => new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`email`)',
    {code: 'P2002', clientVersion: 'test', meta: {target: ['email']}},
);

// Reproduit le comportement vérifié sur PostgreSQL : unicité de l'email et tri par nom.
export class InMemoryUserRepository implements UserRepository {
    readonly users: User[] = [];

    async create(data: NewUser): Promise<User> {
        if (this.users.some((user) => user.email === data.email)) throw uniqueEmailError();

        const user: User = {...data, id: `user-${this.users.length + 1}`, createdAt: new Date()};
        this.users.push(user);
        return user;
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.users.find((user) => user.email === email) ?? null;
    }

    async findById(id: string): Promise<User | null> {
        return this.users.find((user) => user.id === id) ?? null;
    }

    async listByRole(role: User['role'], pagination: Pagination): Promise<PageResult<User>> {
        const matches = this.users
            .filter((user) => user.role === role)
            .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.id.localeCompare(b.id));
        const {skip, take} = toSkipTake(pagination);

        return {items: matches.slice(skip, skip + take), total: matches.length};
    }

    async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
        const user = this.users.find((candidate) => candidate.id === id);
        if (user) user.passwordHash = passwordHash;
    }
}

export const noBreaches: BreachChecker = {
    isBreached: async () => false,
};

export const fakeHasher: PasswordHasher = {
    hash: async (password) => `hashed:${password}`,
    verify: async (password, stored) => stored === `hashed:${password}`,
    needsRehashedPassword: async () => false,
};
