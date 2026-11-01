import {describe, expect, it} from "vitest";
import {ClaimStatus, ClaimType, PolicyProduct, Role} from "../../src/generated/prisma/enums.js";
import {
    canViewClaim,
    visibilitéScope,
    type ClaimOwnerShip,
} from "../../src/modules/claims/claim-access.js";
import {
    computeIndemnity,
    isCoveredType,
    isLateDeclaration,
    isWithinCoverage,
} from "../../src/modules/claims/claim-rules.js";
import {
    availableTransitions,
    decideTransition,
    type TransitionContext,
} from "../../src/modules/claims/claim-state-machine.js";
import {calendarDateIn, parseDateOnly} from "../../src/shared/time/calendar.js";

// 🕵️ Oracle de sécurité : chaque test joue un attaquant, puis vérifie un invariant.
// Un test rouge n'est pas un test à ajuster, c'est une faille à corriger dans le code.

const STATUSES = Object.values(ClaimStatus);
const ROLES = Object.values(Role);
const {DECLARED, UNDER_REVIEW, EXPERTISE, ACCEPTED, REJECTED, SETTLED, CLOSED} = ClaimStatus;
const {POLICYHOLDER, HANDLER, EXPERT, ADMIN} = Role;

const ATTACKER_ID = '01900000-0000-7000-8000-00000000000a';
const VICTIM_ID = '01900000-0000-7000-8000-00000000000b';

// Copie indépendante de PROJECT_ARCHI.md : la table du code ne se valide pas contre elle-même.
const STAFF_ONLY = [HANDLER, ADMIN];
const SPECIFICATION: Record<string, {roles: Role[], report?: true}> = {
    'DECLARED>UNDER_REVIEW': {roles: STAFF_ONLY},
    'DECLARED>CLOSED': {roles: [POLICYHOLDER]},
    'UNDER_REVIEW>EXPERTISE': {roles: STAFF_ONLY},
    'UNDER_REVIEW>ACCEPTED': {roles: STAFF_ONLY},
    'UNDER_REVIEW>REJECTED': {roles: STAFF_ONLY},
    'EXPERTISE>ACCEPTED': {roles: STAFF_ONLY, report: true},
    'EXPERTISE>REJECTED': {roles: STAFF_ONLY, report: true},
    'ACCEPTED>SETTLED': {roles: STAFF_ONLY},
    'SETTLED>CLOSED': {roles: STAFF_ONLY},
    'REJECTED>CLOSED': {roles: STAFF_ONLY},
};

function reachableFrom(start: ClaimStatus, roles: Role[], context: TransitionContext, avoid: ClaimStatus[] = []) {
    const seen = new Set<ClaimStatus>([start]);
    const queue = [start];
    while (queue.length > 0) {
        const from = queue.pop() as ClaimStatus;
        for (const to of STATUSES) {
            const allowed = roles.some((role) => decideTransition(from, to, role, context).allowed);
            if (allowed && !seen.has(to) && !avoid.includes(to)) {
                seen.add(to);
                queue.push(to);
            }
        }
    }
    return seen;
}

// Ce que fera le repository : une liste construite UNIQUEMENT à partir du filtre.
function listFilterMatches(role: Role, userId: string, claim: ClaimOwnerShip) {
    const scope = visibilitéScope({id: userId, role});
    switch (scope.kind) {
        case 'all':
            return true;
        case 'declarant':
            return claim.declarantId === scope.userId;
        case 'handler':
            return claim.handlerId === scope.userId
                || (claim.handlerId === null && claim.status === scope.queueStatus);
        case 'expert':
            return claim.expertId === scope.userId;
    }
}

const PEOPLE = [ATTACKER_ID, VICTIM_ID];
const ALL_CLAIMS: ClaimOwnerShip[] = PEOPLE.flatMap((declarantId) =>
    [...PEOPLE, null].flatMap((handlerId) =>
        [...PEOPLE, null].flatMap((expertId) =>
            STATUSES.map((status) => ({declarantId, handlerId, expertId, status})),
        ),
    ),
);

