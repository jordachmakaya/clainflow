import type {RequestHandler,ErrorRequestHandler} from "express";
import type {Logger} from "pino";
import {ConflictError} from "./http-error.js";



export interface ErrorBody{
    statusCode:number;
    message:string;
    details?:unknown;
}

export const notFoundHandler: RequestHandler = (req, res) => {
    const body : ErrorBody = { statusCode: 404, message : `Route ${req.method} ${req.path} not found`}
    res.status(404).json(body);
}

// 🧯 Gestionnaire d'erreurs
// Express 5 y envoie aussi les erreurs des handlers async (promesse rejetée).
export function errorHandler(logger: Logger): ErrorRequestHandler{
    return (error:unknown, _req,res, _next) => {
        if (error instanceof ConflictError) {

            const body : ErrorBody = {
                statusCode: error.statusCode,
                message:error.message
            }

            if(error.details !== undefined ) {
                body.details = error.details;
           }
            res.status(error.statusCode).json(body);
            return
        };

        if (error instanceof SyntaxError && `status` in error && error.status === 400){
            res.status(400).json({statusCode:400, message:"invalid JSON body"} satisfies ErrorBody ) ;
            return;
        }
        logger.error({error}, 'Unhandled error');
        // 🔒 Jamais de détail technique vers le client.
        res.status(500).json({ statusCode: 500, message: 'Internal server error' } satisfies ErrorBody);
    }
}