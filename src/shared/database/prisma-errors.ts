import {Prisma} from "../../generated/prisma/client.js";
import {
    BadRequestError,
    ConflictError,
    type HttpError,
    NotFoundError,
    ServiceUnavailableError,
} from "../http/http-error.js";

/** Codes Prisma traités par l'API. Toutes les valeurs ont été observées avec l'adaptateur pg, sauf mention contraire. */
export const PrismaErrorCode = {
    AUTHENTICATION_FAILED: 'P1000',
    DATABASE_UNREACHABLE: 'P1001',
    DATABASE_NOT_FOUND: 'P1003',
    UNIQUE_VIOLATION: 'P2002',
    FOREIGN_KEY_VIOLATION: 'P2003',
    INVALID_VALUE: 'P2007',
    VALUE_OUT_OF_RANGE: 'P2020',
    /** Non observé : documenté par Prisma pour un pool de connexions saturé. */
    POOL_TIMEOUT: 'P2024',
    RECORD_NOT_FOUND: 'P2025',
    TRANSACTION_TIMEOUT: 'P2028',
    /** Non observé : documenté par Prisma pour un conflit d'écriture ou un interblocage. */
    TRANSACTION_CONFLICT: 'P2034',
    INVALID_CHARACTER: 'P2039',
} as const;

export type PrismaErrorCode = (typeof PrismaErrorCode)[keyof typeof PrismaErrorCode];

/** Vrai si `error` est une erreur Prisma portant ce code. */
export function isPrismaError(error: unknown, code: PrismaErrorCode): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

function fromCode(code: string): HttpError | undefined {
    switch (code) {
        case PrismaErrorCode.UNIQUE_VIOLATION:
            return new ConflictError('Resource already exists');
        case PrismaErrorCode.FOREIGN_KEY_VIOLATION:
            return new ConflictError('Operation conflicts with a related resource');
        case PrismaErrorCode.TRANSACTION_CONFLICT:
            return new ConflictError('Operation conflicted with another request, please try again');
        case PrismaErrorCode.RECORD_NOT_FOUND:
            return new NotFoundError('Resource not found');
        case PrismaErrorCode.INVALID_VALUE:
        case PrismaErrorCode.VALUE_OUT_OF_RANGE:
        case PrismaErrorCode.INVALID_CHARACTER:
            return new BadRequestError('Invalid value');
        case PrismaErrorCode.AUTHENTICATION_FAILED:
        case PrismaErrorCode.DATABASE_UNREACHABLE:
        case PrismaErrorCode.DATABASE_NOT_FOUND:
        case PrismaErrorCode.POOL_TIMEOUT:
        case PrismaErrorCode.TRANSACTION_TIMEOUT:
            return new ServiceUnavailableError();
        default:
            return undefined;
    }
}

/**
 * Traduit une erreur Prisma en erreur HTTP, avec un message générique : `error.message` et
 * `error.meta` contiennent des noms de tables et de colonnes qui ne doivent jamais sortir de l'API.
 * Renvoie undefined pour le reste, dont PrismaClientValidationError : c'est un bug du code, pas une
 * erreur du client, et elle doit rester une 500.
 */
export function toHttpError(error: unknown): HttpError | undefined {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return fromCode(error.code);
    if (error instanceof Prisma.PrismaClientInitializationError) return new ServiceUnavailableError();
    return undefined;
}
