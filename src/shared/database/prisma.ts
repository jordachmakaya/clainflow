import  {PrismaClient} from "../../generated/prisma/client.js";
import {Prisma} from "@prisma/client/extension";
import {PrismaPg} from "@prisma/adapter-pg";

export function createPrimaClient(connectionString:string):PrismaClient {
    return new PrismaClient({
        adapter: new PrismaPg({connectionString}),
    })
}

export type {PrismaClient }