import {createHmac} from "node:crypto";
import {decodeJwt, SignJWT} from "jose";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {Role} from "../../src/generated/prisma/enums.js";
import {loginSchema, registerSchema, type RegisterInput} from "../../src/modules/auth/auth.schemas.js";
import {type PasswordHasher, ScryptPasswordHasher} from "../../src/modules/auth/password-hasher.js";
import {ConflictError, HttpError, NotFoundError, UnauthorizedError} from "../../src/shared/http/http-error.js";
import {ALICE, createAuthStack, SECRET, seedUser} from "../modules/auth/auth.fakes.js";
import {fakeHasher} from "../modules/users/users.fakes.js";

// 🕵️ Oracle de sécurité : chaque test joue un attaquant, puis vérifie un invariant.
// Un test rouge n'est pas un test à ajuster, c'est une faille à corriger dans le code.

const CREDENTIALS = {email: ALICE.email, password: ALICE.password};
const INVALID_CREDENTIALS = {name: 'UnauthorizedError', statusCode: 401, message: 'Invalid credentials'};

/** Rejoue une tentative et renvoie l'erreur visible par l'attaquant. */
async function refusal(attempt: Promise<unknown>) {
    const error: unknown = await attempt.then(
        () => {
            throw new Error('Tentative acceptée alors qu\'elle devait échouer');
        },
        (reason: unknown) => reason,
    );
    if (!(error instanceof HttpError)) throw error;
    return {name: error.name, statusCode: error.statusCode, message: error.message};
}

function fakeStack() {
    const hasher: PasswordHasher = {...fakeHasher};
    return createAuthStack(hasher);
}

describe('oracle : usurpation de compte', () => {
    let stack: ReturnType<typeof createAuthStack>;

    beforeEach(async () => {
        stack = createAuthStack();
        await stack.service.register(ALICE);
    });

    it.each([
        ['vide', ''],
        ['majuscules', ALICE.password.toUpperCase()],
        ['espace en tête', ` ${ALICE.password}`],
        ['espace en fin', `${ALICE.password} `],
        ['dernier caractère retiré', ALICE.password.slice(0, -1)],
        ['caractère ajouté', `${ALICE.password}x`],
        ['octet nul ajouté', `${ALICE.password}\u0000`],
        ['préfixe puis octet nul', `${ALICE.password.slice(0, 5)}\u0000${ALICE.password.slice(5)}`],
    ])('refuse un mot de passe altéré : %s', async (_label, password) => {
        await expect(refusal(stack.service.login({...CREDENTIALS, password})))
            .resolves.toEqual(INVALID_CREDENTIALS);
    });

    it('refuse de se connecter avec le hachage volé (pass-the-hash)', async () => {
        const password = stack.repository.users[0]?.passwordHash ?? '';

        await expect(refusal(stack.service.login({...CREDENTIALS, password})))
            .resolves.toEqual(INVALID_CREDENTIALS);
    });

    it('ne tronque pas un mot de passe long', async () => {
        const password = 'x'.repeat(128);
        await seedUser(stack.repository, await stack.hasher.hash(password), {email: 'long@claimflow.test'});

        await expect(refusal(stack.service.login({
            email: 'long@claimflow.test',
            password: `${'x'.repeat(127)}y`,
        }))).resolves.toEqual(INVALID_CREDENTIALS);
    });

    it('n\'ouvre aucune session avec le mot de passe du leurre', async () => {
        await expect(refusal(stack.service.login({
            email: 'inconnu@claimflow.test',
            password: 'dummy-password-for-timing',
        }))).resolves.toEqual(INVALID_CREDENTIALS);
    });

    it('ne laisse pas un mot de passe faux écraser le hachage', async () => {
        const before = stack.repository.users[0]?.passwordHash;

        await refusal(stack.service.login({...CREDENTIALS, password: 'mot de passe de l attaquant'}));

        expect(stack.repository.users[0]?.passwordHash).toBe(before);
    });

    it('n\'ouvre pas de session au nom d\'un autre compte', async () => {
        await stack.service.register({...ALICE, email: 'bob@claimflow.test'});

        const session = await stack.service.login({...CREDENTIALS, email: 'bob@claimflow.test'});

        expect(decodeJwt(session?.accessToken ?? '').sub).toBe('user-2');
    });
});

