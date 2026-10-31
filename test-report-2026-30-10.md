# Test report: October 30, 2026

## Password hashing performance

Measurements of `ScryptPasswordHasher` (`src/modules/auth/password-hasher.ts`) with `log2N=17`, taken on October 30, 2026, on a Windows PC with 12 logical cores, using Node 24.16 and 4 libuv threads (the default).

| Scenario | Total time | Slowest hash | Max. Node event loop delay |
| --- | --- | --- | --- |
| 1 hash | 225 ms | 225 ms | 16 ms |
| 4 concurrent hashes | 371 ms | 371 ms | 16 ms |
| 8 concurrent hashes | 719 ms | 719 ms | 18 ms |
| 1 `scryptSync` (avoid) | 295 ms | 295 ms | 246 ms |

Peak process memory across the whole test: 580 MB.

These values come from a single run on a development machine. They do not represent production: nothing was measured on AWS, where the current Fargate task has 0.25 vCPU and 512 MB.

## Load test

```bash
pnpm run test:stress
```

Docker must be running. Details are written to `test/stress/results.log`, which is ignored by git.

**Duration:** 12 min 29 s for the full run on October 30, 2026, including the image build. Each step lasts 20 s for logins and 10 s for `/health`.

The test runs the real image in Docker with the Fargate task limits, then each user sends requests back to back with no pause. `/login` does not exist in the API yet: `test/stress/stress-server.mjs` reproduces its cost with `hasher.verify()`, without a database.

### Test #1: conditions

These results can only be compared with a later test if the conditions are the same. Repeat this table for each new test.

| Item | Value |
| --- | --- |
| Date | October 30, 2026, 17:58 to 18:11 |
| Tested code | Commit `ed12060`, plus `src/modules/auth/` and other uncommitted changes |
| API features | `/health` only: no real business route, no real authentication |
| Database | None: `DATABASE_URL` is fake and no SQL query is executed |
| `/login` | Test route, defined only in `test/stress/stress-server.mjs`, which calls `hasher.verify()` |
| scrypt cost | `PASSWORD_SCRYPT_LOG2N=17` |
| Logs | `LOG_LEVEL=info`, one line per `/health` request |
| Environment | Production simulated locally, nothing on AWS |
| Image | Project `Dockerfile`, `node:22-alpine`, Node 22.23.4, `amd64` |
| Container limits | Scenarios A, B and D: 0.25 vCPU, 512 MB. Scenario C: 0.5 vCPU, 1 GB. No swap |
| libuv threads | 4 by default, 2 in scenario B |
| Containers | A single one, without a load balancer |
| Machine | Intel Core i5-1334U, 12 logical cores, 16 GB, Windows 11 |
| Docker | Docker Desktop 29.6.2, virtual machine with 12 CPUs and 7.6 GiB |
| Load generator | `test/stress/run-stress.cjs`, on the same machine as the container |
| Simulated behavior | Each user sends requests back to back with no pause, reusing a connection |
| `/login` steps | 1, 2, 3, 4, 8, 16 and 32 users, 20 s each, 30 s maximum per request |
| `/health` steps | 10, 50, 100, 250, 500, 1000 and 2000 users, 10 s each, 10 s maximum per request |
| Repetitions | A single run |

Scenario A stops when the container dies: the following steps were not tested.

### Test #1: concurrent logins

Measured on October 30, 2026, with `log2N=17`. Values: 95th percentile response time.

| Concurrent logins | A: 0.25 vCPU, 512 MB (current) | B: A with `UV_THREADPOOL_SIZE=2` | C: 0.5 vCPU, 1 GB |
| --- | --- | --- | --- |
| 1 | 1.8 s | 1.8 s | 0.7 s |
| 2 | 4.4 s | 4.3 s | 1.5 s |
| 3 | 9.8 s | 7.0 s | 3.1 s |
| 4 | **Container killed (memory)** | 8.2 s | 6.2 s |
| 8 | Not tested | 16.5 s | 11.5 s |
| 16 | Not tested | 29.9 s, 7 failures | 22.0 s |
| 32 | Not tested | 30.0 s, 25 failures | 27.8 s, 24 failures |
| Observed throughput | 0.5 to 0.7 logins/s | 0.6 to 0.9 logins/s | 0.8 to 1.7 logins/s |

During these loads, as long as the container stays alive, `/health` responds in under 85 ms (95th percentile): slow logins do not block the rest of the API.

### Test #1: simple requests

`/health` only, with the current limits (0.25 vCPU, 512 MB).

| Concurrent users | Throughput | Response time (95th percentile) | Failures |
| --- | --- | --- | --- |
| 10 | 162 req/s | 197 ms | 0 |
| 50 | 227 req/s | 601 ms | 0 |
| 100 | 255 req/s | 804 ms | 14 |
| 250 | 259 req/s | 886 ms | 140 |
| 500 | 304 req/s | 707 ms | 368 |
| 1000 | 285 req/s | 788 ms | 868 |
| 2000 | 265 req/s | 801 ms | 1868 |

### Test #1: estimated real users

**About 1,000 active users at the same time**: this is a calculated estimate, not a measured value.

- **Calculation:** about 250 req/s, divided by 1 request every 5 s per user, gives 1,250 users, rounded to about 1,000.
- **Assumption:** the rate of one request every 5 s is assumed, it was not observed on real users.
- **Scope:** this figure only applies to `/health`, without a database. Real routes will be slower, so it must be recalculated at the next test.
- **Does not cover logins:** with the current configuration, 4 concurrent logins kill the container, regardless of how many users are already active.

### Test #1: limits of these measurements

- Docker limits the CPU in a way comparable to Fargate, without reproducing it exactly.
- A single run was made, without a database: real routes will be slower.
- Above 50 users, failures may come from Docker Desktop or the load generator, not only from the API.
