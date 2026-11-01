import type {Request, RequestHandler, Response} from "express";
import {ipKeyGenerator, rateLimit} from "express-rate-limit";
import {TooManyRequestsError} from "../../shared/http/http-error.js";
import {valid} from "../../shared/http/validate.js";
import {loginSchema} from "./auth.schemas.js";

export interface AuthRateLimits {
    windowMs: number
    maxFailuresPerAccount: number
    maxFailuresPerIp: number
    maxRegistrationsPerIp: number
    maxProfileReadsPerIp: number
}

export const AUTH_RATE_LIMITS: AuthRateLimits = {
    windowMs: 15 * 60 * 1000,
    maxFailuresPerAccount: 5,
    maxFailuresPerIp: 20,
    maxRegistrationsPerIp: 20,
    maxProfileReadsPerIp: 300,
}

// ipKeyGenerator regroupe une adresse IPv6 par sous-réseau : un attaquant en possède des millions.
const clientKey = (req: Request) => ipKeyGenerator(req.ip ?? '')

function limiter(
    windowMs: number,
    limit: number,
    keyGenerator: (req: Request, res: Response) => string,
    skipSuccessfulRequests: boolean,
): RequestHandler {
    return rateLimit({
        windowMs,
        limit,
        keyGenerator,
        skipSuccessfulRequests,
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        handler: (_req, _res, next) => {
            next(new TooManyRequestsError())
        },
    })
}

// ⚠️ Compteurs en mémoire : chaque tâche Fargate compte de son côté. Il faudra un store partagé
// (Redis) ou une règle AWS WAF pour une limite globale.
export function createAuthRateLimiters(limits: AuthRateLimits) {
    const {windowMs, maxFailuresPerAccount, maxFailuresPerIp, maxRegistrationsPerIp, maxProfileReadsPerIp} = limits

    return {
        // Avant la validation : une requête invalide compte aussi, et aucune n'atteint scrypt au-delà de la limite.
        registerPerIp: limiter(windowMs, maxRegistrationsPerIp, clientKey, false),
        // Seuls les échecs comptent : des assurés derrière la même IP doivent pouvoir se reconnecter.
        loginPerIp: limiter(windowMs, maxFailuresPerIp, clientKey, true),
        // Après la validation : l'email normalisé empêche de contourner la limite en changeant sa casse.
        // Le couple email + IP évite qu'un inconnu puisse bloquer le compte de quelqu'un d'autre.
        loginPerAccount: limiter(
            windowMs,
            maxFailuresPerAccount,
            (req, res) => `${clientKey(req)}:${valid(res.locals, 'body', loginSchema).email}`,
            true,
        ),
        // Avant le token : une requête sans token valide compte aussi. Large, car un client lit ce profil souvent.
        profileReadsPerIp: limiter(windowMs, maxProfileReadsPerIp, clientKey, false),
    }
}
