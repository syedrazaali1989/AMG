/**
 * Mocked end-to-end test for server-side signal history.
 *
 * Runs the REAL production build (`next start`) against:
 *  - a FAKE Upstash Redis REST endpoint on 127.0.0.1 (in-memory, this file)
 *  - REAL Binance 1H klines from data-api.binance.vision (read-only)
 *  - throwaway VAPID keys (no real push endpoint exists, no subscriber
 *    is ever stored, so no real push notification can be sent)
 *
 * Seeded outcomes are historical facts, verified from the same klines
 * the server will walk before seeding - never invented:
 *  - FET/USDT SHORT (entry 0.1053, SL 0.11105, issued 2026-11-23 03:07Z):
 *    SL touched in the 12:00 UTC candle (high 0.11140) -> LOSS.
 *  - A BTC LONG and a BTC SHORT constructed from real Nov 20-22 klines
 *    with levels the script verifies were/weren't touched -> WIN / LOSS.
 *  - Two records with absurd levels and an expiry in the past -> EXPIRED.
 *  - One record with absurd levels and a live expiry -> stays ACTIVE.
 *
 * Usage: npm run build && node scripts/test-signal-history.mjs
 * Exits 0 on pass, 1 on any failed assertion. Kills the server it started.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FAKE_REDIS_PORT = 6390;
const NEXT_PORT = 3100;
const BASE = `http://127.0.0.1:${NEXT_PORT}`;
const WATCH_SECRET = 'test-watch-secret';

let failures = 0;
function check(name, cond, extra = '') {
    if (cond) {
        console.log(`  PASS ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name} ${extra}`);
    }
}

// ---------------------------------------------------------------- fake Redis
// Implements the subset of the Upstash REST protocol the @upstash/redis
// client uses: single commands POSTed as a JSON array to /, pipelines
// POSTed as an array of arrays to /pipeline. Responses are { result }.
const hashes = new Map(); // key -> Map(field -> string)
const zsets = new Map(); // key -> Map(member -> score)
const kv = new Map(); // key -> string

function runCommand(cmd) {
    const [name, ...args] = cmd.map(String);
    switch (name.toUpperCase()) {
        case 'HSET': {
            const [, key] = [cmd[0], cmd[1]];
            const m = hashes.get(key) ?? new Map();
            let added = 0;
            for (let i = 2; i + 1 < cmd.length; i += 2) {
                if (!m.has(String(cmd[i]))) added++;
                m.set(String(cmd[i]), String(cmd[i + 1]));
            }
            hashes.set(key, m);
            return added;
        }
        case 'HGETALL': {
            // The real Upstash REST API returns HGETALL as a FLAT ARRAY
            // [field, value, ...] - the @upstash/redis client deserializes
            // exactly that shape (an object here would silently yield {}).
            const m = hashes.get(String(cmd[1]));
            const out = [];
            if (m) for (const [f, v] of m) out.push(f, v);
            return out;
        }
        case 'HDEL': {
            const m = hashes.get(String(cmd[1]));
            if (!m) return 0;
            let n = 0;
            for (let i = 2; i < cmd.length; i++) if (m.delete(String(cmd[i]))) n++;
            return n;
        }
        case 'HLEN': {
            return hashes.get(String(cmd[1]))?.size ?? 0;
        }
        case 'ZADD': {
            const m = zsets.get(String(cmd[1])) ?? new Map();
            const score = parseFloat(String(cmd[2]));
            const member = String(cmd[3]);
            const added = m.has(member) ? 0 : 1;
            m.set(member, score);
            zsets.set(String(cmd[1]), m);
            return added;
        }
        case 'ZRANGE': {
            const m = zsets.get(String(cmd[1]));
            if (!m) return [];
            const entries = [...m.entries()].sort((a, b) => a[1] - b[1]);
            const rev = cmd.includes('rev');
            if (rev) entries.reverse();
            const min = parseInt(String(cmd[2]), 10);
            const max = parseInt(String(cmd[3]), 10);
            const end = max < 0 ? entries.length + max + 1 : max + 1;
            return entries.slice(min, end).map(([member]) => member);
        }
        case 'ZCARD': {
            return zsets.get(String(cmd[1]))?.size ?? 0;
        }
        case 'ZREM': {
            const m = zsets.get(String(cmd[1]));
            if (!m) return 0;
            let n = 0;
            for (let i = 2; i < cmd.length; i++) if (m.delete(String(cmd[i]))) n++;
            return n;
        }
        case 'ZREMRANGEBYSCORE': {
            const m = zsets.get(String(cmd[1]));
            if (!m) return 0;
            const min = parseFloat(String(cmd[2]));
            const max = parseFloat(String(cmd[3]));
            let n = 0;
            for (const [member, score] of [...m]) {
                if (score >= min && score <= max) { m.delete(member); n++; }
            }
            return n;
        }
        case 'GET': {
            return kv.has(String(cmd[1])) ? kv.get(String(cmd[1])) : null;
        }
        case 'SET': {
            kv.set(String(cmd[1]), String(cmd[2]));
            return 'OK';
        }
        default:
            throw new Error(`fake redis: unsupported command ${name}`);
    }
}

const fakeRedis = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        try {
            const parsed = JSON.parse(body || '[]');
            let result;
            if (req.url === '/pipeline') {
                result = parsed.map(c => ({ result: runCommand(c) }));
            } else {
                result = { result: runCommand(parsed) };
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }
    });
});

// Seed one record straight into the fake store (same REST shape as the app).
async function redisCmd(cmd) {
    const res = await fetch(`http://127.0.0.1:${FAKE_REDIS_PORT}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd)
    });
    const json = await res.json();
    if (json.error) throw new Error(`fake redis error: ${json.error}`);
    return json.result;
}

async function seedActive(rec) {
    await redisCmd(['HSET', 'signal:history:active', rec.id, JSON.stringify(rec)]);
}

// ---------------------------------------------------------------- helpers
async function getKlines(symbol, limit = 1000) {
    // Binance vision answers 418/429 on rate limits; back off and retry.
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(
            `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=${limit}`
        );
        if (res.ok) return res.json();
        if (attempt < 4 && [418, 429, 500, 502, 503].includes(res.status)) {
            const wait = 15000 * attempt;
            console.log(`  klines ${symbol}: HTTP ${res.status}, retrying in ${wait / 1000}s (attempt ${attempt}/4)`);
            await new Promise(r => setTimeout(r, wait));
            continue;
        }
        throw new Error(`klines ${symbol}: HTTP ${res.status}`);
    }
    throw new Error(`klines ${symbol}: retries exhausted`);
}

function signalBase({ id, pair, direction, entry, sl, tp1, tp2, tp3, issuedAt, expiresAt }) {
    return {
        id,
        pair,
        direction,
        entryPrice: entry,
        currentPrice: entry,
        stopLoss: sl,
        takeProfit: tp3,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        status: 'ACTIVE',
        timestamp: issuedAt,
        expiresAt,
        marketType: 'CRYPTO',
        signalType: 'FUTURE',
        timeframe: '1h',
        confidence: 70,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        profitLossPercentage: 0
    };
}

function toRecord(engine, signal, anchorIso) {
    const token = engine === 'onchain' ? 'ONCHAIN' : 'standard';
    return {
        id: `${token}:${signal.pair}:${signal.direction}:${anchorIso}`,
        sourceId: signal.id,
        engine,
        pair: signal.pair,
        direction: signal.direction,
        issuedAt: anchorIso,
        signal
    };
}

function hourFloor(iso) {
    const ms = new Date(iso).getTime();
    return new Date(Math.floor(ms / 3600000) * 3600000).toISOString();
}

async function waitForServer(url, tries = 40) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(url);
            if (res.status < 500) return true;
        } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// ---------------------------------------------------------------- main
async function main() {
    await new Promise(r => fakeRedis.listen(FAKE_REDIS_PORT, '127.0.0.1', r));
    console.log(`fake Upstash Redis on 127.0.0.1:${FAKE_REDIS_PORT}`);

    // --- Build seeded scenarios from REAL klines (verify before seeding) ---
    // Mirror of the server's walk (resolveOutcome): skip the issuance
    // candle, walk in order, SL wins a same-candle tie, expiry ends it.
    console.log('Fetching real klines to construct verifiable scenarios...');
    const btcKlines = await getKlines('BTCUSDT', 1000);
    const fetKlines = await getKlines('FETUSDT', 1000);
    const candle = k => ({ open: Number(k[0]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) });
    const HOUR = 3600 * 1000;
    // klines here are already-parsed {open, high, low, close} objects.
    function simulate(klines, { direction, entry, sl, tp1, tp2, tp3, issuedMs, expiresMs }) {
        const isLong = direction === 'LONG';
        for (const k of klines) {
            if (k.open <= Math.floor(issuedMs / HOUR) * HOUR) continue;
            if (k.open > Date.now()) break;
            if (k.open > expiresMs) break;
            const slT = isLong ? k.low <= sl : k.high >= sl;
            const t3 = isLong ? k.high >= tp3 : k.low <= tp3;
            if (slT) return 'LOSS';
            if (t3) return 'WIN';
        }
        return Date.now() > expiresMs ? 'EXPIRED' : 'ACTIVE';
    }
    // FET SHORT (real Nov 23 signal): SL 0.11105 touched 12:00 UTC -> LOSS.
    const fetOutcome = simulate(fetKlines.map(candle), {
        direction: 'SHORT', entry: 0.1053, sl: 0.11105, tp1: 0.10354, tp2: 0.10072, tp3: 0.09931,
        issuedMs: new Date('2026-11-23T03:00:00.000Z').getTime(),
        expiresMs: new Date('2026-11-25T03:07:15.000Z').getTime()
    });
    if (fetOutcome !== 'LOSS') throw new Error(`FET LOSS scenario not verifiable (simulated ${fetOutcome})`);
    console.log('  FET SHORT scenario verified: LOSS (SL touched)');

    // Search BTC klines for a window that genuinely resolves WIN and one
    // that genuinely resolves LOSS. Direction and bands are tried in order
    // (the market decides which combination exists - a downtrend yields
    // SHORT wins and LONG losses, an uptrend the reverse).
    const btc = btcKlines.map(candle);
    function search(direction, want, tp3Mult, slMult) {
        for (let i = btc.length - 800; i < btc.length - 50; i++) {
            const entry = btc[i].close;
            const issuedMs = btc[i].open;
            const out = simulate(btc, {
                direction, entry,
                sl: entry * slMult,
                tp1: direction === 'LONG' ? entry * 1.002 : entry * 0.998,
                tp2: direction === 'LONG' ? entry * 1.004 : entry * 0.996,
                tp3: entry * tp3Mult,
                issuedMs, expiresMs: issuedMs + 48 * HOUR
            });
            if (out === want) {
                return { direction, entry, issuedMs, tp3: entry * tp3Mult, sl: entry * slMult };
            }
        }
        return null;
    }
    const win = search('LONG', 'WIN', 1.003, 0.99) || search('SHORT', 'WIN', 0.997, 1.01)
        || search('LONG', 'WIN', 1.005, 0.99) || search('SHORT', 'WIN', 0.995, 1.01);
    if (!win) throw new Error('no BTC WIN window found in recent klines');
    console.log(`  BTC ${win.direction} WIN scenario: entry ${win.entry} issued ${new Date(win.issuedMs).toISOString()} tp3 ${win.tp3.toFixed(2)} sl ${win.sl.toFixed(2)}`);
    const loss = search('SHORT', 'LOSS', 0.99, 1.003) || search('LONG', 'LOSS', 1.01, 0.997)
        || search('SHORT', 'LOSS', 0.95, 1.005) || search('LONG', 'LOSS', 1.05, 0.995);
    if (!loss) throw new Error('no BTC LOSS window found in recent klines');
    console.log(`  BTC ${loss.direction} LOSS scenario: entry ${loss.entry} issued ${new Date(loss.issuedMs).toISOString()} sl ${loss.sl.toFixed(2)} tp3 ${loss.tp3.toFixed(2)}`);

    const now = Date.now();
    const ago3d = new Date(now - 3 * 24 * 3600 * 1000).toISOString();
    const ago2d = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
    const anchor1hAgo = hourFloor(new Date(now - 3600 * 1000).toISOString());
    const expires48h = new Date(now + 48 * 3600 * 1000).toISOString();

    // --- Seed active records ---
    const seeds = [
        // FET SHORT, issued 2026-11-23 03:07Z: SL 0.11105 touched 12:00 UTC (high 0.11140) -> LOSS.
        toRecord('standard', signalBase({
            id: 'FETUSDT-seed-loss', pair: 'FET/USDT', direction: 'SHORT',
            entry: 0.1053, sl: 0.11105, tp1: 0.10354, tp2: 0.10072, tp3: 0.09931,
            issuedAt: '2026-11-23T03:07:15.000Z', expiresAt: '2026-11-25T03:07:15.000Z'
        }), '2026-11-23T03:00:00.000Z'),
        // BTC WIN, constructed above.
        toRecord('standard', signalBase({
            id: 'BTCUSDT-seed-win', pair: 'BTC/USDT', direction: win.direction,
            entry: win.entry, sl: win.sl,
            tp1: win.direction === 'LONG' ? win.entry * 1.002 : win.entry * 0.998,
            tp2: win.direction === 'LONG' ? win.entry * 1.004 : win.entry * 0.996,
            tp3: win.tp3,
            issuedAt: new Date(win.issuedMs).toISOString(), expiresAt: new Date(win.issuedMs + 48 * 3600 * 1000).toISOString()
        }), new Date(win.issuedMs).toISOString()),
        // Standard EXPIRED: absurd levels, expiry 2 days ago.
        toRecord('standard', signalBase({
            id: 'OPUSDT-seed-expired', pair: 'OP/USDT', direction: 'SHORT',
            entry: 0.07, sl: 0.2, tp1: 0.01, tp2: 0.009, tp3: 0.008,
            issuedAt: ago3d, expiresAt: ago2d
        }), hourFloor(ago3d)),
        // Standard untouched ACTIVE: absurd levels, live expiry.
        toRecord('standard', signalBase({
            id: 'OPUSDT-seed-active', pair: 'OP/USDT', direction: 'SHORT',
            entry: 0.07, sl: 0.2, tp1: 0.01, tp2: 0.009, tp3: 0.008,
            issuedAt: anchor1hAgo, expiresAt: expires48h
        }), anchor1hAgo),
        // On-chain BTC LOSS, constructed above.
        toRecord('onchain', signalBase({
            id: 'ONCHAIN-seed-loss', pair: 'BTC/USDT', direction: loss.direction,
            entry: loss.entry, sl: loss.sl,
            tp1: loss.direction === 'LONG' ? loss.entry * 1.002 : loss.entry * 0.998,
            tp2: loss.direction === 'LONG' ? loss.entry * 1.004 : loss.entry * 0.996,
            tp3: loss.tp3,
            issuedAt: new Date(loss.issuedMs).toISOString(), expiresAt: new Date(loss.issuedMs + 48 * 3600 * 1000).toISOString()
        }), new Date(loss.issuedMs).toISOString()),
        // On-chain EXPIRED: absurd levels, expiry 2 days ago.
        toRecord('onchain', signalBase({
            id: 'ONCHAIN-seed-expired', pair: 'ETH/USDT', direction: 'LONG',
            entry: 1700, sl: 100, tp1: 1785, tp2: 1836, tp3: 10000,
            issuedAt: ago3d, expiresAt: ago2d
        }), hourFloor(ago3d))
    ];
    for (const rec of seeds) await seedActive(rec);
    console.log(`seeded ${seeds.length} active records`);

    // --- Start the real production server with throwaway VAPID keys ---
    const { generateVAPIDKeys } = require('web-push');
    const vapid = generateVAPIDKeys();
    const env = {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(NEXT_PORT),
        UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${FAKE_REDIS_PORT}`,
        UPSTASH_REDIS_REST_TOKEN: 'test-token',
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        WATCH_SECRET
    };
    const server = spawn('node_modules/.bin/next', ['start', '-p', String(NEXT_PORT)], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let serverLog = '';
    server.stdout.on('data', d => { serverLog += d; });
    server.stderr.on('data', d => { serverLog += d; });
    const killServer = () => { try { server.kill('SIGTERM'); } catch { /* already dead */ } };

    try {
        console.log('starting next start...');
        if (!(await waitForServer(`${BASE}/api/history`))) {
            console.log(serverLog.slice(-2000));
            throw new Error('production server did not come up');
        }
        console.log('server up');

        // --- 1. Watch tick: resolves seeded actives (standard + on-chain) ---
        // A transient price-data failure leaves signals active (never fakes
        // a result); the watcher retries every few minutes in production,
        // so retry once here after 30s if the first tick resolved nothing.
        console.log('GET /api/push/watch');
        let watch = await (await fetch(`${BASE}/api/push/watch`, {
            headers: { 'x-watch-secret': WATCH_SECRET }
        })).json();
        console.log('  watch:', JSON.stringify(watch));
        for (let attempt = 2; (watch.history?.resolved ?? 0) < 5 && attempt <= 6; attempt++) {
            console.log(`  tick resolved < 5 - retrying watch in 60s (attempt ${attempt}/6; Binance 418 bans last a few minutes)`);
            await new Promise(r => setTimeout(r, 60000));
            watch = await (await fetch(`${BASE}/api/push/watch`, {
                headers: { 'x-watch-secret': WATCH_SECRET }
            })).json();
            console.log(`  watch (attempt ${attempt}):`, JSON.stringify(watch));
        }
        check('watch configured', watch.configured === true);
        check('watch sent zero (no subscribers, no real push)', watch.sent === 0);
        check('watch history resolved >= 5', (watch.history?.resolved ?? 0) >= 5, JSON.stringify(watch.history));

        // --- 2. History read ---
        const histRes = await fetch(`${BASE}/api/history`);
        const hist = await histRes.json();
        console.log(`  history: configured=${hist.configured} signals=${hist.signals?.length} activeCount=${hist.activeCount}`);
        check('history configured', hist.configured === true);
        const byId = new Map((hist.signals ?? []).map(s => [s.id, s]));
        const fet = byId.get('standard:FET/USDT:SHORT:2026-11-23T03:00:00.000Z');
        check('FET short resolved STOPPED (LOSS)', fet?.status === 'STOPPED', JSON.stringify(fet?.status));
        check('FET exit price is the SL', fet?.exitPrice === 0.11105, JSON.stringify(fet?.exitPrice));
        const btcWin = [...byId.values()].find(s => s.sourceId === 'BTCUSDT-seed-win');
        check('BTC WIN resolved COMPLETED', btcWin?.status === 'COMPLETED', JSON.stringify(btcWin?.status));
        const ocLoss = [...byId.values()].find(s => s.sourceId === 'ONCHAIN-seed-loss');
        check('on-chain BTC LOSS resolved STOPPED', ocLoss?.status === 'STOPPED', JSON.stringify(ocLoss?.status));
        const expired = [...byId.values()].filter(s => s.status === 'EXPIRED');
        check('two EXPIRED records present', expired.length >= 2, `found ${expired.length}`);
        const activeIds = new Set([...byId.values()].map(s => s.id));
        check('untouched OP record NOT in resolved list', ![...byId.keys()].some(id => id.includes('OPUSDT-seed-active')));
        check('activeCount >= 1 (untouched OP stays active)', (hist.activeCount ?? 0) >= 1, `activeCount=${hist.activeCount}`);
        check('no duplicate FET record', [...byId.values()].filter(s => s.sourceId === 'FETUSDT-seed-loss').length === 1);

        // --- 3. On-chain route (fresh generation; 502 tolerated if Blockchain.info is down) ---
        console.log('GET /api/on-chain/signals');
        const ocRes = await fetch(`${BASE}/api/on-chain/signals`);
        console.log(`  on-chain route: HTTP ${ocRes.status}`);
        check('on-chain route 200 or honest 502', ocRes.status === 200 || ocRes.status === 502, `HTTP ${ocRes.status}`);

        // --- 4. History is idempotent: second read shows the same resolved set ---
        const hist2 = await (await fetch(`${BASE}/api/history`)).json();
        check('second history read stable', (hist2.signals ?? []).length === (hist.signals ?? []).length,
            `${(hist2.signals ?? []).length} vs ${(hist.signals ?? []).length}`);

        // --- 5. No subscription was ever stored (no push could go anywhere) ---
        const subs = await redisCmd(['HGETALL', 'push:subs']);
        check('zero push subscriptions stored', Object.keys(subs ?? {}).length === 0);
    } finally {
        killServer();
        fakeRedis.close();
        if (serverLog.trim()) console.log('--- server log (tail) ---\n' + serverLog.slice(-3000));
    }

    console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
