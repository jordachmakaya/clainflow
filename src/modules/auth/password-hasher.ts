
import {
    randomBytes,
    scrypt,
    timingSafeEqual,
    type ScryptOptions,
} from 'node:crypto';

/**
 * Contrat définissant les opérations de gestion des mots de passe.
 *
 * Permet de remplacer l'implémentation de hachage sans modifier
 * les services qui en dépendent (injection de dépendances).
 */
export interface PasswordHasher {
    /**
     * Transforme un mot de passe en une empreinte cryptographique.
     *
     * Le hachage doit utiliser un sel aléatoire et des paramètres
     * permettant de vérifier ultérieurement le mot de passe.
     *
     * @param password - Mot de passe en clair.
     * @returns Le hachage encodé destiné à être stocké en base.
     */
    hash(password: string): Promise<string>;

    /**
     * Vérifie si un mot de passe correspond au hachage enregistré.
     *
     * @param password - Mot de passe fourni par l'utilisateur.
     * @param storedPassword - Hachage précédemment enregistré.
     * @returns true si le mot de passe correspond, sinon false.
     */
    verify(
        password: string,
        storedPassword: string,
    ): Promise<boolean>;

    /**
     * Détermine si un hachage existant doit être remplacé.
     *
     * Utile lorsque les paramètres de sécurité évoluent :
     * par exemple, lorsque le coût de scrypt augmente.
     *
     * @param storedPassword - Hachage existant.
     * @returns true si le hachage doit être renouvelé.
     */
    needsRehashedPassword(
        storedPassword: string,
    ): Promise<boolean>;
}

/** Longueur de la clé dérivée, en octets. */
const KEY_LENGTH = 64;

/** Longueur du sel aléatoire, en octets. */
const SALT_LENGTH = 16;

/** Paramètre r de scrypt : taille des blocs mémoire. */
const BLOCK_SIZE = 8;

/** Paramètre p de scrypt : facteur de parallélisation. */
const PARALLELIZATION = 1;

/** Coût minimal accepté, aligné sur PASSWORD_SCRYPT_LOG2N (src/config/env.ts). */
const MIN_LOG2N = 14;

/** Longueur minimale d'un sel stocké, en octets. */
const MIN_SALT_LENGTH = 16;

/** Longueur minimale d'une clé dérivée stockée, en octets. */
const MIN_KEY_LENGTH = 32;

/**
 * Plafond de 128 * N * r * p, soit 1 Gio.
 * Empêche une valeur stockée de déclencher un calcul démesuré.
 */
const MAX_SCRYPT_WORK_BYTES = 2 ** 30;

/** Entier strictement positif, sans notation hexadécimale ni exposant. */
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Représente les paramètres nécessaires pour vérifier
 * ou reconstruire une empreinte scrypt.
 *
 * @property log2N - Exposant du coût CPU/mémoire (N = 2^log2N).
 * @property r - Paramètre de taille des blocs.
 * @property p - Paramètre de parallélisation.
 * @property salt - Sel utilisé lors du hachage.
 * @property hash - Clé dérivée enregistrée.
 */
interface ScryptParams {
    log2N: number;
    r: number;
    p: number;
    salt: Buffer;
    hash: Buffer;
}

/**
 * Dérive une clé cryptographique à partir d'un mot de passe.
 *
 * Utilise scrypt, une fonction volontairement coûteuse en
 * calcul et en mémoire pour ralentir les attaques par force brute.
 *
 * Convertit l'API asynchrone à callback de Node.js en Promise.
 *
 * @param password - Mot de passe en clair.
 * @param salt - Sel cryptographique associé au mot de passe.
 * @param keyLength - Longueur de la clé à dériver, en octets.
 * @param options - Paramètres de coût de scrypt.
 * @returns Une clé dérivée de keyLength octets.
 * @throws Si la dérivation échoue ou si les paramètres sont invalides.
 */
function deriveKey(
    password: string,
    salt: Buffer,
    keyLength: number,
    options: ScryptOptions,
): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, keyLength, options, (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            resolve(data);
        });
    });
}

/**
 * Construit les options de configuration de scrypt.
 *
 * Convertit log2N en N et définit une limite mémoire
 * supérieure à la mémoire approximativement nécessaire.
 *
 * @param log2N - Exposant du facteur de coût (ex. 17 = 131072).
 * @param r - Paramètre de taille des blocs.
 * @param p - Paramètre de parallélisation.
 * @returns Options compatibles avec node:crypto.scrypt.
 */
