import {z} from 'zod';
import {emailSchema, isSafeText, passwordSchema, type PublicUser} from "../users/users.schemas.js";

export const registerSchema = z.object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2).max(120).refine(isSafeText, 'Invalid character'),
})

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
    email: emailSchema,
    // Pas de longueur minimale ici : on ne révèle rien de la politique au moment du login.
    // Le plafond reprend celui de passwordSchema et protège scrypt des entrées géantes.
    password: z.string().min(1).max(128),
})

export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthResponse {
    accessToken: string;
    tokenType: string;
    expiresIn: number;
    user:PublicUser
}