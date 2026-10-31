import {randomInt} from "crypto";

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** Référence lisible et aléatoire, ex. referenceCode('SIN', 2026) → "SIN-2026-7K3F9Q2M". */
export function referenceCode(prefix:string, year:number,length = 8) {
    let code = ''
    for (let i = 0; i < length; i++) {
        code += ALPHABET.charAt(randomInt(ALPHABET.length));
        // 31^8 ≈ 850 milliards de combinaisons : collision très improbable, et la contrainte UNIQUE
        // en base la rendrait visible (erreur) plutôt que silencieuse.
        return `${prefix}-${year}-${code}`;
    }
}