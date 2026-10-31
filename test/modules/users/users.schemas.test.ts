import {describe, expect, it} from "vitest";
import {Role} from "../../../src/generated/prisma/enums.js";
import type {User} from "../../../src/modules/users/users.repository.js";
import {
    createStaffSchema,
    emailSchema,
    fullNameSchema,
    isSafeText,
    listUserQuerySchema,
    passwordSchema,
    toPublicUser,
} from "../../../src/modules/users/users.schemas.js";
import {passwordOfLength} from "../auth/auth.fakes.js";

const validStaff = {
    email: 'gaelle@claimflow.test',
    password: 'correct horse battery',
    fullName: 'Gaëlle Martin',
    role: Role.HANDLER,
};

describe('emailSchema', () => {
    it('accepte un email valide', () => {
        expect(emailSchema.parse('alice@claimflow.test')).toBe('alice@claimflow.test');
    });

    it('met l\'email en minuscules', () => {
        expect(emailSchema.parse('Alice@ClaimFlow.TEST')).toBe('alice@claimflow.test');
    });

    it('retire les espaces autour', () => {
        expect(emailSchema.parse('  alice@claimflow.test  ')).toBe('alice@claimflow.test');
    });

    it.each(['', '   ', 'alice', 'alice@', '@claimflow.test', 'alice claimflow@test.fr', 'a@b'])(
        'refuse %j',
        (value) => {
            expect(emailSchema.safeParse(value).success).toBe(false);
        },
    );

    it.each([undefined, null, 42, {}])('refuse une valeur non textuelle : %j', (value) => {
        expect(emailSchema.safeParse(value).success).toBe(false);
    });
});

describe('passwordSchema', () => {
    it.each([12, 13, 127, 128])('accepte %d caractères', (length) => {
        expect(passwordSchema.safeParse(passwordOfLength(length)).success).toBe(true);
    });

    it.each([0, 11, 129, 10_000])('refuse %d caractères', (length) => {
        expect(passwordSchema.safeParse(passwordOfLength(length)).success).toBe(false);
    });

    it.each([
        ['blanc', ' '.repeat(12)],
        ['répété', 'a'.repeat(12)],
        ['suite', '123456789012'],
        ['courant', 'motdepasse123'],
    ])('refuse un mot de passe faible : %s', (_label, value) => {
        const result = passwordSchema.safeParse(value);

        expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Password is too weak']);
    });

    it('refuse un octet nul', () => {
        const result = passwordSchema.safeParse('correct horse\u0000battery');

        expect(result.error?.issues.map((issue) => issue.message)).toEqual(['Invalid character']);
    });

    it('conserve le mot de passe tel quel', () => {
        expect(passwordSchema.parse('  Espaces Gardés  ')).toBe('  Espaces Gardés  ');
    });

    it.each([undefined, null, 123456789012])('refuse une valeur non textuelle : %j', (value) => {
        expect(passwordSchema.safeParse(value).success).toBe(false);
    });
});

describe('fullNameSchema', () => {
    it('accepte un nom', () => {
        expect(fullNameSchema.parse('Gaëlle Martin')).toBe('Gaëlle Martin');
    });

    it('retire les espaces autour', () => {
        expect(fullNameSchema.parse('  Gaëlle Martin  ')).toBe('Gaëlle Martin');
    });

    it.each([1, 200])('accepte %d caractères', (length) => {
        expect(fullNameSchema.safeParse('a'.repeat(length)).success).toBe(true);
    });

    it.each(['', '   ', 'a'.repeat(201)])('refuse %j', (value) => {
        expect(fullNameSchema.safeParse(value).success).toBe(false);
    });

    it.each([undefined, null, 42])('refuse une valeur non textuelle : %j', (value) => {
        expect(fullNameSchema.safeParse(value).success).toBe(false);
    });

    it('refuse un retour à la ligne au milieu du nom', () => {
        expect(fullNameSchema.safeParse('Gaëlle\nMartin').success).toBe(false);
    });

    it('retire un retour à la ligne autour du nom', () => {
        expect(fullNameSchema.parse('Gaëlle Martin\n')).toBe('Gaëlle Martin');
    });
});

