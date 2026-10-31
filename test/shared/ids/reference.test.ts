import {describe, expect, it} from "vitest";
import {referenceCode} from "../../../src/shared/ids/reference.js";

describe('referenceCode', () => {
    it('produit le format attendu', () => {
        expect(referenceCode('SIN', 2026)).toMatch(/^SIN-2026-[23456789A-HJKMNP-Z]{8}$/);
    });

    it('utilise le préfixe et l\'année demandés', () => {
        expect(referenceCode('POL', 2030)).toMatch(/^POL-2030-/);
    });

    it.each([1, 4, 12])('respecte une longueur de %d caractères', (length) => {
        const code = referenceCode('SIN', 2026, length).split('-')[2];

        expect(code).toHaveLength(length);
    });

    it('n\'utilise que des caractères sans ambiguïté', () => {
        const codes = Array.from({length: 500}, () => referenceCode('SIN', 2026)).join('');

        expect(codes.replace(/SIN-2026-/g, '')).not.toMatch(/[01ILO]/);
    });

    it('produit des références différentes', () => {
        const codes = new Set(Array.from({length: 1000}, () => referenceCode('SIN', 2026)));

        expect(codes.size).toBe(1000);
    });
});
