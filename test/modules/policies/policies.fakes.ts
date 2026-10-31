import express from "express";
import helmet from "helmet";
import type {Logger} from "pino";
import {vi} from "vitest";
import {Prisma} from "../../../src/generated/prisma/client.js";
import {PolicyProduct, Role} from "../../../src/generated/prisma/enums.js";
import {authenticate} from "../../../src/modules/auth/auth.middleware.js";
import {TokenService} from "../../../src/modules/auth/token-service.js";
import type {NewPolicy, Policy, PolicyRepository} from "../../../src/modules/policies/policies.repository.js";
import {createPoliciesRouter} from "../../../src/modules/policies/policies.router.js";
import {PolicyService} from "../../../src/modules/policies/policies.service.js";
import {errorHandler, notFoundHandler} from "../../../src/shared/http/error-handler.js";
import {type PageResult, type Pagination, toSkipTake} from "../../../src/shared/http/pagination.js";
import {type Clock, fixedClock} from "../../../src/shared/time/clock.js";
import {SECRET, TTL_SECONDS} from "../auth/auth.fakes.js";
import {InMemoryUserRepository} from "../users/users.fakes.js";

export const NOW = '2026-03-02T10:00:00.000Z';

export const HOLDER_ID = '0194e6a0-0000-7000-8000-000000000001';
export const OTHER_HOLDER_ID = '0194e6a0-0000-7000-8000-000000000002';
export const ADMIN_ID = '0194e6a0-0000-7000-8000-000000000003';
export const HANDLER_ID = '0194e6a0-0000-7000-8000-000000000004';
export const EXPERT_ID = '0194e6a0-0000-7000-8000-000000000005';
export const UNKNOWN_ID = '0194e6a0-0000-7000-8000-00000000dead';

/** Corps brut, tel que le client l'envoie. */
export const POLICY_BODY = {
    holderId: HOLDER_ID,
    product: PolicyProduct.HOME,
    coverageStart: '2026-01-01',
    coverageEnd: '2026-12-31',
    deductible: 15_000,
};

/** Même contrat, après passage dans createPolicySchema. */
export const POLICY_INPUT = {
    ...POLICY_BODY,
    coverageStart: new Date('2026-01-01T00:00:00.000Z'),
    coverageEnd: new Date('2026-12-31T00:00:00.000Z'),
};

export const foreignKeyError = () => new Prisma.PrismaClientKnownRequestError(
    'Foreign key constraint violated on the constraint: `policies_holder_id_fkey`',
    {code: 'P2003', clientVersion: 'test', meta: {constraint: 'policies_holder_id_fkey'}},
);

export const uniqueNumberError = () => new Prisma.PrismaClientKnownRequestError(
    'Unique constraint failed on the fields: (`number`)',
    {code: 'P2002', clientVersion: 'test', meta: {target: ['number']}},
);

// Reproduit le comportement vérifié sur PostgreSQL : clé étrangère, unicité du numéro et tri.
export class InMemoryPolicyRepository implements PolicyRepository {
    readonly policies: Policy[] = [];

    constructor(private readonly users: InMemoryUserRepository) {}

    async create(data: NewPolicy): Promise<Policy> {
        if (!await this.users.findById(data.holderId)) throw foreignKeyError();
        if (this.policies.some((policy) => policy.number === data.number)) throw uniqueNumberError();

        const rank = this.policies.length + 1;
        const policy: Policy = {
            ...data,
            id: `0194e6a1-0000-7000-8000-${String(rank).padStart(12, '0')}`,
            createdAt: new Date(Date.parse(NOW) + rank * 1000),
        };
        this.policies.push(policy);
        return policy;
    }

    async findById(id: string): Promise<Policy | null> {
        return this.policies.find((policy) => policy.id === id) ?? null;
    }

    async list(holderId: string | undefined, pagination: Pagination): Promise<PageResult<Policy>> {
        const matches = this.policies
            .filter((policy) => holderId === undefined || policy.holderId === holderId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id));
        const {skip, take} = toSkipTake(pagination);

        return {items: matches.slice(skip, skip + take), total: matches.length};
    }
}

/** Ajoute un compte avec un identifiant fixe : les schémas exigent un UUID. */
export function seedAccount(users: InMemoryUserRepository, id: string, role: Role) {
    users.users.push({
        id,
        email: `${id}@claimflow.test`,
        passwordHash: 'hashed:secret',
        fullName: `Compte ${role}`,
        role,
        createdAt: new Date(NOW),
    });
}

// Tout est réel sauf la base : vraies routes, vrais schémas, vrai JWT.
export function createPoliciesStack(clock: Clock = fixedClock(NOW)) {
    const users = new InMemoryUserRepository();
    const policies = new InMemoryPolicyRepository(users);
    const tokens = new TokenService(SECRET, TTL_SECONDS);
    const service = new PolicyService(policies, users, clock);

    seedAccount(users, HOLDER_ID, Role.POLICYHOLDER);
    seedAccount(users, OTHER_HOLDER_ID, Role.POLICYHOLDER);
    seedAccount(users, ADMIN_ID, Role.ADMIN);
    seedAccount(users, HANDLER_ID, Role.HANDLER);
    seedAccount(users, EXPERT_ID, Role.EXPERT);

    const app = express();
    app.use(helmet());
    app.use(express.json({limit: '100kb'}));
    app.use('/policies', authenticate(tokens), createPoliciesRouter(service));
    app.use(notFoundHandler);
    app.use(errorHandler({error: vi.fn()} as unknown as Logger));

    const bearer = async (id: string, role: Role) => `Bearer ${await tokens.sign({id, role})}`;

    return {app, users, policies, tokens, service, bearer};
}
