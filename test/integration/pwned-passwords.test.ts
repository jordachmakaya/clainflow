import {randomUUID} from "node:crypto";
import type {Logger} from "pino";
import {describe, expect, it, vi} from "vitest";
import {PwnedPasswordsChecker} from "../../src/modules/users/breached-password.js";

// Interroge la vraie API : vérifie que son format n'a pas changé. Seul un préfixe de SHA-1 quitte la machine.
describe('API Pwned Passwords', () => {
    const warn = vi.fn();
    const checker = new PwnedPasswordsChecker({warn} as unknown as Logger);

    it('connaît un mot de passe très courant', async () => {
        await expect(checker.isBreached('password')).resolves.toBe(true);
        expect(warn).not.toHaveBeenCalled();
    });

    it('ne connaît pas un mot de passe aléatoire', async () => {
        await expect(checker.isBreached(randomUUID())).resolves.toBe(false);
        expect(warn).not.toHaveBeenCalled();
    });
});
