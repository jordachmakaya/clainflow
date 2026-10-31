// Mots de passe courants d'au moins 12 caractères, écrits en minuscules.
const COMMON_PASSWORDS = new Set([
    'administrator',
    'azerty123456',
    'claimflow123',
    'claimflow1234',
    'iloveyou1234',
    'letmein12345',
    'motdepasse12',
    'motdepasse123',
    'motdepasse1234',
    'password1234',
    'password12345',
    'password123456',
    'qwerty123456',
    'welcome12345',
]);

const SEQUENCES = [
    '0123456789'.repeat(13),
    'abcdefghijklmnopqrstuvwxyz',
    'qwertyuiopasdfghjklzxcvbnm',
    'azertyuiopqsdfghjklmwxcvbn',
];

const reverse = (value: string) => value.split('').reverse().join('');

// Pas de regex ici : refine s'exécute même au-delà de max(), donc sur des entrées géantes.
function isRepeatedPattern(value: string): boolean {
    const {length} = value;
    for (let size = 1; size <= length / 2; size++) {
        if (length % size === 0 && value === value.slice(0, size).repeat(length / size)) return true;
    }
    return false;
}

function isSequence(value: string): boolean {
    return SEQUENCES.some((sequence) => sequence.includes(value) || reverse(sequence).includes(value));
}

/** Vrai si le mot de passe est blanc, répétitif, une suite ou un mot de passe courant. */
export function isWeakPassword(password: string): boolean {
    const value = password.toLowerCase();
    return value.trim() === '' || COMMON_PASSWORDS.has(value) || isRepeatedPattern(value) || isSequence(value);
}
