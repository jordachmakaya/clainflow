import type { Policy, PrismaClient } from '../../generated/prisma/client.js';
import type { PolicyProduct } from '../../generated/prisma/enums.js';
import {type PageResult, type Pagination, toSkipTake} from "../../shared/http/pagination.js";

export type {Policy}

export interface NewPolicy {
    number:string
    holderId:string
    product:PolicyProduct
    coverageStart:Date
    coverageEnd:Date
    deductible:number
}
/**
 * Trois méthodes, nommées en langage métier (list(holderId?)), sans aucune règle :
 * le repository traduit, il ne décide pas. Le type Policy vient du client généré : un seul modèle, pas de duplication
 * */
export interface PolicyRepository {
    create(data:NewPolicy):Promise<Policy>
    findById(id:string):Promise<Policy | null>
    list(holderId:string | undefined, pagination:Pagination):Promise<PageResult<Policy>>
}

export class PrismaPolicyRepository  implements PolicyRepository {
    constructor(private readonly prisma: PrismaClient) {}

    create(data:NewPolicy):Promise<Policy>{
        return this.prisma.policy.create({ data: data })
    }

    findById(id: string): Promise<Policy | null> {
        return this.prisma.policy.findUnique({ where: { id: id } })
    }

    async list(holderId:string | undefined, pagination:Pagination):Promise<PageResult<Policy>>{
        const where = holderId ? { holderId } : {};
        const [items, total] = await this.prisma.$transaction([
            // L'id départage les contrats créés au même instant : sans ordre stable, un contrat
            // pourrait apparaître sur deux pages ou sur aucune.
            this.prisma.policy.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
                ...toSkipTake(pagination),
            }),
            this.prisma.policy.count({ where }),
        ])
        return { items, total };
    }
}