import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// Tests sur un vrai PostgreSQL, à part de `vitest.config.ts` : la suite par défaut et la CI n'ont pas de base.
export default defineConfig({
    test: {
        fileParallelism: false,
        env: { NODE_ENV: 'test' },
        include: ['test/integration/**/*.test.ts'],
    },
});
