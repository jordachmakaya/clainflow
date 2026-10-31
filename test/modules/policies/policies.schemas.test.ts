import {describe, expect, it} from "vitest";
import {
    amountCentimeSchema,
    createPolicySchema,
    dateOnlySchema,
    policyIDParamSchema,
    toPolicyResponse,
} from "../../../src/modules/policies/policies.schemas.js";
import {HOLDER_ID, POLICY_BODY, POLICY_INPUT} from "./policies.fakes.js";

const INT_MAX = 2_147_483_647;

describe('dateOnlySchema', () => {
    it('convertit une date en minuit UTC', () => {
        expect(dateOnlySchema.parse('2026-03-02')).toEqual(new Date('2026-03-02T00:00:00.000Z'));
    });

    it('accepte le 29 février d\'une année bissextile', () => {
        expect(dateOnlySchema.parse('2028-02-29')).toEqual(new Date('2028-02-29T00:00:00.000Z'));
    });

    it.each([
        ['29 février hors bissextile', '2026-02-29'],
        ['jour inexistant', '2026-04-31'],
        ['mois inexistant', '2026-13-01'],
        ['date et heure', '2026-03-02T10:00:00.000Z'],
        ['format français', '02/03/2026'],
        ['sans zéro', '2026-3-2'],
        ['vide', ''],
        ['nombre', 20260302],
        ['null', null],
    ])('refuse : %s', (_label, value) => {
        expect(dateOnlySchema.safeParse(value).success).toBe(false);
    });
});

describe('amountCentimeSchema', () => {
    it.each([0, 1, 15_000, INT_MAX])('accepte %d', (value) => {
        expect(amountCentimeSchema.parse(value)).toBe(value);
    });

    it.each([
        ['négatif', -1],
        ['décimal', 150.5],
        ['chaîne', '15000'],
        ['null', null],
        ['NaN', Number.NaN],
        ['infini', Number.POSITIVE_INFINITY],
    ])('refuse : %s', (_label, value) => {
        expect(amountCentimeSchema.safeParse(value).success).toBe(false);
    });

    // La colonne est un Int PostgreSQL (vérifié : la base refuse 2147483648 avec P2020).
    it('refuse un montant que la colonne Int ne peut pas stocker', () => {
        expect(amountCentimeSchema.safeParse(INT_MAX + 1).success).toBe(false);
    });
});

describe('createPolicySchema', () => {
    it('convertit le corps reçu', () => {
        expect(createPolicySchema.parse(POLICY_BODY)).toEqual(POLICY_INPUT);
    });

    it('ignore les champs que le client ne décide pas', () => {
        const parsed = createPolicySchema.parse({
            ...POLICY_BODY,
            id: 'choisi',
            number: 'HAB-2026-CHOISI',
            createdAt: '2000-01-01',
        });

        expect(parsed).toEqual(POLICY_INPUT);
    });

    it.each([
        ['titulaire absent', {holderId: undefined}],
        ['titulaire non UUID', {holderId: 'user-1'}],
        ['produit inconnu', {product: 'LIFE'}],
        ['produit en minuscules', {product: 'home'}],
        ['début absent', {coverageStart: undefined}],
        ['fin absente', {coverageEnd: undefined}],
        ['franchise absente', {deductible: undefined}],
        ['franchise négative', {deductible: -1}],
    ])('refuse : %s', (_label, overrides) => {
        expect(createPolicySchema.safeParse({...POLICY_BODY, ...overrides}).success).toBe(false);
    });

    it('accepte une franchise nulle', () => {
        expect(createPolicySchema.safeParse({...POLICY_BODY, deductible: 0}).success).toBe(true);
    });

    it('accepte une couverture d\'un jour', () => {
        const result = createPolicySchema.safeParse({
            ...POLICY_BODY,
            coverageStart: '2026-01-01',
            coverageEnd: '2026-01-02',
        });

        expect(result.success).toBe(true);
    });

    it.each([
        ['égale au début', '2026-01-01'],
        ['avant le début', '2025-12-31'],
    ])('rattache l\'erreur à coverageEnd quand la fin est %s', (_label, coverageEnd) => {
        const result = createPolicySchema.safeParse({...POLICY_BODY, coverageEnd});

        expect(result.error?.issues).toHaveLength(1);
        expect(result.error?.issues[0]).toMatchObject({
            path: ['coverageEnd'],
            message: 'coverage end must be after coverage start',
        });
    });

    it('ne compare pas les dates si l\'une d\'elles est invalide', () => {
        const result = createPolicySchema.safeParse({...POLICY_BODY, coverageEnd: 'demain'});

        expect(result.error?.issues.map((issue) => issue.path)).toEqual([['coverageEnd']]);
    });
});

describe('policyIDParamSchema', () => {
    it('accepte un UUID v7', () => {
        expect(policyIDParamSchema.parse({policyId: HOLDER_ID})).toEqual({policyId: HOLDER_ID});
    });

    it.each(['1', 'pas-un-uuid', `${HOLDER_ID}0`, ''])('refuse %j', (policyId) => {
        expect(policyIDParamSchema.safeParse({policyId}).success).toBe(false);
    });
});

describe('toPolicyResponse', () => {
    const policy = {
        ...POLICY_INPUT,
        id: 'policy-1',
        number: 'HAB-2026-ABC234',
        createdAt: new Date('2026-03-02T10:00:00.000Z'),
    };

    it('renvoie les dates seules au format YYYY-MM-DD', () => {
        expect(toPolicyResponse(policy)).toEqual({
            id: 'policy-1',
            number: 'HAB-2026-ABC234',
            product: POLICY_BODY.product,
            holderId: HOLDER_ID,
            coverageStart: '2026-01-01',
            coverageEnd: '2026-12-31',
            deductible: 15_000,
        });
    });

    it('ne recopie pas un champ ajouté au modèle', () => {
        expect(toPolicyResponse({...policy, secret: 'interne'} as typeof policy)).not.toHaveProperty('secret');
    });
});
