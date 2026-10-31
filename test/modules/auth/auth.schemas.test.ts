import {describe, expect, it} from "vitest";
import {loginSchema, registerSchema} from "../../../src/modules/auth/auth.schemas.js";
import {ALICE, passwordOfLength} from "./auth.fakes.js";

describe('registerSchema', () => {
    it('normalise l\'email et le nom', () => {
        const result = registerSchema.parse({
            ...ALICE,
            email: '  ALICE@ClaimFlow.Test ',
            fullName: '  Alice Durand  ',
        });

        expect(result).toEqual(ALICE);
    });

    it('retire les champs inconnus', () => {
        const result = registerSchema.parse({...ALICE, role: 'ADMIN', id: 'attacker'});

        expect(result).toEqual(ALICE);
    });

    it('ne modifie pas le mot de passe', () => {
        const password = '  espaces conservés  ';

        expect(registerSchema.parse({...ALICE, password}).password).toBe(password);
    });

    it.each([
        ['mot de passe de 12 caractères', {password: passwordOfLength(12)}],
        ['mot de passe de 128 caractères', {password: passwordOfLength(128)}],
        ['nom de 2 caractères', {fullName: 'Al'}],
        ['nom de 120 caractères', {fullName: 'x'.repeat(120)}],
    ])('accepte : %s', (_label, override) => {
        expect(registerSchema.safeParse({...ALICE, ...override}).success).toBe(true);
    });

    it.each([
        ['email invalide', {email: 'pas-un-email'}],
        ['mot de passe de 11 caractères', {password: passwordOfLength(11)}],
        ['mot de passe de 129 caractères', {password: passwordOfLength(129)}],
        ['mot de passe avec octet nul', {password: `${ALICE.password}\u0000`}],
        ['mot de passe faible', {password: 'passwordpassword'}],
        ['nom avec retour à la ligne', {fullName: 'Alice\nDurand'}],
        ['nom de 1 caractère', {fullName: 'A'}],
        ['nom de 121 caractères', {fullName: 'x'.repeat(121)}],
        ['nom composé d\'espaces', {fullName: '     '}],
    ])('refuse : %s', (_label, override) => {
        expect(registerSchema.safeParse({...ALICE, ...override}).success).toBe(false);
    });

    it.each(['email', 'password', 'fullName'])('exige le champ %s', (field) => {
        const input: Record<string, string> = {...ALICE};
        delete input[field];

        expect(registerSchema.safeParse(input).success).toBe(false);
    });
});

describe('loginSchema', () => {
    const credentials = {email: ALICE.email, password: ALICE.password};

    it('normalise l\'email', () => {
        const result = loginSchema.parse({...credentials, email: ' ALICE@ClaimFlow.Test '});

        expect(result.email).toBe(ALICE.email);
    });

    it('retire les champs inconnus', () => {
        expect(loginSchema.parse({...credentials, role: 'ADMIN'})).toEqual(credentials);
    });

    it('ne modifie pas le mot de passe', () => {
        const password = '  espaces conservés  ';

        expect(loginSchema.parse({...credentials, password}).password).toBe(password);
    });

    it('accepte tout mot de passe valide à l\'inscription', () => {
        const password = passwordOfLength(128);

        expect(registerSchema.safeParse({...ALICE, password}).success).toBe(true);
        expect(loginSchema.safeParse({...credentials, password}).success).toBe(true);
    });

    it('laisse se connecter un ancien compte au mot de passe devenu faible', () => {
        expect(loginSchema.safeParse({...credentials, password: 'passwordpassword'}).success).toBe(true);
    });

    it('ne révèle pas la politique de longueur sur un mot de passe court', () => {
        expect(loginSchema.safeParse({...credentials, password: 'x'}).success).toBe(true);
    });

    it.each([
        ['email invalide', {email: 'pas-un-email'}],
        ['mot de passe vide', {password: ''}],
        ['mot de passe de 129 caractères', {password: 'x'.repeat(129)}],
    ])('refuse : %s', (_label, override) => {
        expect(loginSchema.safeParse({...credentials, ...override}).success).toBe(false);
    });
});
