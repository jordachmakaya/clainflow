import type {PrismaClient, Role} from '../../generated/prisma/client.js';
import type { User } from '../../generated/prisma/client.js';
import {type PageResult, type Pagination, toSkipTake} from '../../shared/http/pagination.js';


export type {User}

export interface NewUser {
    email: string;
    passwordHash: string;
    fullName: string;
    role: Role;
}

export interface UserRepository {
    create(data: NewUser): Promise<User>;
    findByEmail(email: string): Promise<User | null>;
    findById(id: string): Promise<User | null>;
    listByRole(role: Role, pagination: Pagination): Promise<PageResult<User>>;
    updatePasswordHash(id:string,passwordHash: string): Promise<void>;
}

export class PrismaUserRepository implements UserRepository {
    constructor(private readonly prisma: PrismaClient) {}

    create(data: NewUser): Promise<User> {
        return this.prisma.user.create({ data })
    }

    findByEmail(email: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { email } })
    }

    findById(id: string): Promise<User | null> {
        return this.prisma.user.findUnique({ where: { id } })
    }

    async listByRole(role: Role, pagination: Pagination): Promise<PageResult<User>> {
        const where = { role };
        const [items, total] = await this.prisma.$transaction([
            // L'id départage les homonymes : sans ordre stable, un utilisateur pourrait
            // apparaître sur deux pages ou sur aucune.
            this.prisma.user.findMany({
                where,
                orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
                ...toSkipTake(pagination),
            }),
            this.prisma.user.count({ where }),
        ]);
        return { items, total };
    }

    async updatePasswordHash(id:string,passwordHash:string): Promise<void> {
        await this.prisma.user.update({where: {id}, data : {passwordHash}})
    }
}