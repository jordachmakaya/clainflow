import {describe, expect, it} from "vitest";
import {
    BadRequestError,
    ConflictError,
    HttpError,
    NotFoundError,
    PayloadToLargeError,
    UnauthorizedError,
    UnprocessableEntityError,
    UnsupportedMediaTypeError,
} from "../../../src/shared/http/http-error.js";

describe('HttpError', () => {
    it('conserve le statut, le message et les détails', () => {
        const error = new HttpError(418, 'teapot', {reason: 'tea'});

        expect(error).toBeInstanceOf(Error);
        expect(error.statusCode).toBe(418);
        expect(error.message).toBe('teapot');
        expect(error.details).toEqual({reason: 'tea'});
    });

    it.each([
        ['BadRequestError', () => new BadRequestError(undefined, undefined), 400, 'Bad Request'],
        ['UnauthorizedError', () => new UnauthorizedError(), 401, 'Unauthorized'],
        ['NotFoundError', () => new NotFoundError(), 404, 'Not Found'],
        ['ConflictError', () => new ConflictError(), 409, 'Conflict'],
        ['PayloadToLargeError', () => new PayloadToLargeError(), 413, 'Payload is to large'],
        ['UnsupportedMediaTypeError', () => new UnsupportedMediaTypeError(), 415, 'Unsupported Media type'],
        ['UnprocessableEntityError', () => new UnprocessableEntityError(), 422, 'Unprocessable Entity'],
    ])('%s a le bon statut et le bon message par défaut', (name, create, statusCode, message) => {
        const error = create();

        expect(error).toBeInstanceOf(HttpError);
        expect(error.name).toBe(name);
        expect(error.statusCode).toBe(statusCode);
        expect(error.message).toBe(message);
    });

    it.each([
        ['UnauthorizedError', () => new UnauthorizedError('custom')],
        ['NotFoundError', () => new NotFoundError('custom')],
        ['ConflictError', () => new ConflictError('custom')],
        ['PayloadToLargeError', () => new PayloadToLargeError('custom')],
        ['UnsupportedMediaTypeError', () => new UnsupportedMediaTypeError('custom')],
    ])('%s accepte un message personnalisé', (_name, create) => {
        expect(create().message).toBe('custom');
    });

    it('BadRequestError transporte les détails', () => {
        const details = [{part: 'email', message: 'required'}];

        expect(new BadRequestError('Invalid', details).details).toEqual(details);
    });


    it('UnprocessableEntityError transporte les détails', () => {
        const details = [{part: 'amount', message: 'too high'}];

        expect(new UnprocessableEntityError('Invalid', details).details).toEqual(details);
    });
});