describe('oracle : hachage stocké corrompu', () => {
    it.each([
        ['vide', ''],
        ['mot de passe en clair', ALICE.password],
        ['format inconnu', 'bcrypt$2b$10$abc'],
        ['champs manquants', 'scrypt$14$8$1'],
        ['sel et clé vides', 'scrypt$14$8$1$$'],
        ['coût abaissé', 'scrypt$1$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
        ['bombe mémoire', 'scrypt$40$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
    ])('refuse sans plantage : %s', async (_label, storedHash) => {
        const stack = createAuthStack();
        await seedUser(stack.repository, storedHash);

        await expect(refusal(stack.service.login(CREDENTIALS))).resolves.toEqual(INVALID_CREDENTIALS);
    });
});

describe('oracle : énumération des comptes', () => {
    it('ne distingue pas email inconnu et mot de passe faux dans l\'erreur', async () => {
        const stack = fakeStack();
        await seedUser(stack.repository, `hashed:${ALICE.password}`);

        const unknown = await refusal(stack.service.login({...CREDENTIALS, email: 'inconnu@claimflow.test'}));
        const wrong = await refusal(stack.service.login({...CREDENTIALS, password: 'mauvais mot de passe'}));

        expect(unknown).toEqual(wrong);
    });

    // Compter les scrypt est plus fiable qu'un chronomètre : même travail, même durée.
    it('effectue le même travail dans les deux cas', async () => {
        const stack = fakeStack();
        await seedUser(stack.repository, `hashed:${ALICE.password}`);
        await refusal(stack.service.login({...CREDENTIALS, email: 'chauffe@claimflow.test'}));
        const hash = vi.spyOn(stack.hasher, 'hash');
        const verify = vi.spyOn(stack.hasher, 'verify');

        await refusal(stack.service.login({...CREDENTIALS, email: 'inconnu@claimflow.test'}));
        const unknown = {hash: hash.mock.calls.length, verify: verify.mock.calls.length};
        vi.clearAllMocks();
        await refusal(stack.service.login({...CREDENTIALS, password: 'mauvais mot de passe'}));

        expect({hash: hash.mock.calls.length, verify: verify.mock.calls.length}).toEqual(unknown);
    });

    it('utilise un leurre aussi coûteux qu\'un vrai compte', async () => {
        const stack = createAuthStack();
        const hash = vi.spyOn(stack.hasher, 'hash');

        await refusal(stack.service.login(CREDENTIALS));
        const dummy = await hash.mock.results[0]?.value as string;

        await expect(stack.hasher.needsRehashedPassword(dummy)).resolves.toBe(false);
    });
});

describe('oracle : élévation de privilèges', () => {
    it.each(Object.values(Role).filter((role) => role !== Role.POLICYHOLDER))(
        'ignore le rôle %s envoyé dans le corps JSON',
        async (role) => {
            const {service, repository} = fakeStack();
            const body: unknown = JSON.parse(JSON.stringify({...ALICE, role, isAdmin: true}));

            const session = await service.register(registerSchema.parse(body));

            expect(session.user.role).toBe(Role.POLICYHOLDER);
            expect(repository.users[0]?.role).toBe(Role.POLICYHOLDER);
            expect(decodeJwt(session.accessToken)['role']).toBe(Role.POLICYHOLDER);
        },
    );

    it('impose le rôle même si le schéma est contourné', async () => {
        const {service} = fakeStack();
        const smuggled = {...ALICE, role: Role.ADMIN} as RegisterInput;

        const session = await service.register(smuggled);

        expect(session.user.role).toBe(Role.POLICYHOLDER);
    });

    it('refuse la pollution de prototype', async () => {
        const body: unknown = JSON.parse(
            `{"email":"${ALICE.email}","password":"${ALICE.password}","fullName":"${ALICE.fullName}",`
            + '"__proto__":{"role":"ADMIN"},"constructor":{"prototype":{"role":"ADMIN"}}}',
        );

        const input = registerSchema.parse(body);

        expect(input).toEqual(ALICE);
        expect(({} as Record<string, unknown>)['role']).toBeUndefined();
    });

    it('n\'accepte pas un jumeau Unicode d\'un compte existant', async () => {
        const {service} = fakeStack();
        await service.register(registerSchema.parse({...ALICE, email: 'mike@claimflow.test'}));

        // U+212A (signe Kelvin) devient un "k" ordinaire avec toLowerCase().
        const twin = registerSchema.parse({...ALICE, email: 'miKe@claimflow.test'});

        await expect(service.register(twin)).rejects.toBeInstanceOf(ConflictError);
    });
});

describe('oracle : injection et confusion de types', () => {
    const payloads: [string, unknown][] = [
        ['opérateur Prisma', {contains: '@'}],
        ['opérateur négatif', {not: ''}],
        ['tableau', [ALICE.email]],
        ['null', null],
        ['nombre', 42],
        ['booléen', true],
    ];

    it.each(payloads)('refuse dans email : %s', (_label, email) => {
        expect(loginSchema.safeParse({...CREDENTIALS, email}).success).toBe(false);
        expect(registerSchema.safeParse({...ALICE, email}).success).toBe(false);
    });

    it.each(payloads)('refuse dans password : %s', (_label, password) => {
        expect(loginSchema.safeParse({...CREDENTIALS, password}).success).toBe(false);
        expect(registerSchema.safeParse({...ALICE, password}).success).toBe(false);
    });

    it.each([
        ['SQL', '\' OR 1=1 --@claimflow.test'],
        ['injection d\'en-tête', 'alice@claimflow.test\r\nBcc: pirate@evil.test'],
        ['octet nul', 'alice\u0000@claimflow.test'],
        ['homoglyphe cyrillique', 'аlice@claimflow.test'],
        ['balise HTML', '<script>@claimflow.test'],
        ['deux adresses', 'alice@claimflow.test,pirate@evil.test'],
    ])('refuse l\'email piégé : %s', (_label, email) => {
        expect(loginSchema.safeParse({...CREDENTIALS, email}).success).toBe(false);
    });

    it('résiste à un retour arrière catastrophique sur l\'email (ReDoS)', () => {
        const start = performance.now();

        loginSchema.safeParse({...CREDENTIALS, email: `${'a.'.repeat(50_000)}@`});

        expect(performance.now() - start).toBeLessThan(500);
    });

    it('ne plante jamais sur une entrée aléatoire', () => {
        // Générateur à graine fixe : un échec se rejoue à l'identique.
        let seed = 20261031;
        const next = (max: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % max;
        };
        const values: unknown[] = [
            '', ' ', '@', 'a@b.co', 'x'.repeat(200), '\u0000', '\uD800', 0, -1, NaN, null, undefined,
            true, [], {}, {length: 1}, [ALICE.email],
        ];

        for (let i = 0; i < 1000; i++) {
            const input = {
                email: values[next(values.length)],
                password: values[next(values.length)],
                fullName: values[next(values.length)],
            };
            for (const schema of [registerSchema, loginSchema]) {
                const result = schema.safeParse(input);
                if (result.success) expect(typeof result.data.password).toBe('string');
            }
        }
    });
});

describe('oracle : déni de service', () => {
    it.each([
        ['register', registerSchema, ALICE],
        ['login', loginSchema, CREDENTIALS],
    ])('coupe un mot de passe géant avant scrypt : %s', (_label, schema, base) => {
        expect(schema.safeParse({...base, password: 'x'.repeat(1_000_000)}).success).toBe(false);
    });

    it('ne recalcule pas le leurre sous une rafale d\'emails inconnus', async () => {
        const stack = fakeStack();
        const hash = vi.spyOn(stack.hasher, 'hash');

        await Promise.all(Array.from({length: 50}, (_, i) => refusal(
            stack.service.login({...CREDENTIALS, email: `inconnu${i}@claimflow.test`}),
        )));

        expect(hash).toHaveBeenCalledOnce();
    });

    it('ne reste pas bloqué après une panne du leurre pendant une rafale', async () => {
        const stack = fakeStack();
        vi.spyOn(stack.hasher, 'hash').mockRejectedValueOnce(new Error('out of memory'));

        const results = await Promise.allSettled(Array.from({length: 10}, () => stack.service.login(CREDENTIALS)));

        expect(results.every((result) => result.status === 'rejected')).toBe(true);
        await expect(refusal(stack.service.login(CREDENTIALS))).resolves.toEqual(INVALID_CREDENTIALS);
    });

    it('ne multiplie pas les scrypt d\'un compte à jour', async () => {
        const stack = fakeStack();
        await seedUser(stack.repository, `hashed:${ALICE.password}`);
        const hash = vi.spyOn(stack.hasher, 'hash');

        await Promise.all(Array.from({length: 20}, () => stack.service.login(CREDENTIALS)));

        expect(hash).not.toHaveBeenCalled();
    });
});

describe('oracle : concurrence', () => {
    it('ne crée qu\'un compte sur des inscriptions simultanées', async () => {
        const {service, repository} = fakeStack();

        const results = await Promise.allSettled(Array.from({length: 10}, () => service.register(ALICE)));
        const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);

        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        expect(failures.every((reason) => reason instanceof ConflictError)).toBe(true);
        expect(repository.users).toHaveLength(1);
    });
});

describe('oracle : fuite de secrets', () => {
    let stack: ReturnType<typeof createAuthStack>;

    beforeEach(() => {
        stack = createAuthStack();
    });

    it.each(['register', 'login'] as const)('%s ne renvoie ni mot de passe ni hachage', async (action) => {
        const registered = await stack.service.register(ALICE);
        const session = action === 'register' ? registered : await stack.service.login(CREDENTIALS);
        const json = JSON.stringify(session);

        expect(json).not.toContain(ALICE.password);
        expect(json).not.toContain('scrypt$');
        expect(Object.keys(session?.user ?? {}).sort()).toEqual(['email', 'fullName', 'id', 'role']);
    });

    it('ne place que le minimum dans le token', async () => {
        const {accessToken} = await stack.service.register(ALICE);

        expect(Object.keys(decodeJwt(accessToken)).sort())
            .toEqual(['aud', 'exp', 'iat', 'iss', 'role', 'sub']);
    });

    it('me n\'expose pas le hachage', async () => {
        await stack.service.register(ALICE);

        const profile = await stack.service.me('user-1');

        expect(JSON.stringify(profile)).not.toContain('scrypt$');
    });

    it('n\'écrit pas le mot de passe dans une erreur de validation', () => {
        const password = 'mon-secret';

        const result = registerSchema.safeParse({...ALICE, password, email: 'invalide'});

        expect(JSON.stringify(result.error)).not.toContain(password);
    });

    it('ne reflète pas l\'email ni le mot de passe dans le refus', async () => {
        const refused = await refusal(stack.service.login(CREDENTIALS));

        expect(JSON.stringify(refused)).not.toContain(ALICE.email);
        expect(JSON.stringify(refused)).not.toContain(ALICE.password);
    });
});

describe('oracle : pannes', () => {
    it('reste fermé si la vérification du mot de passe plante', async () => {
        const stack = fakeStack();
        await seedUser(stack.repository, `hashed:${ALICE.password}`);
        const sign = vi.spyOn(stack.tokens, 'sign');
        vi.spyOn(stack.hasher, 'verify').mockRejectedValueOnce(new Error('scrypt failed'));

        await expect(stack.service.login(CREDENTIALS)).rejects.toThrow('scrypt failed');

        expect(sign).not.toHaveBeenCalled();
    });

    it('reste fermé si la base plante', async () => {
        const stack = fakeStack();
        vi.spyOn(stack.repository, 'findByEmail').mockRejectedValueOnce(new Error('db down'));

        await expect(stack.service.login(CREDENTIALS)).rejects.toThrow('db down');
    });

    it('ne renvoie jamais une réponse vide', async () => {
        const stack = fakeStack();
        await seedUser(stack.repository, `hashed:${ALICE.password}`);
        vi.spyOn(stack.hasher, 'needsRehashedPassword').mockResolvedValue(true);
        vi.spyOn(stack.repository, 'updatePasswordHash').mockRejectedValueOnce(new Error('db down'));

        const outcome = await stack.service.login(CREDENTIALS).catch((error: unknown) => error);

        expect(outcome).toBeDefined();
    });
});

describe('oracle : falsification du token de session', () => {
    const CLAIMS = {sub: 'user-1', role: Role.ADMIN};
    const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

    function forge({
        secret = SECRET,
        alg = 'HS256',
        issuer = 'claimflow',
        audience = 'claimflow-api',
        expiresIn = '1h',
    } = {}) {
        return new SignJWT({role: CLAIMS.role})
            .setProtectedHeader({alg})
            .setSubject(CLAIMS.sub)
            .setIssuer(issuer)
            .setAudience(audience)
            .setIssuedAt()
            .setExpirationTime(expiresIn)
            .sign(new TextEncoder().encode(secret));
    }

    function claims() {
        return {...CLAIMS, iss: 'claimflow', aud: 'claimflow-api', exp: Math.floor(Date.now() / 1000) + 3600};
    }

    let stack: ReturnType<typeof createAuthStack>;
    let accessToken: string;

    beforeEach(async () => {
        stack = fakeStack();
        ({accessToken} = await stack.service.register(ALICE));
    });

    it('accepte le token légitime (témoin)', async () => {
        await expect(stack.tokens.verify(accessToken)).resolves.toMatchObject({id: 'user-1'});
    });

    it('refuse un rôle modifié avec la signature d\'origine', async () => {
        const [header, , signature] = accessToken.split('.');
        const tampered = `${header}.${base64url(claims())}.${signature}`;

        await expect(refusal(stack.tokens.verify(tampered))).resolves.toMatchObject({statusCode: 401});
    });

    it('refuse un token sans signature', async () => {
        const [header, payload] = accessToken.split('.');

        await expect(refusal(stack.tokens.verify(`${header}.${payload}.`)))
            .resolves.toMatchObject({statusCode: 401});
    });

    it('refuse alg=none', async () => {
        const token = `${base64url({alg: 'none', typ: 'JWT'})}.${base64url(claims())}.`;

        await expect(refusal(stack.tokens.verify(token))).resolves.toMatchObject({statusCode: 401});
    });

    it('refuse la confusion RS256 / HS256', async () => {
        const unsigned = `${base64url({alg: 'RS256', typ: 'JWT'})}.${base64url(claims())}`;
        const signature = createHmac('sha256', SECRET).update(unsigned).digest('base64url');

        await expect(refusal(stack.tokens.verify(`${unsigned}.${signature}`)))
            .resolves.toMatchObject({statusCode: 401});
    });

    it.each([
        ['secret deviné', {secret: 'secret-de-l-attaquant-de-32-caracteres'}],
        ['autre algorithme avec le bon secret', {alg: 'HS512', secret: SECRET.repeat(2)}],
        ['autre émetteur', {issuer: 'evil'}],
        ['autre audience', {audience: 'autre-api'}],
        ['token expiré', {expiresIn: '-1s'}],
    ])('refuse : %s', async (_label, options) => {
        await expect(refusal(stack.tokens.verify(await forge(options))))
            .resolves.toMatchObject({statusCode: 401});
    });
});

describe('oracle : accès au profil d\'autrui (BOLA)', () => {
    it.each([
        ['injection SQL', '\' OR \'1\'=\'1'],
        ['traversée de chemin', '../admin'],
        ['joker', '*'],
        ['vide', ''],
    ])('ne trouve aucun compte avec un identifiant piégé : %s', async (_label, id) => {
        const stack = fakeStack();
        await stack.service.register(ALICE);

        await expect(stack.service.me(id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it('renvoie uniquement le compte du token', async () => {
        const stack = fakeStack();
        await stack.service.register(ALICE);
        const bob = await stack.service.register({...ALICE, email: 'bob@claimflow.test'});
        const auth = await stack.tokens.verify(bob.accessToken);

        const profile = await stack.service.me(auth?.id ?? '');

        expect(profile.email).toBe('bob@claimflow.test');
    });
});

describe('oracle : pré-détournement de compte', () => {
    it.each([
        ['BOM en tête', '\uFEFFalice@claimflow.test'],
        ['espace insécable', '\u00A0alice@claimflow.test\u00A0'],
        ['majuscules', 'ALICE@CLAIMFLOW.TEST'],
    ])('ramène l\'adresse sur le compte existant : %s', async (_label, email) => {
        const {service} = fakeStack();
        await service.register(ALICE);

        await expect(service.register(registerSchema.parse({...ALICE, email})))
            .rejects.toBeInstanceOf(ConflictError);
    });

    it.each([
        ['espace de largeur nulle', 'ali\u200Bce@claimflow.test'],
        ['pleine chasse', 'ａlice@claimflow.test'],
        ['i sans point', 'alıce@claimflow.test'],
        ['i pointé turc', 'ALİCE@claimflow.test'],
        ['domaine terminé par un point', 'alice@claimflow.test.'],
    ])('refuse une adresse qui imite un compte : %s', (_label, email) => {
        expect(registerSchema.safeParse({...ALICE, email}).success).toBe(false);
    });
});

describe('oracle : dictionnaire et mots de passe faibles', () => {
    it.each([
        ['12 espaces', ' '.repeat(12)],
        ['caractère répété', 'a'.repeat(12)],
        ['suite de chiffres', '123456789012'],
        ['mot courant répété', 'passwordpassword'],
    ])('refuse à l\'inscription : %s', (_label, password) => {
        expect(registerSchema.safeParse({...ALICE, password}).success).toBe(false);
    });

    it('coupe aussi un mot de passe géant et répétitif sans s\'emballer', () => {
        const start = performance.now();

        registerSchema.safeParse({...ALICE, password: `${'ab'.repeat(500_000)}c`});

        expect(performance.now() - start).toBeLessThan(500);
    });
});

describe('oracle : vol de la base', () => {
    it('ne permet pas de repérer deux comptes au même mot de passe', async () => {
        const {service, repository} = createAuthStack();
        await service.register(ALICE);
        await service.register({...ALICE, email: 'bob@claimflow.test'});

        const [alice, bob] = repository.users;

        expect(alice?.passwordHash).not.toBe(bob?.passwordHash);
    });

    it('stocke uniquement un hachage scrypt au coût configuré', async () => {
        const {service, repository} = createAuthStack();

        await service.register(ALICE);

        const stored = repository.users[0]?.passwordHash ?? '';
        expect(stored.startsWith('scrypt$14$8$1$')).toBe(true);
        expect(stored).not.toContain(ALICE.password);
    });

    it('n\'abaisse jamais le coût d\'un hachage plus solide', async () => {
        const strong = await new ScryptPasswordHasher(15).hash(ALICE.password);
        const stack = createAuthStack();
        await seedUser(stack.repository, strong);

        await stack.service.login(CREDENTIALS);

        expect(stack.repository.users[0]?.passwordHash).toBe(strong);
    });

    it('garde un compte utilisable après des renouvellements simultanés', async () => {
        const hasher = new ScryptPasswordHasher(15);
        const stack = createAuthStack(hasher);
        await seedUser(stack.repository, await new ScryptPasswordHasher(14).hash(ALICE.password));

        await Promise.all(Array.from({length: 5}, () => stack.service.login(CREDENTIALS)));

        expect(stack.repository.users[0]?.passwordHash.startsWith('scrypt$15$')).toBe(true);
        await expect(stack.service.login(CREDENTIALS)).resolves.toMatchObject({user: {email: ALICE.email}});
    });
});

describe('oracle : contenu stocké piégé', () => {
    it.each([
        ['retour à la ligne (faux journal)', 'Alice\r\n[ADMIN] accès accordé'],
        ['octet nul', 'Alice\u0000Durand'],
        ['inversion de sens (usurpation d\'affichage)', 'Alice \u202Enimda'],
    ])('refuse dans fullName : %s', (_label, fullName) => {
        expect(registerSchema.safeParse({...ALICE, fullName}).success).toBe(false);
    });
});

// Ces attaques demandent une fonctionnalité ou un arbitrage, pas une correction de ces deux fichiers.
describe('oracle : non couvert aujourd\'hui', () => {
    it.todo('freine le bourrage d\'identifiants et la pulvérisation de mots de passe (limite de débit)');
    it.todo('ne révèle pas à l\'inscription qu\'un email a déjà un compte (409 Email already exists)');
    it.todo('révoque un token après suppression du compte ou changement de rôle');
    it.todo('compare les mots de passe aux fuites connues (Have I Been Pwned)');
});

describe('oracle : refus typé', () => {
    it('refuse avec une erreur 401 et non une erreur technique', async () => {
        const {service} = fakeStack();

        await expect(service.login(CREDENTIALS)).rejects.toBeInstanceOf(UnauthorizedError);
    });
});
