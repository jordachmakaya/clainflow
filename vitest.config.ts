import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
        // Tests HTTP + base partagée : on évite les fichiers qui s'exécutent en même temps.
        fileParallelism: false,
        env: { NODE_ENV: 'test' },
    },
});