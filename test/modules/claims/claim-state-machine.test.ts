import {describe, expect, it} from "vitest";
import {ClaimStatus, Role} from "../../../src/generated/prisma/enums.js";
import {
    availableTransitions,
    CLAIM_TRANSITIONS,
    decideTransition,
    isTerminal,
} from "../../../src/modules/claims/claim-state-machine.js";

const {DECLARED, UNDER_REVIEW, EXPERTISE, ACCEPTED, REJECTED, SETTLED, CLOSED} = ClaimStatus;
const {POLICYHOLDER, HANDLER, EXPERT, ADMIN} = Role;

const WITH_REPORT = {hasExpertReport: true};
const NO_REPORT = {hasExpertReport: false};

describe('CLAIM_TRANSITIONS', () => {
    it('ne définit pas deux fois la même transition', () => {
        const pairs = CLAIM_TRANSITIONS.map((t) => `${t.from}>${t.to}`);

        expect(new Set(pairs).size).toBe(pairs.length);
    });

    it('correspond au cycle de vie documenté', () => {
        const pairs = CLAIM_TRANSITIONS.map((t) => [t.from, t.to]);

        expect(pairs).toHaveLength(10);
        expect(pairs).toEqual(expect.arrayContaining([
            [DECLARED, UNDER_REVIEW],
            [DECLARED, CLOSED],
            [UNDER_REVIEW, EXPERTISE],
            [UNDER_REVIEW, ACCEPTED],
            [UNDER_REVIEW, REJECTED],
            [EXPERTISE, ACCEPTED],
            [EXPERTISE, REJECTED],
            [ACCEPTED, SETTLED],
            [SETTLED, CLOSED],
            [REJECTED, CLOSED],
        ]));
    });
});

describe('decideTransition', () => {
    it.each([
        [DECLARED, UNDER_REVIEW, HANDLER],
        [DECLARED, UNDER_REVIEW, ADMIN],
        [DECLARED, CLOSED, POLICYHOLDER],
        [UNDER_REVIEW, EXPERTISE, HANDLER],
        [UNDER_REVIEW, ACCEPTED, ADMIN],
        [UNDER_REVIEW, REJECTED, HANDLER],
        [ACCEPTED, SETTLED, HANDLER],
        [SETTLED, CLOSED, ADMIN],
        [REJECTED, CLOSED, HANDLER],
    ])('autorise %s → %s pour %s', (from, to, role) => {
        const decision = decideTransition(from, to, role, NO_REPORT);

        expect(decision).toMatchObject({allowed: true, rule: {from, to}});
    });

    it('refuse une paire absente de la table', () => {
        expect(decideTransition(DECLARED, SETTLED, ADMIN, WITH_REPORT))
            .toEqual({allowed: false, reason: 'INVALID_TRANSITION'});
    });

    it('ne rouvre pas un dossier accepté', () => {
        expect(decideTransition(ACCEPTED, UNDER_REVIEW, ADMIN, WITH_REPORT))
            .toEqual({allowed: false, reason: 'INVALID_TRANSITION'});
    });

    it('refuse un rôle non autorisé', () => {
        expect(decideTransition(DECLARED, UNDER_REVIEW, POLICYHOLDER, NO_REPORT))
            .toEqual({allowed: false, reason: 'ROLE_NOT_ALLOWED'});
    });

    it('réserve le désistement à l\'assuré', () => {
        expect(decideTransition(DECLARED, CLOSED, ADMIN, NO_REPORT))
            .toEqual({allowed: false, reason: 'ROLE_NOT_ALLOWED'});
    });

    it.each([ACCEPTED, REJECTED])('exige le rapport pour EXPERTISE → %s', (to) => {
        expect(decideTransition(EXPERTISE, to, HANDLER, NO_REPORT))
            .toEqual({allowed: false, reason: 'GUARD_NOT_MET'});
    });

    it.each([ACCEPTED, REJECTED])('autorise EXPERTISE → %s après le rapport', (to) => {
        expect(decideTransition(EXPERTISE, to, HANDLER, WITH_REPORT).allowed).toBe(true);
    });

    it('n\'accepte que true comme preuve du rapport', () => {
        const context = {hasExpertReport: 'false'} as unknown as typeof NO_REPORT;

        expect(decideTransition(EXPERTISE, ACCEPTED, HANDLER, context))
            .toEqual({allowed: false, reason: 'GUARD_NOT_MET'});
    });

    it('contrôle le rôle avant la garde', () => {
        expect(decideTransition(EXPERTISE, ACCEPTED, EXPERT, NO_REPORT))
            .toEqual({allowed: false, reason: 'ROLE_NOT_ALLOWED'});
    });
});

describe('availableTransitions', () => {
    it.each([
        [DECLARED, HANDLER, [UNDER_REVIEW]],
        [DECLARED, ADMIN, [UNDER_REVIEW]],
        [DECLARED, POLICYHOLDER, [CLOSED]],
        [DECLARED, EXPERT, []],
        [UNDER_REVIEW, HANDLER, [EXPERTISE, ACCEPTED, REJECTED]],
        [ACCEPTED, HANDLER, [SETTLED]],
        [CLOSED, ADMIN, []],
    ])('depuis %s pour %s', (from, role, expected) => {
        expect(availableTransitions(from, role)).toEqual(expected);
    });
});

describe('isTerminal', () => {
    it('ne considère que CLOSED comme final', () => {
        const terminal = Object.values(ClaimStatus).filter((status) => isTerminal(status));

        expect(terminal).toEqual([CLOSED]);
    });
});
