import type { RequestHandler, Response } from 'express';
import type { Role } from '../../generated/prisma/enums.js';
import { ForbiddenError, UnauthorizedError } from '../../shared/http/http-error.js';
import type { AuthUser } from './auth.types.js';
import type { TokenService } from './token-service.js';

export function authenticate(token: TokenService): RequestHandler {
    return async (req, res,next) => {
        const headers = req.headers.authorization;
        if(!headers?.startsWith('Bearer ')) throw new UnauthorizedError('Please Authenticate');
        res.locals.auth = await token.verify(headers.slice('Bearer '.length));
        next()
    }
}

export function authorize(...roles:Role[]):RequestHandler{
    return (_req, res, next) => {
        const user: AuthUser = currentUser(res)
        const isValidAuthUser = roles.includes(user.role)
        if(!isValidAuthUser) throw new ForbiddenError();
        next()
    }
}

export function currentUser(res:Response): AuthUser{
    const user: AuthUser | undefined = res.locals.auth
    if(!user) throw new UnauthorizedError()
        return user;
}