import {describe, expect, it} from "vitest";
import request from 'supertest'
import {createTestApp} from "./helpers.js";
import {loadConfig} from "../src/config/env.js";


describe("App socle", () => {
    const app = createTestApp();

    it('GET /health → 200', async () => {
        await request(app)
            .get('/health')
            .expect(200, {status: "OK"});
    })

    it("unknown route -> 404 in standard format", async () => {
        const res = await request(app).get('/nope').expect(404)
        expect(res.body).toEqual({
            statusCode: 404,
            message: 'Route GET /nope not found',
        });
    })

    it("JSON wrong format get -> 400", async () => {
        await request(app)
            .post('/health')
            .set('Content-Type', 'application/json')
            .send('{ "a": ')
            .expect(400, {
                statusCode: 400,
                message: "invalid JSON body"
       });
    })

        it('ajoute les en-têtes de sécurité (helmet) et masque x-powered-by', async () => {
            const res = await request(app).get('/health');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['x-powered-by']).toBeUndefined();
        });

        it('config invalide → erreur au démarrage', () => {
            expect(() => loadConfig({ PORT: 'abc' })).toThrow();
        });

})