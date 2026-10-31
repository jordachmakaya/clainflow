import type {UsersService} from "./users.service.js";
import  {Router} from "express";
import {authorize, currentUser} from "../auth/auth.middleware.js";
import {Role} from "../../generated/prisma/enums.js";
import {ForbiddenError} from "../../shared/http/http-error.js";
import type {Page} from "../../shared/http/pagination.js";
import {valid, validate} from "../../shared/http/validate.js";
import {createStaffSchema, listUserQuerySchema, type PublicUser} from "./users.schemas.js";

export function createUserRouter(users:UsersService):Router{
    const router = Router()
    router.post(
        '/',
        authorize(Role.ADMIN),
        validate('body', createStaffSchema),
        async (req, res) => {
            const input = valid(res.locals, 'body', createStaffSchema);
            const publicUser:PublicUser = await users.createStaff(input);
            res.status(201).json(publicUser);
        }
    )

    // Un gestionnaire a besoin de la liste des experts pour en mandater un, et de rien d'autre :
    // les autres listes exposent les noms et emails des assurés et du personnel.
    router.get(
        '/',
        authorize(Role.ADMIN, Role.HANDLER),
        validate('query', listUserQuerySchema),
        async (req, res) => {
            const {role, page, pageSize} = valid(res.locals, 'query', listUserQuerySchema);
            const ForbiddenAccess = currentUser(res).role === Role.HANDLER && role !== Role.EXPERT
            if(ForbiddenAccess) throw new ForbiddenError();
            const publicUsers:Page<PublicUser> = await users.listByRole(role, {page, pageSize});
            res.json(publicUsers);
        }
    )

    return router;
}