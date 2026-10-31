import type {Request, Response} from "express";
import {describe, expect, it, vi} from "vitest";
import {z} from "zod";
import {BadRequestError} from "../../../src/shared/http/http-error.js";
import {valid, validate} from "../../../src/shared/http/validate.js";

const schema = z.object({age: z.coerce.number().int(), name: z.string().optional()});

function run(part: 'body' | 'query' | 'params', input: unknown, locals: Record<string, unknown> = {}) {
    const next = vi.fn();
    const res = {locals} as unknown as Response;

    validate(part, schema)({[part]: input} as unknown as Request, res, next);

    return {locals, next};
}

function validationError(input: unknown): BadRequestError {
    try {
        run('body', input);
    } catch (err) {
        return err as BadRequestError;
    }
    throw new Error('validate should have thrown');
}

describe('validate', () => {
    it.each(['body', 'query', 'params'] as const)('range le résultat converti de %s dans res.locals', (part) => {
        const {locals, next} = run(part, {age: '42'});

        expect(locals.valid).toEqual({[part]: {age: 42}});
        expect(next).toHaveBeenCalledOnce();
    });

    it('supprime les champs inconnus du schéma', () => {
        const {locals} = run('body', {age: 1, admin: true});

        expect(locals.valid).toEqual({body: {age: 1}});
    });

    it('conserve les parties déjà validées', () => {
        const {locals} = run('query', {age: 2}, {valid: {params: {age: 1}}});

        expect(locals.valid).toEqual({params: {age: 1}, query: {age: 2}});
    });

    it('lève BadRequestError sans appeler next quand la validation échoue', () => {
        const next = vi.fn();
        const res = {locals: {}} as unknown as Response;
        const middleware = validate('body', schema);

        expect(() => middleware({body: {age: 'abc'}} as unknown as Request, res, next))
            .toThrow(BadRequestError);
        expect(next).not.toHaveBeenCalled();
        expect(res.locals).toEqual({});
    });

    it('détaille chaque champ invalide', () => {
        const error = validationError({age: 'abc', name: 1});

        expect(error.message).toBe('Validation failed');
        expect(error.details).toEqual([
            {part: 'age', message: expect.any(String)},
            {part: 'name', message: expect.any(String)},
        ]);
    });
});

describe('valid', () => {
    it('relit ce que validate a rangé', () => {
        const {locals} = run('body', {age: '42'});

        expect(valid(locals, 'body', schema)).toEqual({age: 42});
    });

    it('renvoie undefined si rien n\'a été validé', () => {
        expect(valid({}, 'body', schema)).toBeUndefined();
    });
});
