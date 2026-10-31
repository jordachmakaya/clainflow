import {type Policy, PolicyProduct, Role, type User} from "../../generated/prisma/client.js";
import type {PolicyRepository} from "./policies.repository.js";
import type {UserRepository} from "../users/users.repository.js";
import type {Clock} from "../../shared/time/clock.js";
import {type CreatePolicyInput, type PolicyResponse, toPolicyResponse} from "./policies.schemas.js";
import {NotFoundError, UnprocessableEntityError} from "../../shared/http/http-error.js";
import {referenceCode} from "../../shared/ids/reference.js";
import type {AuthUser} from "../auth/auth.types.js";
import type {Page, Pagination} from "../../shared/http/pagination.js";
import {isPrismaError, PrismaErrorCode} from "../../shared/database/prisma-errors.js";
import {calendarDateIn} from "../../shared/time/calendar.js";


const NUMBER_PREFIX:Record<PolicyProduct, string> = {
    [PolicyProduct.HOME]: "HAB",
    [PolicyProduct.MOTOR]: "AUT",
}

const NUMBER_ATTEMPTS = 5

export class PolicyService {
    constructor(
        private readonly policy : PolicyRepository,
        private readonly users:UserRepository,
        private readonly clock:Clock,
    ) {}


    /** souscription simplifiée (back-office) : l'énoncé ne couvre pas la tarification. */
    async create(data:CreatePolicyInput): Promise<PolicyResponse> {
        const holder :User |null = await this.users.findById(data.holderId)

        if(!holder || holder.role !== Role.POLICYHOLDER) {
            throw new UnprocessableEntityError('holderId must reference a policyholder')
        }
        return toPolicyResponse(await this.createWithUniqueNumber(data))
    }

    // Une collision reste possible avec 6 caractères : la contrainte UNIQUE la révèle, on retire un numéro.
    private async createWithUniqueNumber(data:CreatePolicyInput): Promise<Policy> {
        // L'année métier est celle de Paris : le 31 décembre à 23h30 UTC, on y est déjà le 1er janvier.
        const year = calendarDateIn(this.clock.now()).getUTCFullYear()

        for (let attempt = 1; ; attempt++) {
            const number = referenceCode(NUMBER_PREFIX[data.product], year, 6)
            try {
                return await this.policy.create({...data,number})
            } catch (error) {
                const canRetry = attempt < NUMBER_ATTEMPTS && isPrismaError(error, PrismaErrorCode.UNIQUE_VIOLATION)
                if(!canRetry) throw error
            }
        }
    }

   async list(user:AuthUser,pagination: Pagination): Promise<Page<PolicyResponse>>{
       // Un assuré ne voit que SES contrats ; le personnel voit tout.
        const holderId :string | undefined  = user.role === Role.POLICYHOLDER ? user.id : undefined

        const {items, total} = await this.policy.list(holderId, pagination);
        return {items: items.map(toPolicyResponse), total,...pagination}
    }

    async get(user:AuthUser ,policyId:string):Promise<PolicyResponse>{
        return toPolicyResponse(await this.getVisiblePolicy(user,policyId))
    }
    async getVisiblePolicy(user:AuthUser ,policyId:string):Promise<Policy> {
        const policy: Policy | null = await this.policy.findById(policyId)
        // 404 (et pas 403) si le contrat appartient à quelqu'un d'autre : on ne confirme pas son existence.
        if(!policy || (user.role === Role.POLICYHOLDER && policy.holderId !== user.id)){
            throw new NotFoundError('This Policy does not exist')
        }
        return policy
    }
}