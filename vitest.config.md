# Corriger `test:unit` et `test:e2e` (`vitest.config.ts`)

**Gravité : moyenne.** Les deux scripts de `package.json` visent des projets Vitest qui n'existent pas.

## Le bug

`package.json` demande les projets `unit` et `e2e` :

```json
"test:unit": "vitest run --project unit",
"test:e2e": "vitest run --project e2e"
```

Mais `vitest.config.ts` n'en déclare aucun. `pnpm run test:unit` s'arrête donc sur une erreur au lieu de lancer les tests. `pnpm test` n'est pas touché, car il ne filtre pas par projet.

## La correction

### Étape 1 : comprendre le découpage

| Projet | Contenu | Fichiers |
|---|---|---|
| `unit` | Une fonction ou classe isolée | `test/config`, `test/shared`, `src/**/*.test.ts` |
| `e2e` | L'application complète, de la requête à la réponse | `test/app.test.ts`, `test/server.test.ts` |

### Étape 2 : déclarer les projets

Trois changements dans `vitest.config.ts` :

1. Retirez le `include` global : chaque projet a désormais le sien.
2. Ajoutez le bloc `projects`.
3. Laissez `coverage` au niveau global, c'est sa place. `extends: true` fait hériter chaque projet de `fileParallelism` et `env`.

Le fichier complet devient :

```ts
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
```

### Étape 3 : vérifier

```bash
pnpm run test:unit
pnpm run test:e2e
pnpm run test:coverage
```

Les deux premières commandes doivent lancer des tests différents, et la troisième les deux ensemble.

## Attention pour la suite

Avec ces `include`, un test placé hors de ces chemins n'est **lancé par aucun projet**, sans message d'avertissement. Si vous créez un nouveau dossier de tests (par exemple `test/modules`), ajoutez-le à la liste du bon projet.
