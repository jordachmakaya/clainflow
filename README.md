
```aiignore
 # Lancer Container
docker run --rm -p 3000:3000 -e PORT=3000 claimflow
```

## Performance du hachage des mots de passe

Mesures de `ScryptPasswordHasher` (`src/modules/auth/password-hasher.ts`) avec `log2N=17`, le 30 octobre 2026, sur un PC Windows à 12 cœurs logiques, avec Node 24.16 et 4 threads libuv (valeur par défaut).

| Scénario | Temps total | Hachage le plus lent | Retard max. de la boucle Node |
| --- | --- | --- | --- |
| 1 hachage | 225 ms | 225 ms | 16 ms |
| 4 hachages simultanés | 371 ms | 371 ms | 16 ms |
| 8 hachages simultanés | 719 ms | 719 ms | 18 ms |
| 1 `scryptSync` (à éviter) | 295 ms | 295 ms | 246 ms |

Pic de mémoire du processus sur l'ensemble du test : 580 Mo.

Ces valeurs viennent d'une seule exécution sur un poste de développement. Elles ne représentent pas la production : aucune mesure n'a été faite sur AWS, où la tâche Fargate actuelle dispose de 0,25 vCPU et 512 Mo.

## Test de charge

```bash
pnpm run test:stress
```

Docker doit tourner. Le détail est écrit dans `test/stress/results.log`, ignoré par git.

**Durée :** 12 min 29 s pour l'exécution complète du 30 octobre 2026, construction de l'image comprise. Chaque palier dure 20 s pour les connexions et 10 s pour `/health`.

Le test lance la vraie image dans Docker avec les limites de la tâche Fargate, puis chaque utilisateur enchaîne les requêtes sans pause. `/login` n'existe pas encore dans l'API : `test/stress/stress-server.mjs` reproduit son coût avec `hasher.verify()`, sans base de données.

### Test n° 1 : conditions

Ces résultats ne sont comparables à un prochain test que si les conditions sont les mêmes. Refaire ce tableau à chaque nouveau test.

| Élément | Valeur |
| --- | --- |
| Date | 30 octobre 2026, 17 h 58 à 18 h 11 |
| Code testé | Commit `ed12060`, plus `src/modules/auth/` et d'autres changements non commités |
| Fonctionnalités de l'API | `/health` seulement : pas de vraie route métier, pas d'authentification réelle |
| Base de données | Aucune : `DATABASE_URL` est factice et aucune requête SQL n'est exécutée |
| `/login` | Route de test, définie uniquement dans `test/stress/stress-server.mjs`, qui appelle `hasher.verify()` |
| Coût scrypt | `PASSWORD_SCRYPT_LOG2N=17` |
| Logs | `LOG_LEVEL=info`, une ligne par requête `/health` |
| Environnement | Production simulée en local, rien sur AWS |
| Image | `Dockerfile` du projet, `node:22-alpine`, Node 22.23.4, `amd64` |
| Limites du conteneur | Scénarios A, B et D : 0,25 vCPU, 512 Mo. Scénario C : 0,5 vCPU, 1 Go. Sans swap |
| Threads libuv | 4 par défaut, 2 dans le scénario B |
| Conteneurs | 1 seul, sans load balancer |
| Machine | Intel Core i5-1334U, 12 cœurs logiques, 16 Go, Windows 11 |
| Docker | Docker Desktop 29.6.2, machine virtuelle de 12 CPU et 7,6 Gio |
| Générateur de charge | `test/stress/run-stress.cjs`, sur la même machine que le conteneur |
| Comportement simulé | Chaque utilisateur enchaîne les requêtes sans aucune pause, avec une connexion réutilisée |
| Paliers `/login` | 1, 2, 3, 4, 8, 16 et 32 utilisateurs, 20 s chacun, délai maximal de 30 s par requête |
| Paliers `/health` | 10, 50, 100, 250, 500, 1000 et 2000 utilisateurs, 10 s chacun, délai maximal de 10 s par requête |
| Répétitions | 1 seule exécution |

Le scénario A s'arrête à la mort du conteneur : les paliers suivants n'ont pas été testés.

### Test n° 1 : connexions simultanées

Mesures du 30 octobre 2026, avec `log2N=17`. Valeurs : temps de réponse au 95ᵉ percentile.

| Connexions simultanées | A : 0,25 vCPU, 512 Mo (actuel) | B : A avec `UV_THREADPOOL_SIZE=2` | C : 0,5 vCPU, 1 Go |
| --- | --- | --- | --- |
| 1 | 1,8 s | 1,8 s | 0,7 s |
| 2 | 4,4 s | 4,3 s | 1,5 s |
| 3 | 9,8 s | 7,0 s | 3,1 s |
| 4 | **Conteneur tué (mémoire)** | 8,2 s | 6,2 s |
| 8 | Non testé | 16,5 s | 11,5 s |
| 16 | Non testé | 29,9 s, 7 échecs | 22,0 s |
| 32 | Non testé | 30,0 s, 25 échecs | 27,8 s, 24 échecs |
| Débit observé | 0,5 à 0,7 connexion/s | 0,6 à 0,9 connexion/s | 0,8 à 1,7 connexion/s |

Pendant ces charges, tant que le conteneur reste en vie, `/health` répond en moins de 85 ms (95ᵉ percentile) : les connexions lentes ne bloquent pas le reste de l'API.

### Test n° 1 : requêtes simples

`/health` seul, avec les limites actuelles (0,25 vCPU, 512 Mo).

| Utilisateurs simultanés | Débit | Temps de réponse (95ᵉ percentile) | Échecs |
| --- | --- | --- | --- |
| 10 | 162 req/s | 197 ms | 0 |
| 50 | 227 req/s | 601 ms | 0 |
| 100 | 255 req/s | 804 ms | 14 |
| 250 | 259 req/s | 886 ms | 140 |
| 500 | 304 req/s | 707 ms | 368 |
| 1000 | 285 req/s | 788 ms | 868 |
| 2000 | 265 req/s | 801 ms | 1868 |

### Test n° 1 : estimation d'utilisateurs réels

**Environ 1 000 utilisateurs actifs en même temps** : c'est une estimation calculée, pas une valeur mesurée.

- **Calcul :** environ 250 req/s, divisées par 1 requête toutes les 5 s par utilisateur, donnent 1 250 utilisateurs, arrondis à environ 1 000.
- **Hypothèse :** le rythme d'une requête toutes les 5 s est supposé, il n'a pas été observé sur de vrais utilisateurs.
- **Portée :** ce chiffre ne vaut que pour `/health`, sans base de données. Les vraies routes seront plus lentes, donc il devra être recalculé au prochain test.
- **Ne couvre pas les connexions :** avec la configuration actuelle, 4 connexions simultanées tuent le conteneur, quel que soit le nombre d'utilisateurs déjà actifs.

### Test n° 1 : limites de ces mesures

- Docker limite le processeur de façon comparable à Fargate, sans le reproduire exactement.
- Une seule exécution a été faite, sans base de données : les vraies routes seront plus lentes.
- Au-delà de 50 utilisateurs, les échecs peuvent venir de Docker Desktop ou du générateur de charge, et pas seulement de l'API.