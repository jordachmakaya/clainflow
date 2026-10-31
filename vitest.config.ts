import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Tests HTTP + base partagée : on évite les fichiers qui s'exécutent en même temps.
        fileParallelism: false,
        env: { NODE_ENV: 'test' },
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts', 'test/config/**/*.test.ts', 'test/shared/**/*.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'e2e',
                    include: ['test/app.test.ts', 'test/server.test.ts'],
                },
            },
        ],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/generated/**'],
            reporter: ['text', 'lcov'],
            // En dessous de ce seuil, `pnpm run test:coverage` échoue (et donc la CI).
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
    },
});