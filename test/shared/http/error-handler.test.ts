import express from "express";
import {pino, type Logger} from "pino";
import request from "supertest";
import {describe, expect, it, vi} from "vitest";
import {errorHandler} from "../../../src/shared/http/error-handler.js";
import {
    BadRequestError,
    ConflictError,
    NotFoundError,
    UnauthorizedError,
} from "../../../src/shared/http/http-error.js";

function appThrowing(error: unknown, logger: Logger = {error: vi.fn()} as unknown as Logger) {
    const app = express();
    app.get('/boom', () => {
        throw error;
    });
    app.use(errorHandler(logger));
    return app;
}

describe('errorHandler', () => {
    it('renvoie le statut et le message d\'une ConflictError', async () => {
        await request(appThrowing(new ConflictError('Already exists')))
            .get('/boom')
            .expect(409, {statusCode: 409, message: 'Already exists'});
    });

    it('inclut les détails quand il y en a', async () => {
        const error = new ConflictError('Already exists');
        Object.defineProperty(error, 'details', {value: {field: 'email'}});

        await request(appThrowing(error))
            .get('/boom')
            .expect(409, {statusCode: 409, message: 'Already exists', details: {field: 'email'}});
    });

    it('capture les promesses rejetées des handlers async', async () => {
        const app = express();
        app.get('/boom', async () => {
            throw new ConflictError();
        });
        app.use(errorHandler({error: vi.fn()} as unknown as Logger));

        await request(app).get('/boom').expect(409);
    });

    it('renvoie 500 sans détail technique pour une erreur inconnue', async () => {
        const logger = {error: vi.fn()} as unknown as Logger;

        await request(appThrowing(new Error('db password leaked'), logger))
            .get('/boom')
            .expect(500, {statusCode: 500, message: 'Internal server error'});
        expect(logger.error).toHaveBeenCalledOnce();
    });

    it('traite une SyntaxError sans statut 400 comme une erreur interne', async () => {
        await request(appThrowing(new SyntaxError('bad code')))
            .get('/boom')
            .expect(500);
    });


    it.each([
        ['BadRequestError', new BadRequestError('Validation failed', [{part: 'age', message: 'required'}]), 400],
        ['UnauthorizedError', new UnauthorizedError(), 401],
        ['NotFoundError', new NotFoundError(), 404],
    ])('renvoie le statut de %s', async (_name, error, statusCode) => {
        await request(appThrowing(error)).get('/boom').expect(statusCode);
    });


    it('journalise le message de l\'erreur inconnue', async () => {
        const lines: string[] = [];
        const logger = pino({}, {write: (line: string) => lines.push(line)});

        await request(appThrowing(new Error('db connection lost'), logger)).get('/boom').expect(500);

        expect(lines.join('')).toContain('db connection lost');
    });
});
