import type {PolicyService} from "./policies.service.js";
import {Router} from "express";
import {authorize, currentUser} from "../auth/auth.middleware.js";
import {Role} from "../../generated/prisma/enums.js";
import {valid, validate} from "../../shared/http/validate.js";
import {createPolicySchema, policyIDParamSchema, type PolicyResponse} from "./policies.schemas.js";
import type {AuthUser} from "../auth/auth.types.js";
import {paginationSchema} from "../../shared/http/pagination.js";

export function createPoliciesRouter(policy:PolicyService): Router{
    const router = Router()



    router.post(
        '/',
        authorize(Role.ADMIN),
        validate('body', createPolicySchema),
        async (_req, res) => {
            const validPolicy = valid(res.locals, 'body', createPolicySchema)
            const newPolicyCreated :PolicyResponse = await policy.create(validPolicy)
            res.status(201).json(newPolicyCreated);
        },
    );

    router.get(
        '/',
        validate('query',paginationSchema),
        async (req, res) => {
            const authorizedUser : AuthUser = currentUser(res)
            const pagination = valid(res.locals, 'query', paginationSchema);
            const policyList = await policy.list(authorizedUser, pagination)
            res.status(200).json(policyList)
        }
    )

    router.get(
        '/:policyId',
        validate('params', policyIDParamSchema),
        async (_req, res) => {
            const {policyId} = valid(res.locals, 'params', policyIDParamSchema)
            const authorizedUser : AuthUser = currentUser(res)
            const storedPolicy:PolicyResponse = await policy.get(authorizedUser, policyId)
            res.status(200).json(storedPolicy)

        }
    )

    return router;
}