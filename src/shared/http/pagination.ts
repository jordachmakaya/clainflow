import {z} from "zod"

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100
const MAX_PAGE = 1_000_000

// Valeurs lues dans la query string : des chaînes, d'où z.coerce.
export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().max(MAX_PAGE).default(1),
    pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

export type Pagination = z.infer<typeof paginationSchema>

/** Ce que renvoie un dépôt : une tranche de résultats et le total sans pagination. */
export interface PageResult<T> {
    items: T[]
    total: number
}

/** Ce que renvoie l'API. */
export interface Page<T> extends PageResult<T>, Pagination {}

export function toSkipTake({page, pageSize}: Pagination) {
    return {skip: (page - 1) * pageSize, take: pageSize}
}
