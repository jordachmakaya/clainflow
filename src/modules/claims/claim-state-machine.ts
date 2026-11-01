
// 🔁 La machine à états du dossier sinistre, sous forme de DONNÉES (une table) + une fonction pure.
// Aucune dépendance (ni Express, ni Prisma, ni horloge) → testable en quelques millisecondes.
//
//   DECLARED ──► UNDER_REVIEW ──► EXPERTISE ──► ACCEPTED ──► SETTLED ──► CLOSED
//      │              │    │          │            ▲
//      │              │    └──────────┼────────────┘ (acceptation directe, sans expert)
//      │              └───────────────┴──► REJECTED ──► CLOSED
//      └──► CLOSED (désistement de l'assuré)

import  { ClaimStatus, Role} from "../../generated/prisma/enums.js";

/** Condition supplémentaire à remplir pour emprunter une transition. */
export type TransitionGuard = "EXPERT_REPORT_REQUIERED"

export interface TransitionRules {
    from:ClaimStatus,
    to:ClaimStatus,
    roles: readonly Role[]
    guard?: TransitionGuard
}

const STAFF = [Role.HANDLER, Role.ADMIN] as const
const REASON_TYPE = {
    INVALID_TRANSITION:'INVALID_TRANSITION',
    GUARD_NOT_MET:'GUARD_NOT_MET',
    ROLE_NOT_ALLOWED:'ROLE_NOT_ALLOWED'
} as const




export const CLAIM_TRANSITIONS: readonly TransitionRules[] = [
    { from: ClaimStatus.DECLARED, to: ClaimStatus.UNDER_REVIEW, roles:STAFF},
    {from:ClaimStatus.DECLARED, to:ClaimStatus.CLOSED,roles: [Role.POLICYHOLDER]},
    {from:ClaimStatus.UNDER_REVIEW, to:ClaimStatus.EXPERTISE,roles:STAFF},
    {from:ClaimStatus.UNDER_REVIEW, to:ClaimStatus.ACCEPTED,roles:STAFF},
    {from:ClaimStatus.UNDER_REVIEW, to:ClaimStatus.REJECTED,roles:STAFF},
    {
        from:ClaimStatus.EXPERTISE,
        to:ClaimStatus.ACCEPTED,
        roles:STAFF,
        guard:"EXPERT_REPORT_REQUIERED",
    },
    {
        from: ClaimStatus.EXPERTISE,
        to:ClaimStatus.REJECTED,
        roles:STAFF,
        guard:'EXPERT_REPORT_REQUIERED',
    },
    { from:ClaimStatus.ACCEPTED,to:ClaimStatus.SETTLED, roles:STAFF },
    {from:ClaimStatus.SETTLED, to:ClaimStatus.CLOSED,roles:STAFF},
    {from:ClaimStatus.REJECTED, to:ClaimStatus.CLOSED,roles:STAFF},
]

export interface TransitionContext {
    hasExpertReport: boolean
}

// Résultat explicite plutôt qu'une exception : la fonction reste pure et le service décide
// du code HTTP (409, 403...). Le "reason" permet un message précis.
export type TransitionDecision =
    | {allowed:true, rule:TransitionRules}
    | {allowed:false, reason:'INVALID_TRANSITION' | 'ROLE_NOT_ALLOWED' | 'GUARD_NOT_MET'}

export function decideTransition(
    from:ClaimStatus,
    to:ClaimStatus,
    role:Role,
    context:TransitionContext
):TransitionDecision {
    const rule = CLAIM_TRANSITIONS.find((t) => t.from === from && t.to === to)
    if (!rule) return {allowed:false, reason:REASON_TYPE.INVALID_TRANSITION};
    if(!rule.roles.includes(role)) return {allowed:false, reason:REASON_TYPE.ROLE_NOT_ALLOWED};
    if(rule.guard === 'EXPERT_REPORT_REQUIERED' && context.hasExpertReport !== true) {
        return {allowed:false, reason:REASON_TYPE.GUARD_NOT_MET};
    }

    return { allowed:true, rule}
}

/** Les actions possibles pour CE rôle depuis CET état (utile à un front pour afficher les boutons). */
export function availableTransitions(from: ClaimStatus, role: Role): ClaimStatus[] {
    return CLAIM_TRANSITIONS.filter((t) => t.from === from && t.roles.includes(role)).map(
        (t) => t.to,
    );
}

/** État final : plus aucune transition ne part de lui. */
export function  isTerminal(status:ClaimStatus):boolean {
    return !CLAIM_TRANSITIONS.some(
        (t) => t.from === status
    )
}
