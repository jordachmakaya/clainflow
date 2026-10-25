import type {z} from "zod"
import type { RequestHandler } from 'express';
import {BadRequestError} from "./http-error.js";

// Les parties de la requête qu'on sait valider.
type Part  = 'body' |'query' | 'params'

// 🧹 Middleware de validation : l'équivalent Express du ValidationPipe de NestJS.
// Le résultat validé (converti, nettoyé) est rangé dans res.locals.valid[part].
export function  validate<TSchema extends z.ZodType>(part:Part, schema:TSchema):RequestHandler {
    return (req,res,next)=>{
        const result = schema.safeParse(req[part])
        if(!result.success){
            throw new BadRequestError(
               "Validation failed",
                result.error.issues.map((i) => ({part: i.path.join("."), message: i.message}))
            )
        }
        const store = (res.locals.valid ??= {}) as Record<string, unknown>;
        store[part] = result.data;
        next()
    }
}

// Lecture typée de ce que validate() a rangé (évite les "as" dans chaque route).
export function valid<TSchema extends z.ZodType>(
    locals:Record<string, unknown>,
    part:Part,
    _schema:TSchema
): z.output<TSchema>{
    const store = locals.valid as Record<string, unknown> | undefined;
    return store?.[part] as z.output<TSchema>;
}