function scryptOptions(
    log2N: number,
    r: number,
    p: number,
): ScryptOptions {
    const N = 2 ** log2N;

    return {
        N,
        r,
        p,
        maxmem: 256 * N * r,
    };
}


/**
 * Sérialise les paramètres et le résultat d'un hachage scrypt.
 *
 * Convertit les données cryptographiques en une chaîne de caractères
 * pouvant être enregistrée dans une base de données.
 *
 * Format :
 * scrypt$log2N$r$p$saltBase64$hashBase64
 *
 * Le sel et l'empreinte sont encodés en Base64 afin de pouvoir
 * être stockés sous forme de texte.
 *
 * @param params - Paramètres de scrypt et empreinte calculée.
 * @returns Une chaîne contenant les informations nécessaires
 * à la vérification future du mot de passe.
 */
function serialize(params: ScryptParams): string {
    const { log2N, r, p, salt, hash } = params;

    return [
        'scrypt',
        log2N,
        r,
        p,
        salt.toString('base64'),
        hash.toString('base64'),
    ].join('$');
}

/**
 * Vérifie que des paramètres scrypt restent dans les limites acceptées.
 *
 * @param log2N - Exposant du coût CPU/mémoire (N = 2^log2N).
 * @param r - Paramètre de taille des blocs.
 * @param p - Paramètre de parallélisation.
 * @returns true si le coût est supérieur au minimum et inférieur au plafond.
 */
function isSupportedCost(log2N: number, r: number, p: number): boolean {
    return (
        Number.isInteger(log2N) &&
        log2N >= MIN_LOG2N &&
        128 * 2 ** log2N * r * p <= MAX_SCRYPT_WORK_BYTES
    );
}

/**
 * Convertit un champ en entier strictement positif.
 *
 * @param value - Champ extrait de la chaîne stockée.
 * @returns L'entier, ou null si le champ n'est pas un entier décimal.
 */
function parsePositiveInteger(value: string | undefined): number | null {
    return value && POSITIVE_INTEGER.test(value) ? Number(value) : null;
}

/**
 * Décode un champ Base64 de façon stricte.
 *
 * Buffer.from() ignore silencieusement les caractères invalides :
 * le résultat est donc réencodé et comparé au champ d'origine.
 *
 * @param value - Champ extrait de la chaîne stockée.
 * @returns Les octets décodés, ou null si le Base64 n'est pas canonique.
 */
function decodeBase64(value: string | undefined): Buffer | null {
    if (!value) return null;

    const decoded = Buffer.from(value, 'base64');

    return decoded.toString('base64') === value ? decoded : null;
}

/**
 * Désérialise un hachage scrypt précédemment enregistré.
 *
 * Décompose la chaîne stockée pour récupérer les paramètres
 * de dérivation, le sel et l'empreinte cryptographique.
 *
 * Chaque champ est validé : la chaîne stockée pilote le coût de scrypt,
 * elle ne doit donc jamais être considérée comme fiable.
 *
 * @param stored - Chaîne produite par serialize().
 * @returns Les paramètres reconstruits, ou null si la chaîne
 * ne respecte pas le format ou si un paramètre est hors limites.
 */
function parse(stored: string): ScryptParams | null {
    const fields = stored.split('$');
    if (fields.length !== 6 || fields[0] !== 'scrypt') return null;

    const log2N = parsePositiveInteger(fields[1]);
    const r = parsePositiveInteger(fields[2]);
    const p = parsePositiveInteger(fields[3]);
    const salt = decodeBase64(fields[4]);
    const hash = decodeBase64(fields[5]);

    if (log2N === null || r === null || p === null || !salt || !hash) {
        return null;
    }

    const isValid =
        isSupportedCost(log2N, r, p) &&
        salt.length >= MIN_SALT_LENGTH &&
        hash.length >= MIN_KEY_LENGTH;

    return isValid ? { log2N, r, p, salt, hash } : null;
}