describe('oracle : domaine des sinistres', () => {
    describe('contournement de la machine à états', () => {
        it('respecte la spécification sur chaque triplet état, état, rôle', () => {
            for (const from of STATUSES) {
                for (const to of STATUSES) {
                    for (const role of ROLES) {
                        const rule = SPECIFICATION[`${from}>${to}`];
                        const decision = decideTransition(from, to, role, {hasExpertReport: true});

                        expect(decision.allowed, `${from} → ${to} par ${role}`)
                            .toBe(rule?.roles.includes(role) ?? false);
                    }
                }
            }
        });

        it('ne laisse aucune transition en dehors de la spécification, même avec le rapport', () => {
            for (const from of STATUSES) {
                for (const to of STATUSES) {
                    if (SPECIFICATION[`${from}>${to}`]) continue;

                    expect(decideTransition(from, to, ADMIN, {hasExpertReport: true}))
                        .toEqual({allowed: false, reason: 'INVALID_TRANSITION'});
                }
            }
        });

        it.each(STATUSES)('refuse la transition sur place : %s', (status) => {
            for (const role of ROLES) {
                expect(decideTransition(status, status, role, {hasExpertReport: true}).allowed).toBe(false);
            }
        });

        it.each([
            ['déclaré vers réglé', DECLARED, SETTLED],
            ['déclaré vers accepté', DECLARED, ACCEPTED],
            ['instruction vers réglé', UNDER_REVIEW, SETTLED],
            ['expertise vers réglé', EXPERTISE, SETTLED],
            ['refusé vers réglé', REJECTED, SETTLED],
            ['refusé vers accepté', REJECTED, ACCEPTED],
            ['clos vers réglé', CLOSED, SETTLED],
        ])('ne saute aucune étape : %s', (_label, from, to) => {
            for (const role of ROLES) {
                expect(decideTransition(from, to, role, {hasExpertReport: true}).allowed).toBe(false);
            }
        });

        it('ne verse jamais d\'indemnité à un dossier refusé', () => {
            const reachable = reachableFrom(REJECTED, ROLES, {hasExpertReport: true});

            expect(reachable).toEqual(new Set([REJECTED, CLOSED]));
        });

        it('ne verse jamais d\'indemnité sans décision d\'acceptation', () => {
            const reachable = reachableFrom(DECLARED, ROLES, {hasExpertReport: true}, [ACCEPTED]);

            expect(reachable.has(SETTLED)).toBe(false);
        });

        it('ne rouvre jamais un dossier clos', () => {
            expect(reachableFrom(CLOSED, ROLES, {hasExpertReport: true})).toEqual(new Set([CLOSED]));
        });

        it('ne revient jamais en arrière', () => {
            const order = [DECLARED, UNDER_REVIEW, EXPERTISE, ACCEPTED, SETTLED, CLOSED];
            for (const [index, from] of order.entries()) {
                for (const to of order.slice(0, index)) {
                    expect(decideTransition(from, to, ADMIN, {hasExpertReport: true}).allowed).toBe(false);
                }
            }
        });

        it('mène tout dossier à une fin : aucun état sans issue', () => {
            for (const status of STATUSES) {
                expect(reachableFrom(status, ROLES, {hasExpertReport: true}).has(CLOSED), status).toBe(true);
            }
        });
    });

    describe('élévation de privilèges', () => {
        it('ne laisse à l\'assuré que le désistement', () => {
            const paths = STATUSES.flatMap((from) => availableTransitions(from, POLICYHOLDER).map((to) => `${from}>${to}`));

            expect(paths).toEqual(['DECLARED>CLOSED']);
        });

        it('ne donne aucune transition à l\'expert', () => {
            expect(STATUSES.flatMap((from) => availableTransitions(from, EXPERT))).toEqual([]);
        });

        it('empêche l\'assuré de rejoindre un état payé, même après désistement', () => {
            const reachable = reachableFrom(DECLARED, [POLICYHOLDER], {hasExpertReport: true});

            expect(reachable).toEqual(new Set([DECLARED, CLOSED]));
        });

        it('empêche le personnel de retirer un dossier à la place de l\'assuré', () => {
            for (const role of [HANDLER, EXPERT, ADMIN]) {
                expect(decideTransition(DECLARED, CLOSED, role, {hasExpertReport: true}).allowed).toBe(false);
            }
        });

        it('annonce seulement des transitions que decideTransition accepte', () => {
            for (const from of STATUSES) {
                for (const role of ROLES) {
                    for (const to of availableTransitions(from, role)) {
                        expect(decideTransition(from, to, role, {hasExpertReport: true}).allowed).toBe(true);
                    }
                }
            }
        });
    });

    describe('contournement de l\'expertise', () => {
        it.each([ACCEPTED, REJECTED])('ne tranche pas sans rapport, même admin : %s', (to) => {
            for (const role of STAFF_ONLY) {
                expect(decideTransition(EXPERTISE, to, role, {hasExpertReport: false}))
                    .toEqual({allowed: false, reason: 'GUARD_NOT_MET'});
            }
        });

        it('ne sort d\'une expertise sans rapport par aucun chemin', () => {
            const reachable = reachableFrom(EXPERTISE, ROLES, {hasExpertReport: false});

            expect(reachable).toEqual(new Set([EXPERTISE]));
        });

        it.each([
            ['contexte vide', {}],
            ['valeur non booléenne', {hasExpertReport: 'false'}],
            ['valeur 1', {hasExpertReport: 1}],
            ['chaîne "true"', {hasExpertReport: 'true'}],
            ['objet', {hasExpertReport: {}}],
        ])('ne se laisse pas tromper par un contexte piégé : %s', (_label, context) => {
            const decision = decideTransition(EXPERTISE, ACCEPTED, HANDLER, context as TransitionContext);

            expect(decision.allowed).toBe(false);
        });
    });

    describe('fuite des dossiers d\'autrui (IDOR)', () => {
        it('ne montre à un assuré que ses propres dossiers', () => {
            for (const claim of ALL_CLAIMS) {
                expect(canViewClaim({id: ATTACKER_ID, role: POLICYHOLDER}, claim))
                    .toBe(claim.declarantId === ATTACKER_ID);
            }
        });

        it('ne montre à un expert que ses missions', () => {
            for (const claim of ALL_CLAIMS) {
                expect(canViewClaim({id: ATTACKER_ID, role: EXPERT}, claim))
                    .toBe(claim.expertId === ATTACKER_ID);
            }
        });

        it('ne montre à un gestionnaire que ses dossiers et la corbeille', () => {
            for (const claim of ALL_CLAIMS) {
                const inQueue = claim.handlerId === null && claim.status === DECLARED;

                expect(canViewClaim({id: ATTACKER_ID, role: HANDLER}, claim))
                    .toBe(claim.handlerId === ATTACKER_ID || inQueue);
            }
        });

        it('n\'accorde aucun droit croisé : être déclarant ne donne rien à un gestionnaire', () => {
            const claim = {declarantId: ATTACKER_ID, handlerId: VICTIM_ID, expertId: null, status: UNDER_REVIEW};

            expect(canViewClaim({id: ATTACKER_ID, role: HANDLER}, claim)).toBe(false);
        });

        it.each([
            ['filtre "declarant"', 'declarant'],
            ['filtre "handler"', 'handler'],
            ['filtre "all"', 'all'],
        ])('ne confond pas le type de filtre et un identifiant : %s', (_label, id) => {
            const claim = {declarantId: id, handlerId: id, expertId: id, status: UNDER_REVIEW};

            expect(canViewClaim({id: ATTACKER_ID, role: POLICYHOLDER}, claim)).toBe(false);
            expect(canViewClaim({id: ATTACKER_ID, role: HANDLER}, claim)).toBe(false);
            expect(canViewClaim({id: ATTACKER_ID, role: EXPERT}, claim)).toBe(false);
        });

        it('ne donne pas à un expert les dossiers sans expert via une comparaison à null', () => {
            const claim = {declarantId: VICTIM_ID, handlerId: null, expertId: null, status: DECLARED};

            expect(canViewClaim({id: '', role: EXPERT}, claim)).toBe(false);
        });

        it('fait correspondre le détail et la liste sur chaque combinaison', () => {
            for (const role of ROLES) {
                for (const claim of ALL_CLAIMS) {
                    expect(listFilterMatches(role, ATTACKER_ID, claim), `${role} ${JSON.stringify(claim)}`)
                        .toBe(canViewClaim({id: ATTACKER_ID, role}, claim));
                }
            }
        });
    });

    describe('abus de la déclaration', () => {
        const coverage = {coverageStart: parseDateOnly('2026-01-01'), coverageEnd: parseDateOnly('2026-12-31')};

        it('signale un vol déclaré après 2 jours ouvrés, même si 5 jours ne sont pas écoulés', () => {
            expect(isLateDeclaration(ClaimType.THEFT, parseDateOnly('2026-03-02'), parseDateOnly('2026-03-05'))).toBe(true);
        });

        it('ne se laisse pas repousser le délai par une déclaration à 23h30 UTC, déjà le lendemain à Paris', () => {
            const declaredOn = calendarDateIn(new Date('2026-03-04T23:30:00.000Z'));

            expect(isLateDeclaration(ClaimType.THEFT, parseDateOnly('2026-03-02'), declaredOn)).toBe(true);
        });

        it('compte le dernier jour à Paris même à 22h30 UTC en heure d\'hiver', () => {
            const declaredOn = calendarDateIn(new Date('2026-03-04T22:30:00.000Z'));

            expect(isLateDeclaration(ClaimType.THEFT, parseDateOnly('2026-03-02'), declaredOn)).toBe(false);
        });

        it('refuse un sinistre daté d\'une date invalide', () => {
            expect(isWithinCoverage(coverage, new Date('pas-une-date'))).toBe(false);
        });

        it.each([
            ['la veille de la couverture', '2025-12-31'],
            ['le lendemain de la couverture', '2027-01-01'],
        ])('refuse un sinistre antidaté hors contrat : %s', (_label, date) => {
            expect(isWithinCoverage(coverage, parseDateOnly(date))).toBe(false);
        });

        it('ne fait pas d\'une date invalide une déclaration dans les temps', () => {
            const invalid = new Date('pas-une-date');

            expect(isLateDeclaration(ClaimType.THEFT, parseDateOnly('2026-03-02'), invalid)).toBe(true);
            expect(isLateDeclaration(ClaimType.THEFT, invalid, parseDateOnly('2026-03-02'))).toBe(true);
        });

        it.each([
            [PolicyProduct.HOME, ClaimType.VEHICLE_COLLISION],
            [PolicyProduct.MOTOR, ClaimType.WATER_DAMAGE],
        ])('ne fait pas couvrir par %s un type exclu : %s', (product, type) => {
            expect(isCoveredType(product, type)).toBe(false);
        });
    });

    describe('fraude sur l\'indemnité', () => {
        it.each([
            ['franchise supérieure', 100, 150],
            ['montant nul', 0, 150],
        ])('ne produit jamais de versement négatif : %s', (_label, approved, deductible) => {
            expect(computeIndemnity(approved, deductible)).toBe(0);
        });

        it.each([
            ['montant négatif', -100, 0],
            ['franchise négative', 100, -50],
            ['montant NaN', Number.NaN, 0],
            ['franchise NaN', 100, Number.NaN],
            ['montant infini', Number.POSITIVE_INFINITY, 0],
            ['franchise infinie', 100, Number.POSITIVE_INFINITY],
            ['montant décimal', 0.5, 0],
            ['franchise décimale', 100, 0.5],
            ['montant au-delà des entiers sûrs', Number.MAX_SAFE_INTEGER + 1, 0],
        ])('refuse de calculer un versement sur un montant invalide : %s', (_label, approved, deductible) => {
            expect(() => computeIndemnity(approved, deductible)).toThrow(RangeError);
        });

        it('reste exact sur les plus grands montants acceptés', () => {
            expect(computeIndemnity(2_147_483_647, 1)).toBe(2_147_483_646);
        });
    });
});
