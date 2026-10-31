import {describe, expect, it} from "vitest";
import {Prisma} from "../../../src/generated/prisma/client.js";
import {
    isPrismaError,
    PrismaErrorCode,
    toHttpError,
} from "../../../src/shared/database/prisma-errors.js";

const SENSITIVE = 'Invalid `prisma.user.create()` at users_email_key on host db.internal';

function known(code: string) {
    return new Prisma.PrismaClientKnownRequestError(SENSITIVE, {
        code,
        clientVersion: 'test',
        meta: {target: ['email'], modelName: 'User'},
    });
}

describe('isPrismaError', () => {
    it('reconnaît le code demandé', () => {
        expect(isPrismaError(known('P2002'), PrismaErrorCode.UNIQUE_VIOLATION)).toBe(true);
    });

    it('refuse un autre code', () => {
        expect(isPrismaError(known('P2025'), PrismaErrorCode.UNIQUE_VIOLATION)).toBe(false);
    });

    it.each([
        ['une erreur classique', new Error('P2002')],
        ['un objet qui imite Prisma', {code: 'P2002'}],
        ['undefined', undefined],
    ])('refuse %s', (_label, error) => {
        expect(isPrismaError(error, PrismaErrorCode.UNIQUE_VIOLATION)).toBe(false);
    });
});

describe('toHttpError', () => {
    it.each([
        ['P2002', 409, 'Resource already exists'],
        ['P2003', 409, 'Operation conflicts with a related resource'],
        ['P2034', 409, 'Operation conflicted with another request, please try again'],
        ['P2025', 404, 'Resource not found'],
        ['P2007', 400, 'Invalid value'],
        ['P2020', 400, 'Invalid value'],
        ['P2039', 400, 'Invalid value'],
        ['P1000', 503, 'Service temporarily unavailable'],
        ['P1001', 503, 'Service temporarily unavailable'],
        ['P1003', 503, 'Service temporarily unavailable'],
        ['P2024', 503, 'Service temporarily unavailable'],
        ['P2028', 503, 'Service temporarily unavailable'],
    ])('traduit %s en %d', (code, statusCode, message) => {
        expect(toHttpError(known(code))).toMatchObject({statusCode, message});
    });

    it('couvre tous les codes déclarés', () => {
        for (const code of Object.values(PrismaErrorCode)) {
            expect(toHttpError(known(code))).toBeDefined();
        }
    });

    it('ne reprend ni le message ni les métadonnées de Prisma', () => {
        for (const code of Object.values(PrismaErrorCode)) {
            const error = toHttpError(known(code));

            expect(JSON.stringify({message: error?.message, details: error?.details}))
                .not.toMatch(/prisma\.user|users_email_key|db\.internal/);
        }
    });

    it('traduit un échec d\'initialisation en 503', () => {
        const error = new Prisma.PrismaClientInitializationError(SENSITIVE, 'test');

        expect(toHttpError(error)).toMatchObject({statusCode: 503});
    });

    it('laisse passer un code inconnu', () => {
        expect(toHttpError(known('P9999'))).toBeUndefined();
    });

    it('laisse passer une erreur de validation : c\'est un bug du code', () => {
        const error = new Prisma.PrismaClientValidationError(SENSITIVE, {clientVersion: 'test'});

        expect(toHttpError(error)).toBeUndefined();
    });

    it.each([
        ['une erreur classique', new Error('boom')],
        ['un objet qui imite Prisma', {code: 'P2002'}],
        ['null', null],
    ])('ignore %s', (_label, error) => {
        expect(toHttpError(error)).toBeUndefined();
    });
});
