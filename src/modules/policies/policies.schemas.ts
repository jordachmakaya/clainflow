import {z} from 'zod';
import {formatDateOnly, parseDateOnly} from "../../shared/time/calendar.js";
import {PolicyProduct} from "../../generated/prisma/enums.js";
import type {Policy} from "../../generated/prisma/client.js";

// 📅 Une date seule "YYYY-MM-DD", convertie en Date (minuit UTC). Réutilisée par les sinistres.
export const dateOnlySchema = z.iso.date().transform(parseDateOnly);

// 💶 Montant en CENTIMES : entier, positif ou nul, plafonné à ce que la colonne Int peut stocker
export const amountCentimeSchema = z.number().int().min(0).max(2_147_483_647);

export const createPolicySchema = z.object({
    holderId:z.uuid(),
    product:z.enum(PolicyProduct),
    coverageStart:dateOnlySchema,
    coverageEnd:dateOnlySchema,
    deductible: amountCentimeSchema,
}).refine((p) => p.coverageEnd > p.coverageStart, {
    message: 'coverage end must be after coverage start',
    path:['coverageEnd'],
    // Zod lance ce contrôle même si une date est invalide : il ajouterait un faux message.
    when: (payload) => payload.issues.length === 0,
})

export type CreatePolicyInput = z.infer<typeof createPolicySchema>;
export const policyIDParamSchema = z.object({policyId:z.uuid()});

// Réponse API : les dates seules repartent au format "YYYY-MM-DD" (pas d'heure trompeuse).
export interface PolicyResponse {
    id: string;
    number:string
    product:PolicyProduct
    holderId:string
    coverageStart:string
    coverageEnd:string
    deductible:number
}

export function toPolicyResponse(policy: Policy):PolicyResponse {
    return {
        id:policy.id,
        number:policy.number,
        product:policy.product,
        holderId:policy.holderId,
        coverageStart:formatDateOnly(policy.coverageStart),
        coverageEnd:formatDateOnly(policy.coverageEnd),
        deductible:policy.deductible

    }
}