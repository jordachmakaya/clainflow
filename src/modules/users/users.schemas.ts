import {z} from "zod"
import {Role} from "../../generated/prisma/enums.js";
import type {User} from "../../generated/prisma/client.js";
import {paginationSchema} from "../../shared/http/pagination.js";
import {isWeakPassword} from "./password-policy.js";

// Caractères de contrôle, séparateurs de ligne et marques de direction : ils falsifient journaux et affichage.
const UNSAFE_TEXT = /[\p{Cc}\u061C\u200E\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u

export const isSafeText = (value: string) => !UNSAFE_TEXT.test(value)

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email())
// L'octet nul est interdit : scrypt ne distingue pas "secret" de "secret\0" (voir ScryptPasswordHasher.verify).
export const passwordSchema = z.string().min(12).max(128)
    .refine((value) => !value.includes('\0'), 'Invalid character')
    .refine((value) => !isWeakPassword(value), 'Password is too weak')
export const fullNameSchema = z.string().trim().min(1).max(200).refine(isSafeText, 'Invalid character')

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