import {describe, expect, it} from "vitest";
import {
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    paginationSchema,
    toSkipTake,
} from "../../../src/shared/http/pagination.js";

describe('paginationSchema', () => {
    it('applique les valeurs par défaut', () => {
        expect(paginationSchema.parse({})).toEqual({page: 1, pageSize: DEFAULT_PAGE_SIZE});
    });

    it('convertit les chaînes de la query string', () => {
        expect(paginationSchema.parse({page: '3', pageSize: '50'})).toEqual({page: 3, pageSize: 50});
    });

    it('accepte la taille maximale', () => {
        expect(paginationSchema.parse({pageSize: String(MAX_PAGE_SIZE)}).pageSize).toBe(MAX_PAGE_SIZE);
    });

    it.each([
        ['page nulle', {page: '0'}],
        ['page négative', {page: '-1'}],
        ['page décimale', {page: '1.5'}],
        ['page non numérique', {page: 'abc'}],
        ['page vide', {page: ''}],
        ['page démesurée', {page: '1000001'}],
        ['page en double', {page: ['1', '2']}],
        ['taille nulle', {pageSize: '0'}],
        ['taille trop grande', {pageSize: String(MAX_PAGE_SIZE + 1)}],
        ['taille non numérique', {pageSize: 'abc'}],
    ])('refuse : %s', (_label, query) => {
        expect(paginationSchema.safeParse(query).success).toBe(false);
    });
});

describe('toSkipTake', () => {
    it.each([
        [1, 20, 0],
        [2, 20, 20],
        [3, 50, 100],
    ])('page %d de %d éléments : saute %d', (page, pageSize, skip) => {
        expect(toSkipTake({page, pageSize})).toEqual({skip, take: pageSize});
    });
});
