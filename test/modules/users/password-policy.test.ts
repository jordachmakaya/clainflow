import {describe, expect, it} from "vitest";
import {isWeakPassword} from "../../../src/modules/users/password-policy.js";

describe('isWeakPassword', () => {
    it.each([
        ['blancs', ' '.repeat(12)],
        ['blancs mélangés', ' \t \t \t \t \t \t'],
        ['caractère répété', 'a'.repeat(12)],
        ['motif répété', 'abcabcabcabc'],
        ['mot répété', 'passwordpassword'],
        ['mot répété en casse mixte', 'PassWordPassWord'],
        ['suite de chiffres', '123456789012'],
        ['suite de chiffres inversée', '210987654321'],
        ['alphabet', 'abcdefghijklm'],
        ['clavier qwerty', 'qwertyuiopas'],
        ['clavier azerty', 'azertyuiopqs'],
        ['mot de passe courant', 'motdepasse123'],
        ['mot de passe courant en majuscules', 'PASSWORD1234'],
    ])('refuse : %s', (_label, password) => {
        expect(isWeakPassword(password)).toBe(true);
    });

    it.each([
        ['phrase', 'correct horse battery'],
        ['aléatoire', 'k7#Qz!p2Lm9$'],
        ['presque répété', 'abcabcabcabd'],
        ['presque une suite', '123456789013'],
        ['accents', 'été à la plage'],
    ])('accepte : %s', (_label, password) => {
        expect(isWeakPassword(password)).toBe(false);
    });

    it('reste rapide sur une entrée géante', () => {
        const start = performance.now();

        isWeakPassword(`${'ab'.repeat(500_000)}c`);

        expect(performance.now() - start).toBeLessThan(500);
    });
});
