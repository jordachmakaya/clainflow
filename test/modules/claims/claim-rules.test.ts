import {describe, expect, it} from "vitest";
import {ClaimType, PolicyProduct} from "../../../src/generated/prisma/enums.js";
import {
    computeIndemnity,
    COVERED_CLAIM_TYPES,
    declarationDeadLine,
    DECLARATION_DELAY_BUSINESS_DAYS,
    isCoveredType,
    isLateDeclaration,
    isWithinCoverage,
} from "../../../src/modules/claims/claim-rules.js";
import {formatDateOnly, parseDateOnly} from "../../../src/shared/time/calendar.js";

const MONDAY = parseDateOnly('2026-03-02');
const deadline = (type: ClaimType, discoveredOn: Date) => formatDateOnly(declarationDeadLine(type, discoveredOn));

describe('DECLARATION_DELAY_BUSINESS_DAYS', () => {
    it.each([
        [ClaimType.WATER_DAMAGE, 5],
        [ClaimType.FIRE, 5],
        [ClaimType.THEFT, 2],
        [ClaimType.GLASS_BREAKAGE, 5],
        [ClaimType.VEHICLE_COLLISION, 5],
    ])('accorde au type %s un délai de %i jours ouvrés', (type, days) => {
        expect(DECLARATION_DELAY_BUSINESS_DAYS[type]).toBe(days);
    });
});

describe('COVERED_CLAIM_TYPES', () => {
    it.each([
        [PolicyProduct.HOME, ClaimType.WATER_DAMAGE],
        [PolicyProduct.HOME, ClaimType.FIRE],
        [PolicyProduct.HOME, ClaimType.THEFT],
        [PolicyProduct.HOME, ClaimType.GLASS_BREAKAGE],
        [PolicyProduct.MOTOR, ClaimType.VEHICLE_COLLISION],
        [PolicyProduct.MOTOR, ClaimType.THEFT],
        [PolicyProduct.MOTOR, ClaimType.FIRE],
        [PolicyProduct.MOTOR, ClaimType.GLASS_BREAKAGE],
    ])('%s couvre %s', (product, type) => {
        expect(isCoveredType(product, type)).toBe(true);
    });

    it.each([
        [PolicyProduct.HOME, ClaimType.VEHICLE_COLLISION],
        [PolicyProduct.MOTOR, ClaimType.WATER_DAMAGE],
    ])('%s ne couvre pas %s', (product, type) => {
        expect(isCoveredType(product, type)).toBe(false);
    });

    it('couvre chaque type par au moins un produit', () => {
        const covered = new Set(Object.values(COVERED_CLAIM_TYPES).flat());

        expect(covered).toEqual(new Set(Object.values(ClaimType)));
    });
});

describe('isWithinCoverage', () => {
    const policy = {coverageStart: parseDateOnly('2026-01-01'), coverageEnd: parseDateOnly('2026-12-31')};

    it.each([
        ['premier jour', '2026-01-01'],
        ['dernier jour', '2026-12-31'],
        ['milieu de période', '2026-06-15'],
    ])('accepte le %s', (_label, date) => {
        expect(isWithinCoverage(policy, parseDateOnly(date))).toBe(true);
    });

    it.each([
        ['la veille', '2025-12-31'],
        ['le lendemain', '2027-01-01'],
    ])('refuse %s', (_label, date) => {
        expect(isWithinCoverage(policy, parseDateOnly(date))).toBe(false);
    });
});

describe('declarationDeadLine', () => {
    it('compte 5 jours ouvrés hors week-end', () => {
        expect(deadline(ClaimType.FIRE, MONDAY)).toBe('2026-03-09');
    });

    it('compte 2 jours ouvrés pour un vol', () => {
        expect(deadline(ClaimType.THEFT, MONDAY)).toBe('2026-03-04');
    });

    it('enjambe le week-end pour un vol connu un vendredi', () => {
        expect(deadline(ClaimType.THEFT, parseDateOnly('2026-03-06'))).toBe('2026-03-10');
    });

    it('part du lundi suivant pour un vol connu un samedi', () => {
        expect(deadline(ClaimType.THEFT, parseDateOnly('2026-03-07'))).toBe('2026-03-10');
    });
});

describe('isLateDeclaration', () => {
    it.each([
        ['le jour même', ClaimType.THEFT, '2026-03-02', false],
        ['le dernier jour d\'un vol', ClaimType.THEFT, '2026-03-04', false],
        ['le lendemain du délai d\'un vol', ClaimType.THEFT, '2026-03-05', true],
        ['le dernier jour d\'un incendie', ClaimType.FIRE, '2026-03-09', false],
        ['le lendemain du délai d\'un incendie', ClaimType.FIRE, '2026-03-10', true],
    ])('%s', (_label, type, declaredOn, late) => {
        expect(isLateDeclaration(type, MONDAY, parseDateOnly(declaredOn))).toBe(late);
    });

    it('signale une date de déclaration invalide', () => {
        expect(isLateDeclaration(ClaimType.FIRE, MONDAY, new Date('pas-une-date'))).toBe(true);
    });

    it('signale une date de connaissance invalide', () => {
        expect(isLateDeclaration(ClaimType.FIRE, new Date('pas-une-date'), MONDAY)).toBe(true);
    });
});

describe('computeIndemnity', () => {
    it.each([
        ['montant supérieur à la franchise', 150_000, 15_000, 135_000],
        ['montant égal à la franchise', 15_000, 15_000, 0],
        ['montant inférieur à la franchise', 10_000, 15_000, 0],
        ['sans franchise', 15_000, 0, 15_000],
        ['montant nul', 0, 15_000, 0],
    ])('%s', (_label, approved, deductible, expected) => {
        expect(computeIndemnity(approved, deductible)).toBe(expected);
    });

    it.each([
        ['montant négatif', -1, 0],
        ['franchise négative', 100, -1],
        ['montant décimal', 0.5, 0],
        ['franchise décimale', 100, 0.5],
        ['montant NaN', Number.NaN, 0],
        ['franchise infinie', 100, Number.POSITIVE_INFINITY],
    ])('refuse : %s', (_label, approved, deductible) => {
        expect(() => computeIndemnity(approved, deductible)).toThrow(RangeError);
    });
});
