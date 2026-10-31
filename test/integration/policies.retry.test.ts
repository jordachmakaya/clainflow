import {randomUUID} from "node:crypto";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {PolicyProduct, Role} from "../../src/generated/prisma/enums.js";
import {PrismaPolicyRepository} from "../../src/modules/policies/policies.repository.js";
import {PolicyService} from "../../src/modules/policies/policies.service.js";
import {PrismaUserRepository} from "../../src/modules/users/users.repository.js";
import {createPrimaClient} from "../../src/shared/database/prisma.js";
import {toHttpError} from "../../src/shared/database/prisma-errors.js";
import {referenceCode} from "../../src/shared/ids/reference.js";
import {fixedClock} from "../../src/shared/time/clock.js";

// Seul le tirage du numéro est piloté, pour provoquer la collision à coup sûr.
// La violation d'unicité vient bien de PostgreSQL, à travers l'adaptateur pg.
vi.mock('../../src/shared/ids/reference.js', () => ({referenceCode: vi.fn()}));

function databaseUrl() {
    const url = process.env['DATABASE_URL'];
    if (!url) throw new Error('DATABASE_URL est requis pour les tests d\'intégration');
    // Ces tests écrivent réellement en base : jamais ailleurs qu'en local.
    if (new URL(url).hostname !== 'localhost') throw new Error('Tests d\'intégration refusés hors de localhost');
    return url;
}

const newNumber = () => `HAB-TEST-${randomUUID()}`;

describe('souscription sur PostgreSQL : collision de numéro', () => {
    const prisma = createPrimaClient(databaseUrl());
    const service = new PolicyService(
        new PrismaPolicyRepository(prisma),
        new PrismaUserRepository(prisma),
        fixedClock('2026-03-02T10:00:00.000Z'),
    );
    const draw = vi.mocked(referenceCode);

    let holderId: string;
    let input: Parameters<PolicyService['create']>[0];
    let taken: string;

    const storedNumbers = async () => {
        const policies = await prisma.policy.findMany({where: {holderId}});
        return policies.map((policy) => policy.number).sort();
    };

    beforeAll(async () => {
        await prisma.$connect();
    });

    beforeEach(async () => {
        draw.mockReset();

        const holder = await prisma.user.create({
            data: {
                email: `${randomUUID()}@integration.test`,
                passwordHash: 'hashed:secret',
                fullName: 'Assuré Intégration',
                role: Role.POLICYHOLDER,
            },
        });
        holderId = holder.id;
        input = {
            holderId,
            product: PolicyProduct.HOME,
            coverageStart: new Date('2026-01-01T00:00:00.000Z'),
            coverageEnd: new Date('2026-12-31T00:00:00.000Z'),
            deductible: 15_000,
        };

        taken = newNumber();
        await prisma.policy.create({data: {...input, number: taken}});
    });

    afterEach(async () => {
        await prisma.policy.deleteMany({where: {holderId}});
        await prisma.user.delete({where: {id: holderId}});
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('retire un numéro après une vraie violation d\'unicité', async () => {
        const fresh = newNumber();
        draw.mockReturnValueOnce(taken).mockReturnValueOnce(fresh);

        const created = await service.create(input);

        expect(created.number).toBe(fresh);
        expect(draw).toHaveBeenCalledTimes(2);
        await expect(storedNumbers()).resolves.toEqual([fresh, taken].sort());
    });

    it('réussit au dernier essai', async () => {
        const fresh = newNumber();
        draw
            .mockReturnValueOnce(taken)
            .mockReturnValueOnce(taken)
            .mockReturnValueOnce(taken)
            .mockReturnValueOnce(taken)
            .mockReturnValueOnce(fresh);

        await expect(service.create(input)).resolves.toMatchObject({number: fresh});
    });

    it('abandonne après cinq collisions avec une 409, sans rien écrire', async () => {
        draw.mockReturnValue(taken);

        const error: unknown = await service.create(input).catch((reason: unknown) => reason);

        expect(draw).toHaveBeenCalledTimes(5);
        expect(toHttpError(error)).toMatchObject({statusCode: 409, message: 'Resource already exists'});
        await expect(storedNumbers()).resolves.toEqual([taken]);
    });

    it('départage deux souscriptions simultanées sur le même numéro', async () => {
        const contested = newNumber();
        const fresh = newNumber();
        draw
            .mockReturnValueOnce(contested)
            .mockReturnValueOnce(contested)
            .mockReturnValueOnce(fresh);

        const created = await Promise.all([service.create(input), service.create(input)]);

        expect(created.map((policy) => policy.number).sort()).toEqual([contested, fresh].sort());
        await expect(storedNumbers()).resolves.toEqual([contested, fresh, taken].sort());
    });
});
