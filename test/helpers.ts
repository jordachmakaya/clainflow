import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createContainer } from '../src/container.js';

// Construit une app de test avec une config contrôlée (pas de .env lu).
export function createTestApp(overrides: Record<string, string> = {}): Express {
    const config = loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', ...overrides });
    return createApp(createContainer(config));
}