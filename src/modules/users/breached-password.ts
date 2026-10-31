import {createHash} from "node:crypto";
import type {Logger} from "pino";

const RANGE_URL = 'https://api.pwnedpasswords.com/range'
const PREFIX_LENGTH = 5
const TIMEOUT_MS = 2000

export interface BreachChecker {
    isBreached(password: string): Promise<boolean>
}

// 🔎 API Pwned Passwords de Have I Been Pwned : seuls les 5 premiers caractères du SHA-1 quittent
// le serveur (k-anonymat), jamais le mot de passe ni son empreinte complète.
export class PwnedPasswordsChecker implements BreachChecker {
    constructor(
        private readonly logger: Logger,
        private readonly request: typeof fetch = fetch,
    ) {}

    async isBreached(password: string): Promise<boolean> {
        const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()

        try {
            const response = await this.request(`${RANGE_URL}/${digest.slice(0, PREFIX_LENGTH)}`, {
                // Le remplissage cache au réseau la taille de la réponse, donc le préfixe demandé.
                headers: {'Add-Padding': 'true'},
                signal: AbortSignal.timeout(TIMEOUT_MS),
            })
            if (!response.ok) throw new Error(`Pwned Passwords answered ${response.status}`)

            return containsSuffix(await response.text(), digest.slice(PREFIX_LENGTH))
        } catch (error) {
            // Un service externe en panne ne doit pas bloquer les inscriptions.
            this.logger.warn({err: error}, 'Pwned Passwords check skipped')
            return false
        }
    }
}

function containsSuffix(body: string, suffix: string): boolean {
    return body.split('\n').some((line) => {
        const [candidate, count] = line.trim().split(':')
        // Les lignes de remplissage ont un compte à 0 : ce ne sont pas de vraies fuites.
        return candidate === suffix && Number(count) > 0
    })
}
