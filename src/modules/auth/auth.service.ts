import type {Logger} from "pino";
import type {User, UserRepository} from "../users/users.repository.js";
import type {UsersService} from "../users/users.service.js";
import type {PasswordHasher} from "./password-hasher.js";
import type {TokenService} from "./token-service.js";
import type {AuthResponse, LoginInput, RegisterInput} from "./auth.schemas.js";
import {Role} from "../../generated/prisma/enums.js";
import {type PublicUser, toPublicUser} from "../users/users.schemas.js";
import {NotFoundError, UnauthorizedError} from "../../shared/http/http-error.js";

export class AuthService {
    // Hash "leurre" calculé une fois : sert quand l'email n'existe pas (voir login).
    private dummyHash:Promise<string> | undefined;

    constructor(
        private readonly users:UserRepository,
        private readonly userService:UsersService,
        private readonly hasher: PasswordHasher,
        private readonly tokens:TokenService,
        private readonly ttlSecond:number,
        private readonly logger:Logger
    ) {}

    /** Inscription publique : on ne peut devenir QUE assuré par cette porte. */
    async register(registerInput:RegisterInput) {
        const user: PublicUser = await this.userService.createAccount({
            ...registerInput,
            role:Role.POLICYHOLDER,
        })

        return this.issue(user)
    }

    async login(input: LoginInput):Promise<AuthResponse> {
        const user: User | null = await this.users.findByEmail(input.email);

        if (!user) {
            await this.securityMesures(input)
            throw new UnauthorizedError('Invalid credentials');
        }

        const samePassword = await this.hasher.verify(input.password, user.passwordHash)

        if (!samePassword) {
            throw new UnauthorizedError('Invalid credentials'); // même message : on ne dit pas lequel est faux
        }
        // Paramètres renforcés depuis la création du compte ? On en profite : on a le mot de passe en clair.
        if (await this.hasher.needsRehashedPassword(user.passwordHash)) {
            try {
                await this.users.updatePasswordHash(user.id, await this.hasher.hash(input.password));
            } catch (error) {
                // Le mot de passe est bon : un renouvellement raté ne doit pas bloquer la connexion.
                this.logger.warn({err: error, userId: user.id}, 'Password rehash failed');
            }
        }

        return this.issue(toPublicUser(user));
    }


    private async securityMesures(loginInput: LoginInput) {
        // ⏱️ On hache quand même : sinon "email inconnu" répond en 1 ms et "mauvais mot de passe"
        // en 500 ms, et un attaquant peut deviner quels emails ont un compte.
        this.dummyHash ??= this.hasher.hash('dummy-password-for-timing').catch((error: unknown) => {
            // On ne garde pas un échec en cache : le prochain login retentera le calcul.
            this.dummyHash = undefined;
            throw error;
        });
        await this.hasher.verify(loginInput.password, await this.dummyHash);
    }

    async me(userId:string):Promise<PublicUser> {
        const user = await this.users.findById(userId)
        if (!user) throw new NotFoundError('This account may not be well configured');
        return toPublicUser(user)
    }

    private async issue(user:PublicUser) {
        const accessToken = await this.tokens.sign({
            id:user.id,
            role:user.role,
        })

       return {accessToken:accessToken,tokenType:'Bearer', expiresIn:this.ttlSecond,user:user};
    }
}