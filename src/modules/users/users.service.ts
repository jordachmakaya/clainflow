import type {NewUser, UserRepository} from "./users.repository.js";
import type {PasswordHasher} from "../auth/password-hasher.js";
import type {BreachChecker} from "./breached-password.js";
import {ConflictError, UnprocessableEntityError} from "../../shared/http/http-error.js";
import {type CreateStaffInput, type PublicUser, toPublicUser} from "./users.schemas.js";
import {isPrismaError, PrismaErrorCode} from "../../shared/database/prisma-errors.js";
import type {Role} from "../../generated/prisma/enums.js";
import type {Page, Pagination} from "../../shared/http/pagination.js";


export class UsersService{
    constructor(
        private readonly users:UserRepository,
        private readonly hasher:PasswordHasher,
        private readonly breaches:BreachChecker,
        ){}

    async createAccount(input: Omit<NewUser, 'passwordHash'> & { password: string }) {
        const userAlreadyExist = await this.users.findByEmail(input.email)
        if(userAlreadyExist){
            throw new ConflictError('Email already exists');
        }
        if(await this.breaches.isBreached(input.password)){
            throw new UnprocessableEntityError('This password appears in a known data breach');
        }
        const passwordHash: string = await this.hasher.hash(input.password);
        if(!passwordHash){
            throw new Error("Something went wrong");
        }
        try {
            const user = await this.users.create({
                email:input.email,
                fullName: input.fullName,
                role:input.role,
                passwordHash
            })
            return toPublicUser(user);
        } catch (error) {
            // Deux créations simultanées passent le contrôle ci-dessus : la contrainte UNIQUE tranche.
            if(isPrismaError(error, PrismaErrorCode.UNIQUE_VIOLATION)){
                throw new ConflictError('Email already exists');
            }
            throw error
        }
    }

    createStaff(input: CreateStaffInput): Promise<PublicUser> {
        return this.createAccount(input);
    }

    async listByRole(role: Role, pagination: Pagination): Promise<Page<PublicUser>> {
        const {items, total} = await this.users.listByRole(role, pagination);
        return {items: items.map(toPublicUser), total, ...pagination};
    }
}