import type {Role} from "../../generated/prisma/enums.js";

export interface AuthUser{
    id: string;
    role: Role;
}

declare global {
    namespace Express {
        interface Locals {
            auth?: AuthUser;
        }
    }
}