/**
 * Implémentation de PasswordHasher utilisant l'algorithme scrypt.
 *
 * Permet de :
 * - Hacher un nouveau mot de passe.
 * - Vérifier un mot de passe contre une empreinte enregistrée.
 * - Déterminer si une empreinte doit être recalculée.
 *
 * Chaque nouveau hachage utilise un sel cryptographique aléatoire.
 * Les paramètres sont conservés avec l'empreinte pour permettre
 * sa vérification même si la configuration évolue.
 */
export class ScryptPasswordHasher implements PasswordHasher {
    /**
     * Initialise le service de hachage.
     *
     * @param log2N - Exposant du facteur de coût scrypt.
     * Par exemple, 17 correspond à N = 131072 (2^17).
     * @throws RangeError si le coût est hors des limites acceptées.
     */
    constructor(private readonly log2N: number) {
        if (!isSupportedCost(log2N, BLOCK_SIZE, PARALLELIZATION)) {
            throw new RangeError(`Unsupported scrypt cost: ${log2N}`);
        }
    }

    /**
     * Génère une empreinte cryptographique d'un mot de passe.
     *
     * Étapes :
     * 1. Génère un sel aléatoire avec randomBytes().
     * 2. Prépare les paramètres de calcul scrypt.
     * 3. Dérive une clé cryptographique depuis le mot de passe.
     * 4. Sérialise le résultat pour son stockage.
     *
     * @param password - Mot de passe en clair.
     * @returns Le hachage sérialisé au format scrypt.
     * @throws Error si la génération du hachage échoue.
     */
    async hash(password: string): Promise<string> {
        try {
            const salt = randomBytes(SALT_LENGTH);
            const options = scryptOptions(
                this.log2N,
                BLOCK_SIZE,
                PARALLELIZATION,
            );

            const hash = await deriveKey(password, salt, KEY_LENGTH, options);

            return serialize({
                log2N: this.log2N,
                r: BLOCK_SIZE,
                p: PARALLELIZATION,
                salt,
                hash,
            });
        } catch {
            throw new Error('Something went wrong, please try again');
        }
    }

    /**
     * Vérifie si un mot de passe correspond à l'empreinte enregistrée.
     *
     * Reconstruit les paramètres scrypt à partir du hachage stocké,
     * puis dérive une empreinte candidate avec le mot de passe fourni.
     *
     * Utilise timingSafeEqual() pour comparer les deux empreintes
     * sans comparaison octet par octet avec arrêt anticipé.
     *
     * @param password - Mot de passe à vérifier.
     * @param stored - Hachage sérialisé enregistré en base.
     * @returns true si les empreintes correspondent, false sinon ou
     * si le hachage stocké est invalide. Dans ce cas, scrypt n'est pas lancé.
     * Un mot de passe contenant un octet nul est aussi refusé sans scrypt :
     * HMAC complète les clés courtes avec des zéros, donc "secret" et
     * "secret\0" produiraient la même empreinte.
     * @throws Error si la dérivation cryptographique échoue.
     */
    async verify(
        password: string,
        stored: string,
    ): Promise<boolean> {
        const params = parse(stored);
        if (!params || password.includes('\0')) return false;

        const candidate = await deriveKey(
            password,
            params.salt,
            params.hash.length,
            scryptOptions(params.log2N, params.r, params.p),
        );

        return timingSafeEqual(candidate, params.hash);
    }

    /**
     * Vérifie si un hachage existant utilise des paramètres obsolètes.
     *
     * Permet une migration progressive des mots de passe lorsque
     * le facteur de coût scrypt augmente, ou lorsque les autres
     * paramètres de hachage changent.
     *
     * Par exemple, si le hachage utilise log2N = 15 et que la
     * configuration actuelle exige 17, il doit être recalculé.
     *
     * @param storedPassword - Hachage sérialisé existant.
     * @returns true si le hachage est invalide selon parse(), si son
     * facteur de coût est inférieur à celui exigé, ou si r, p, la longueur
     * du sel ou celle de la clé diffèrent de la configuration actuelle.
     */
    async needsRehashedPassword(
        storedPassword: string,
    ): Promise<boolean> {
        const params = parse(storedPassword);

        return (
            !params ||
            params.log2N < this.log2N ||
            params.r !== BLOCK_SIZE ||
            params.p !== PARALLELIZATION ||
            params.salt.length !== SALT_LENGTH ||
            params.hash.length !== KEY_LENGTH
        );
    }
}
