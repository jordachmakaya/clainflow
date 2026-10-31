import type {AuthService} from "./auth.service.js";
import type {TokenService} from "./token-service.js";
import {Router} from "express";
import {valid, validate} from "../../shared/http/validate.js";
import {loginSchema, registerSchema} from "./auth.schemas.js";
import {authenticate, currentUser} from "./auth.middleware.js";


export function createAuthRouter(auth:AuthService, token:TokenService): Router{
    const router = Router()

    router.post(
        "/register",
        validate('body', registerSchema),
        async (req, res) => {
            const data = await auth.register(valid(
                res.locals,'body',registerSchema
            ))
            res.status(201)
                .json(data);
        }
    );

    router.post(
        "/login",
        validate('body', loginSchema),
        async (req, res) => {
            const data = await auth.login(
                valid(res.locals,'body',loginSchema)
            )
            res.json(data)
        }
    )

    router.get(
        '/me',
        authenticate(token),
        async (req, res) => {
            const data = await auth.me(currentUser(res).id)
            res.json(data);
        }
    )

    return router;
}