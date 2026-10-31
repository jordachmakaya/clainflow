import type {AuthUser} from "./auth.types.js";
import { SignJWT, jwtVerify, errors } from 'jose';
import {UnauthorizedError} from "../../shared/http/http-error.js";
import {Role} from "../../generated/prisma/enums.js";
const ISSUER = 'claimflow'
const AUDIENCE = 'claimflow-api'
const ALGORITHM = 'HS256'

export class TokenService {
    private readonly key: Uint8Array;
    private readonly ERROR_MESSAGES = {
      INVALID_TOKEN_MESSAGE: 'invalid token',
      EXPIRED_TOKEN_MESSAGE: 'Token expired',
    } as const;

    constructor(
        secret:string,
        private readonly ttlSeconds:number,
    ) {
        this.key = new TextEncoder().encode(secret);
    }

    async sign(user:AuthUser):Promise<string> {
        return new SignJWT({ role:user.role})
            .setProtectedHeader({ alg: ALGORITHM})
            .setSubject(user.id)
            .setIssuer(ISSUER)
            .setAudience(AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(`${this.ttlSeconds}s`)
            .sign(this.key)
    }

    async verify(token:string):Promise<AuthUser | undefined> {
        try {
            const {payload } = await jwtVerify(token, this.key, {
                algorithms: [ALGORITHM],
                issuer:ISSUER,
                audience:AUDIENCE,
            })
            const role = payload['role']
            if(!payload.sub || !isRole(role)) {
                throw new UnauthorizedError(this.ERROR_MESSAGES.INVALID_TOKEN_MESSAGE);
            }
            return { id: payload.sub, role }
        } catch(err) {
            if(err instanceof errors.JWTExpired) throw new UnauthorizedError(this.ERROR_MESSAGES.EXPIRED_TOKEN_MESSAGE)
            if(err instanceof UnauthorizedError) throw err
            throw new UnauthorizedError(this.ERROR_MESSAGES.INVALID_TOKEN_MESSAGE)
        }

        function isRole(value:unknown): value is Role {
            return typeof value === 'string' && Object.values<string>(Role).includes(value)
        }
    }


}
