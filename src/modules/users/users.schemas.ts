import {z} from "zod"
import {Role} from "../../generated/prisma/enums.js";
import type {User} from "../../generated/prisma/client.js";
import {paginationSchema} from "../../shared/http/pagination.js";

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
export const passwordSchema = z.string().min(12).max(128)
export const fullNameSchema = z.string().trim().min(1).max(200)

export const createStaffSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    fullName: fullNameSchema,
    // Un admin crée le personnel ; les assurés s'inscrivent eux-mêmes (POST /auth/register).
    role: z.enum([Role.HANDLER,Role.ADMIN,Role.EXPERT])
})

export type CreateStaffInput = z.infer<typeof createStaffSchema>

export const listUserQuerySchema = paginationSchema.extend({
    role: z.enum(Role)
})

export interface PublicUser{
    id: string
    email: string
    fullName: string
    role: Role
}

export function toPublicUser(user:User):PublicUser{
    return {id:user.id, email: user.email, fullName:user.fullName, role:user.role}
}