// Test de charge local : `pnpm run test:stress` (Docker doit tourner, compter environ 12 minutes).
// Docker reproduit les limites de la tâche Fargate (voir infra/lib/api-service-stack.ts).
// Chaque utilisateur enchaîne les requêtes sans pause : c'est le pire cas.
const {execFileSync} = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const IMAGE = 'claimflow-stress';
const NAME = 'claimflow-stress-run';
const PORT = 13100;
const ROOT = path.resolve(__dirname, '../..');
const LOG_FILE = path.join(__dirname, 'results.log'); // ignoré par git (*.log)

const agent = new http.Agent({keepAlive: true, maxSockets: Infinity});
const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pad = (value, width) => String(value).padStart(width);

function log(line) {
    console.log(line);
    fs.appendFileSync(LOG_FILE, `${line}\n`);
}

function request(method, url, timeoutMs) {
    return new Promise((resolve) => {
        const start = performance.now();
        const req = http.request({host: '127.0.0.1', port: PORT, path: url, method, agent, timeout: timeoutMs}, (res) => {
            res.resume();
            res.on('end', () => resolve({ok: res.statusCode === 200, ms: performance.now() - start}));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => resolve({ok: false, ms: performance.now() - start}));
        req.end();
    });
}

function containerState() {
    try {
        const [status, oom, code] = docker('inspect', '-f', '{{.State.Status}} {{.State.OOMKilled}} {{.State.ExitCode}}', NAME).split(' ');
        return {status, oom: oom === 'true', code};
    } catch {
        return {status: 'absent', oom: false, code: '?'};
    }
}

function removeContainer() {
    try {
        docker('rm', '-f', NAME);
    } catch {
        // Le conteneur n'existe pas.
    }
}

async function startContainer(scenario) {
    removeContainer();
    agent.destroy();
    const env = [
        'NODE_ENV=production',
        'PORT=3000',
        'LOG_LEVEL=info',
        'PASSWORD_SCRYPT_LOG2N=17',
        'JWT_SECRET=0123456789abcdef0123456789abcdef',
        'DATABASE_URL=postgresql://u:p@localhost:5432/db',
        ...(scenario.env ?? []),
    ];
    docker(
        'create', '--name', NAME, '-p', `${PORT}:3000`,
        `--cpus=${scenario.cpus}`, `--memory=${scenario.memory}`, `--memory-swap=${scenario.memory}`,
        ...env.flatMap((entry) => ['-e', entry]),
        IMAGE, 'node', '/tmp/stress-server.mjs',
    );
    docker('cp', path.join(__dirname, 'stress-server.mjs'), `${NAME}:/tmp/stress-server.mjs`);
    docker('start', NAME);

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if ((await request('GET', '/health', 2000)).ok) return true;
        await sleep(300);
    }
    return false;
}

function percentile(sorted, ratio) {
    if (sorted.length === 0) return 0;
    return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))]);
}

async function runLevel(scenario, users) {
    const end = Date.now() + scenario.seconds * 1000;
    const durations = [];
    const health = [];
    let errors = 0;
    let probing = scenario.probe;

    // Mesure le temps de réponse de /health pendant la charge.
    const prober = (async () => {
        while (probing) {
            const result = await request('GET', '/health', 10_000);
            health.push(result.ok ? result.ms : 10_000);
            await sleep(250);
        }
    })();

    await Promise.all(Array.from({length: users}, async () => {
        while (Date.now() < end) {
            const result = await request(scenario.method, scenario.url, scenario.timeoutMs);
            if (result.ok) durations.push(result.ms);
            else errors += 1;
        }
    }));
    probing = false;
    await prober;

    durations.sort((a, b) => a - b);
    health.sort((a, b) => a - b);
    const state = containerState();
    return {
        users,
        done: durations.length,
        errors,
        rps: (durations.length / scenario.seconds).toFixed(1),
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: percentile(durations, 1),
        healthP95: percentile(health, 0.95),
        alive: state.status === 'running',
        oom: state.oom,
        code: state.code,
    };
}

async function runScenario(scenario) {
    log(`\n=== ${scenario.name} : ${scenario.url} (cpus=${scenario.cpus}, memory=${scenario.memory}${scenario.env ? `, ${scenario.env.join(' ')}` : ''})`);
    if (!(await startContainer(scenario))) {
        log(`Démarrage impossible : ${JSON.stringify(containerState())}`);
        return;
    }
    for (const users of scenario.levels) {
        const r = await runLevel(scenario, users);
        log(`${pad(users, 5)} users | ok ${pad(r.done, 6)} err ${pad(r.errors, 5)} | ${pad(r.rps, 7)} req/s | p50 ${pad(r.p50, 6)} p95 ${pad(r.p95, 6)} max ${pad(r.max, 6)} ms | health p95 ${pad(r.healthP95, 6)} ms | ${r.alive ? 'en vie' : `MORT oom=${r.oom} code=${r.code}`}`);
        if (!r.alive) break;
        await sleep(1500);
    }
    removeContainer();
}

async function main() {
    fs.writeFileSync(LOG_FILE, '');
    log('Construction de l\'image...');
    execFileSync('docker', ['build', '-q', '-t', IMAGE, ROOT], {stdio: ['ignore', 'ignore', 'inherit']});

    const login = {url: '/login', method: 'POST', seconds: 20, timeoutMs: 30_000, probe: true, levels: [1, 2, 3, 4, 8, 16, 32]};
    await runScenario({name: 'A : Fargate actuel', cpus: '0.25', memory: '512m', ...login});
    await runScenario({name: 'B : actuel avec 2 threads', cpus: '0.25', memory: '512m', env: ['UV_THREADPOOL_SIZE=2'], ...login});
    await runScenario({name: 'C : 0,5 vCPU et 1 Go', cpus: '0.5', memory: '1024m', ...login});
    await runScenario({
        name: 'D : /health seul',
        cpus: '0.25',
        memory: '512m',
        url: '/health',
        method: 'GET',
        seconds: 10,
        timeoutMs: 10_000,
        probe: false,
        levels: [10, 50, 100, 250, 500, 1000, 2000],
    });
    log('\nFIN');
}

main()
    .catch((error) => {
        log(`Échec : ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => {
        removeContainer();
        agent.destroy();
    });