describe('isSafeText', () => {
    it.each([
        ['accents', 'Gaëlle Müller-Ñuñez'],
        ['apostrophe', 'Jeanne d\'Arc'],
        ['arabe', 'سارة أحمد'],
        ['hébreu', 'שרה כהן'],
        ['emoji composé', 'Alice 👩\u200D💻'],
    ])('accepte : %s', (_label, value) => {
        expect(isSafeText(value)).toBe(true);
    });

    it.each([
        ['saut de ligne', 'a\nb'],
        ['retour chariot', 'a\rb'],
        ['tabulation', 'a\tb'],
        ['octet nul', 'a\u0000b'],
        ['échappement ANSI', 'a\u001B[31mb'],
        ['séparateur de ligne', 'a\u2028b'],
        ['séparateur de paragraphe', 'a\u2029b'],
        ['marque droite-gauche', 'a\u200Fb'],
        ['marque de lettre arabe', 'a\u061Cb'],
        ['inversion de sens', 'a\u202Eb'],
        ['isolat de direction', 'a\u2066b'],
    ])('refuse : %s', (_label, value) => {
        expect(isSafeText(value)).toBe(false);
    });
});

describe('createStaffSchema', () => {
    it.each([Role.HANDLER, Role.EXPERT, Role.ADMIN])('accepte le rôle %s', (role) => {
        expect(createStaffSchema.safeParse({...validStaff, role}).success).toBe(true);
    });

    it('refuse le rôle POLICYHOLDER : un assuré s\'inscrit lui-même', () => {
        expect(createStaffSchema.safeParse({...validStaff, role: Role.POLICYHOLDER}).success).toBe(false);
    });

    it.each(['email', 'password', 'fullName', 'role'])('exige le champ %s', (field) => {
        const {[field as keyof typeof validStaff]: _removed, ...staff} = validStaff;

        expect(createStaffSchema.safeParse(staff).success).toBe(false);
    });

    it('refuse un rôle inconnu', () => {
        expect(createStaffSchema.safeParse({...validStaff, role: 'SUPERADMIN'}).success).toBe(false);
    });

    it('refuse un mot de passe trop court', () => {
        expect(createStaffSchema.safeParse({...validStaff, password: 'court'}).success).toBe(false);
        expect(createStaffSchema.safeParse({...validStaff, password: 'passwordpassword'}).success).toBe(false);
        expect(createStaffSchema.safeParse({...validStaff, fullName: 'Gaëlle\u202EMartin'}).success).toBe(false);
    });

    it('normalise l\'email', () => {
        const result = createStaffSchema.parse({...validStaff, email: '  GAELLE@ClaimFlow.test '});

        expect(result.email).toBe('gaelle@claimflow.test');
    });

    it('ignore les champs inconnus', () => {
        const result = createStaffSchema.parse({...validStaff, id: 'attacker', passwordHash: 'x'});

        expect(result).not.toHaveProperty('id');
        expect(result).not.toHaveProperty('passwordHash');
    });

    it('conserve tous les champs', () => {
        expect(createStaffSchema.parse(validStaff)).toEqual(validStaff);
    });

    it('refuse un nom vide', () => {
        expect(createStaffSchema.safeParse({...validStaff, fullName: '   '}).success).toBe(false);
    });
});

describe('listUserQuerySchema', () => {
    it.each(Object.values(Role))('accepte le rôle %s', (role) => {
        expect(listUserQuerySchema.parse({role})).toEqual({role, page: 1, pageSize: 20});
    });

    it('exige le rôle', () => {
        expect(listUserQuerySchema.safeParse({}).success).toBe(false);
    });

    it('refuse un rôle inconnu', () => {
        expect(listUserQuerySchema.safeParse({role: 'SUPERADMIN'}).success).toBe(false);
    });

    it('distingue la casse', () => {
        expect(listUserQuerySchema.safeParse({role: 'expert'}).success).toBe(false);
    });
});

describe('toPublicUser', () => {
    const user: User = {
        id: '0194e6a0-0000-7000-8000-000000000001',
        email: 'alice@claimflow.test',
        passwordHash: 'scrypt$17$8$1$sel$cle',
        fullName: 'Alice Durand',
        role: Role.POLICYHOLDER,
        createdAt: new Date('2026-03-02T10:00:00.000Z'),
    };

    it('renvoie les champs publics', () => {
        expect(toPublicUser(user)).toEqual({
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            role: user.role,
        });
    });

    it('n\'expose jamais le hachage du mot de passe', () => {
        expect(JSON.stringify(toPublicUser(user))).not.toContain(user.passwordHash);
    });
});
