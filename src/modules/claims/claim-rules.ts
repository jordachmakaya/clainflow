
// 📏 Règles métier de la DÉCLARATION, en fonctions pures (dates = minuit UTC, voir calendar.ts).

import {ClaimType, PolicyProduct} from "../../generated/prisma/enums.js";
import {addBusinessDays} from "../../shared/time/calendar.js";

/**
 * Délai de déclaration en jours ouvrés, à compter de la CONNAISSANCE du sinistre.
 * Règle de l'énoncé, inspirée de l'article L113-2 du Code des assurances (5 jours ouvrés,
 * 2 pour le vol). Ce n'est pas un conseil juridique : un vrai contrat peut prévoir plus long.
 */

const DECLARATION_DEADLINE = {
    FIVE_DAYS : 5,
    TWO_DAYS : 2
}

export const DECLARATION_DELAY_BUSINESS_DAYS : Record<ClaimType, number> = {
    [ClaimType.WATER_DAMAGE]:DECLARATION_DEADLINE.FIVE_DAYS,
    [ClaimType.FIRE]:DECLARATION_DEADLINE.FIVE_DAYS,
    [ClaimType.THEFT]:DECLARATION_DEADLINE.TWO_DAYS,
    [ClaimType.GLASS_BREAKAGE]:DECLARATION_DEADLINE.FIVE_DAYS,
    [ClaimType.VEHICLE_COLLISION]:DECLARATION_DEADLINE.FIVE_DAYS
}

/** Quels types de sinistre chaque produit couvre-t-il ? */
export const COVERED_CLAIM_TYPES: Record<PolicyProduct, readonly ClaimType[]> = {
    [PolicyProduct.HOME]: [
        ClaimType.WATER_DAMAGE,
        ClaimType.FIRE,
        ClaimType.THEFT,
        ClaimType.GLASS_BREAKAGE
    ],
    [PolicyProduct.MOTOR]:[
        ClaimType.VEHICLE_COLLISION,
        ClaimType.THEFT,
        ClaimType.FIRE,
        ClaimType.GLASS_BREAKAGE
    ]
}

export interface CoveragePeriod {
    coverageStart:Date
    coverageEnd:Date
}

export function isWithinCoverage(policy:CoveragePeriod, occurredOn:Date):boolean {
    return occurredOn >= policy.coverageStart && occurredOn <= policy.coverageEnd;
}

export function isCoveredType(product:PolicyProduct, type:ClaimType):boolean {
    return COVERED_CLAIM_TYPES[product].includes(type)
}

/** Date limite de déclaration (incluse). */
export function declarationDeadLine(type:ClaimType, discoveredOn:Date):Date{
    return addBusinessDays(discoveredOn, DECLARATION_DELAY_BUSINESS_DAYS[type])
}

/**
 * Déclaration tardive ? On la SIGNALE, on ne la refuse pas : l'assureur ne peut opposer
 * le retard que s'il prouve un préjudice. C'est au gestionnaire d'apprécier.
 */
export function isLateDeclaration(type:ClaimType, discoveredOn:Date, declaredOn:Date):boolean{
    // Pas de `>` : une comparaison avec une date invalide est fausse, le dossier passerait pour "dans les temps".
    return !(declaredOn <= declarationDeadLine(type, discoveredOn))
}

const isCents = (amount:number):boolean => Number.isSafeInteger(amount) && amount >= 0

/**
 * Indemnité = montant retenu − franchise, jamais négative. Montants en centimes.
 * Un montant invalide lève une erreur : mieux vaut aucun règlement qu'un règlement faux.
 */
export function computeIndemnity(approvedAmount:number, deductibles:number):number {
    if(!isCents(approvedAmount) || !isCents(deductibles)) {
        throw new RangeError('Amounts must be non-negative integers of cents')
    }
    return Math.max(0, approvedAmount - deductibles)
}