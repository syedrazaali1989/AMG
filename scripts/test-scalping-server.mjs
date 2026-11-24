/**
 * Mocked end-to-end test for the server-side scalping route + futures-only
 * cleanup (PR: scalping server route, SPOT removal everywhere).
 *
 * Runs the REAL production build (`next start`) against:
 *  - a FAKE Upstash Redis REST endpoint on 127.0.0.1 (in-memory, this file)
 *  - REAL Binance 5m/1H klines from data-api.binance.vision (read-only)
 *  - throwaway VAPID keys (no real push endpoint exists, no subscriber
 *    is ever stored, so no real push notification can be sent)
 *
 * Assertions:
 *  1. /api/scalping/signals returns FUTURE LONG/SHORT signals only
 *     (no SPOT, no BUY), with a 4h expiry stamp, in reasonable time.
 *  2. /api/scalping/signals?market=FOREX is refused (400, never fake data).
 *  3. /api/signals?type=SPOT returns FUTURE signals only (the SPOT path
 *     is gone - the param is ignored).
 *  4. A seeded scalping record resolves in /api/history from real 5m
 *     klines (LOSS via the -0.7% stop, EXPIRED for a past-expiry record,
 *     ACTIVE untouched; WIN asserted when a real window is found).
 *  5. The /scalping and /dashboard pages render with no SPOT control
 *     (no 'Spot Trading' / 'SPOT' in the served HTML).
 *  6. No push was sent and no subscription was ever stored.
 *
 * Seeded scalping outcomes are historical facts, verified from the same
 * 5m klines the server will walk before seeding - never invented.
 *
 * Usage: npm run build && node scripts/test-scalping-server.mjs
 * Exits 0 on pass, 1 on any failed assertion. Kills the server it started.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FAKE_REDIS_PORT = 6391;
const NEXT_PORT = 3101;
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
            const m = hashes.get(String(cmd[1])) ?? new Map();
            let added = 0;
            for (let i = 2; i + 1 < cmd.length; i += 2) {
                if (!m.has(String(cmd[i]))) added++;
                m.set(String(cmd[i]), String(cmd[i + 1]));
            }
            hashes.set(String(cmd[1]), m);
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
async function getKlines(symbol, interval, limit = 1000) {
    // Binance vision answers 418/429 on rate limits; back off and retry.
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(
            `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        );
        if (res.ok) return res.json();
        if (attempt < 4 && [418, 429, 500, 502, 503].includes(res.status)) {
            const wait = 15000 * attempt;
            console.log(`  klines ${symbol} ${interval}: HTTP ${res.status}, retrying in ${wait / 1000}s (attempt ${attempt}/4)`);
            await new Promise(r => setTimeout(r, wait));
            continue;
        }
        throw new Error(`klines ${symbol} ${interval}: HTTP ${res.status}`);
    }
    throw new Error(`klines ${symbol} ${interval}: retries exhausted`);
}

const FIVE_MIN = 5 * 60 * 1000;
const HOUR = 3600 * 1000;

function scalpingSignalBase({ id, pair, direction, entry, sl, tp1, tp2, tp3, issuedAt, expiresAt }) {
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
        timeframe: '5m',
        confidence: 70,
        tp1Hit: false,
        tp2Hit: false,
        tp3Hit: false,
        profitLossPercentage: 0,
        isScalping: true
    };
}

function toRecord(engine, signal, anchorIso) {
    const token = engine === 'scalping' ? 'scalping' : engine === 'onchain' ? 'ONCHAIN' : 'standard';
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

function fiveMinFloor(iso) {
    const ms = new Date(iso).getTime();
    return new Date(Math.floor(ms / FIVE_MIN) * FIVE_MIN).toISOString();
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

// Mirror of the server's 5m walk (resolveOutcome with candleMs=5m):
// skip the issuance bar, walk in order, SL wins a same-candle tie.
function simulate5m(klines, { direction, sl, tp3, issuedMs, expiresMs }) {
    const isLong = direction === 'LONG';
    for (const k of klines) {
        if (k.open <= Math.floor(issuedMs / FIVE_MIN) * FIVE_MIN) continue;
        if (k.open > Date.now()) break;
        if (k.open > expiresMs) break;
        const slT = isLong ? k.low <= sl : k.high >= sl;
        const t3 = isLong ? k.high >= tp3 : k.low <= tp3;
        if (slT) return 'LOSS';
        if (t3) return 'WIN';
    }
    return Date.now() > expiresMs ? 'EXPIRED' : 'ACTIVE';
}

// ---------------------------------------------------------------- main
async function main() {
    await new Promise(r => fakeRedis.listen(FAKE_REDIS_PORT, '127.0.0.1', r));
    console.log(`fake Upstash Redis on 127.0.0.1:${FAKE_REDIS_PORT}`);

    // --- Build seeded scalping scenarios from REAL 5m klines ---
    console.log('Fetching real 5m klines to construct verifiable scalping scenarios...');
    const candle = k => ({ open: Number(k[0]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]) });
    const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    const klinesBySymbol = {};
    for (const s of symbols) {
        klinesBySymbol[s] = (await getKlines(s, '5m', 1000)).map(candle);
    }

    // Realistic scalping levels: TP1 +-1%, TP2 +-2%, TP3 +-3%, SL -+0.7%.
    function levels(direction, entry) {
        if (direction === 'LONG') {
            return { tp1: entry * 1.01, tp2: entry * 1.02, tp3: entry * 1.03, sl: entry * 0.993 };
        }
        return { tp1: entry * 0.99, tp2: entry * 0.98, tp3: entry * 0.97, sl: entry * 1.007 };
    }

    function search(direction, want) {
        for (const s of symbols) {
            const klines = klinesBySymbol[s];
            for (let i = klines.length - 700; i < klines.length - 60; i++) {
                const entry = klines[i].close;
                const issuedMs = klines[i].open;
                const lv = levels(direction, entry);
                const out = simulate5m(klines, {
                    direction, sl: lv.sl, tp3: lv.tp3,
                    issuedMs, expiresMs: issuedMs + 4 * HOUR
                });
                if (out === want) {
                    return { symbol: s, pair: s.replace('USDT', '/USDT'), direction, entry, issuedMs, ...lv };
                }
            }
        }
        return null;
    }

    const loss = search('LONG', 'LOSS') || search('SHORT', 'LOSS');
    if (!loss) throw new Error('no scalping LOSS window found in recent 5m klines');
    console.log(`  scalping ${loss.direction} LOSS scenario: ${loss.pair} entry ${loss.entry} issued ${new Date(loss.issuedMs).toISOString()} sl ${loss.sl.toFixed(4)} tp3 ${loss.tp3.toFixed(4)}`);
    const win = search('LONG', 'WIN') || search('SHORT', 'WIN');
    if (win) {
        console.log(`  scalping ${win.direction} WIN scenario: ${win.pair} entry ${win.entry} issued ${new Date(win.issuedMs).toISOString()} sl ${win.sl.toFixed(4)} tp3 ${win.tp3.toFixed(4)}`);
    } else {
        console.log('  (no scalping WIN window found in the recent 5m range - WIN assertion skipped)');
    }

    const now = Date.now();
    const ago3d = new Date(now - 3 * 24 * 3600 * 1000).toISOString();
    const ago2d = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
    const anchor5mAgo = fiveMinFloor(new Date(now - 5 * 60 * 1000).toISOString());
    const expires4h = new Date(now + 4 * 3600 * 1000).toISOString();

    const seeds = [
        toRecord('scalping', scalpingSignalBase({
            id: 'SCALP-seed-loss', pair: loss.pair, direction: loss.direction,
            entry: loss.entry, sl: loss.sl, tp1: loss.tp1, tp2: loss.tp2, tp3: loss.tp3,
            issuedAt: new Date(loss.issuedMs).toISOString(),
            expiresAt: new Date(loss.issuedMs + 4 * HOUR).toISOString()
        }), fiveMinFloor(new Date(loss.issuedMs).toISOString())),
        // Scalping EXPIRED: absurd levels, expiry 2 days ago.
        toRecord('scalping', scalpingSignalBase({
            id: 'SCALP-seed-expired', pair: 'ETH/USDT', direction: 'LONG',
            entry: 1700, sl: 100, tp1: 1717, tp2: 1734, tp3: 10000,
            issuedAt: ago3d, expiresAt: ago2d
        }), fiveMinFloor(ago3d)),
        // Scalping untouched ACTIVE: absurd levels, live expiry.
        toRecord('scalping', scalpingSignalBase({
            id: 'SCALP-seed-active', pair: 'ETH/USDT', direction: 'LONG',
            entry: 1700, sl: 100, tp1: 1717, tp2: 1734, tp3: 10000,
            issuedAt: anchor5mAgo, expiresAt: expires4h
        }), anchor5mAgo)
    ];
    if (win) {
        seeds.push(toRecord('scalping', scalpingSignalBase({
            id: 'SCALP-seed-win', pair: win.pair, direction: win.direction,
            entry: win.entry, sl: win.sl, tp1: win.tp1, tp2: win.tp2, tp3: win.tp3,
            issuedAt: new Date(win.issuedMs).toISOString(),
            expiresAt: new Date(win.issuedMs + 4 * HOUR).toISOString()
        }), fiveMinFloor(new Date(win.issuedMs).toISOString())));
    }
    for (const rec of seeds) await seedActive(rec);
    console.log(`seeded ${seeds.length} scalping active records`);

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

        // --- 1. Scalping route: live generation, FUTURE only ---
        console.log('GET /api/scalping/signals');
        const t0 = Date.now();
        const scalpRes = await fetch(`${BASE}/api/scalping/signals`);
        const scalpMs = Date.now() - t0;
        console.log(`  scalping route: HTTP ${scalpRes.status} in ${scalpMs}ms`);
        check('scalping route 200 or honest 502', scalpRes.status === 200 || scalpRes.status === 502, `HTTP ${scalpRes.status}`);
        if (scalpRes.status === 200) {
            const scalp = await scalpRes.json();
            const sigs = scalp.signals ?? [];
            console.log(`  scalping signals: ${sigs.length}, pairsScanned=${scalp.pairsScanned}`);
            check('scalping route scanned pairs', (scalp.pairsScanned ?? 0) > 0, JSON.stringify(scalp.pairsScanned));
            check('scalping route fast enough (< 30s)', scalpMs < 30000, `${scalpMs}ms`);
            check('all scalping signals are FUTURE', sigs.every(s => s.signalType === 'FUTURE'), JSON.stringify(sigs.map(s => s.signalType)));
            check('all scalping signals LONG/SHORT (no BUY)', sigs.every(s => s.direction === 'LONG' || s.direction === 'SHORT'), JSON.stringify(sigs.map(s => s.direction)));
            check('all scalping signals carry a 4h expiry', sigs.every(s => {
                const exp = new Date(s.expiresAt).getTime();
                const iss = new Date(s.timestamp).getTime();
                return exp - iss >= 3.5 * 3600 * 1000 && exp - iss <= 4.5 * 3600 * 1000;
            }), JSON.stringify(sigs.map(s => s.expiresAt)));
        }

        // --- 2. FOREX scalping refused, never faked ---
        const fxRes = await fetch(`${BASE}/api/scalping/signals?market=FOREX`);
        console.log(`  scalping FOREX: HTTP ${fxRes.status}`);
        check('FOREX scalping refused with 400', fxRes.status === 400, `HTTP ${fxRes.status}`);

        // --- 3. Standard route: type=SPOT must NOT yield SPOT signals ---
        const spotRes = await fetch(`${BASE}/api/signals?type=SPOT&market=CRYPTO`);
        console.log(`  /api/signals?type=SPOT: HTTP ${spotRes.status}`);
        check('standard route with type=SPOT is 200 or honest 502', spotRes.status === 200 || spotRes.status === 502, `HTTP ${spotRes.status}`);
        if (spotRes.status === 200) {
            const spotData = await spotRes.json();
            const stdSigs = spotData.signals ?? [];
            check('type=SPOT returns FUTURE signals only', stdSigs.every(s => s.signalType === 'FUTURE'), JSON.stringify(stdSigs.map(s => s.signalType)));
            check('type=SPOT returns LONG/SHORT only (no BUY)', stdSigs.every(s => s.direction === 'LONG' || s.direction === 'SHORT'), JSON.stringify(stdSigs.map(s => s.direction)));
        }

        // --- 4. Seeded scalping records resolve (5m walk) ---
        // Resolution is driven by the scalping route itself
        // (syncScalpingHistory, fire-and-forget after generation) and
        // by the watcher as a backstop - so poll /api/history for the
        // outcome rather than assuming which driver got there first.
        // The route call above already triggered it; allow up to 90s
        // for the fire-and-forget sync to finish.
        const wantResolvedIds = ['SCALP-seed-loss', 'SCALP-seed-expired'];
        if (win) wantResolvedIds.push('SCALP-seed-win');
        let hist = null;
        let bySource = new Map();
        for (let attempt = 1; attempt <= 10; attempt++) {
            hist = await (await fetch(`${BASE}/api/history`)).json();
            bySource = new Map((hist.signals ?? []).map(s => [s.sourceId, s]));
            if (wantResolvedIds.every(id => bySource.has(id))) break;
            if (attempt < 10) await new Promise(r => setTimeout(r, 9000));
        }
        console.log(`  history: configured=${hist.configured} signals=${hist.signals?.length} activeCount=${hist.activeCount}`);
        check('history configured', hist.configured === true);
        const scalpLoss = bySource.get('SCALP-seed-loss');
        check('scalping LOSS resolved STOPPED', scalpLoss?.status === 'STOPPED', JSON.stringify(scalpLoss?.status));
        check('scalping LOSS record carries isScalping', scalpLoss?.isScalping === true, JSON.stringify(scalpLoss?.isScalping));
        check('scalping LOSS record engine is scalping', scalpLoss?.engine === 'scalping', JSON.stringify(scalpLoss?.engine));
        const scalpExp = bySource.get('SCALP-seed-expired');
        check('scalping EXPIRED resolved EXPIRED', scalpExp?.status === 'EXPIRED', JSON.stringify(scalpExp?.status));
        if (win) {
            const scalpWin = bySource.get('SCALP-seed-win');
            check('scalping WIN resolved COMPLETED', scalpWin?.status === 'COMPLETED', JSON.stringify(scalpWin?.status));
        }
        check('untouched scalping record NOT in resolved list', !bySource.has('SCALP-seed-active'));
        check('activeCount >= 1 (untouched scalping stays active)', (hist.activeCount ?? 0) >= 1, `activeCount=${hist.activeCount}`);

        // --- 5. Watch tick still works (configured, no push sent) ---
        // The watcher's resolve step is a backstop here: the route may
        // already have resolved the seeds, so no resolved-count is
        // asserted on the watch itself.
        console.log('GET /api/push/watch');
        const watch = await (await fetch(`${BASE}/api/push/watch`, {
            headers: { 'x-watch-secret': WATCH_SECRET }
        })).json();
        console.log('  watch:', JSON.stringify(watch));
        check('watch configured', watch.configured === true);
        check('watch sent zero (no subscribers, no real push)', watch.sent === 0);

        // --- 6. Pages render with no SPOT control ---
        const scalpHtml = await (await fetch(`${BASE}/scalping`)).text();
        check('scalping page has no Spot Trading button', !scalpHtml.includes('Spot Trading'), 'found "Spot Trading"');
        check('scalping page HTML has no SPOT string', !scalpHtml.includes('SPOT'), 'found "SPOT"');
        const dashHtml = await (await fetch(`${BASE}/dashboard`)).text();
        check('dashboard page has no Spot Trading button', !dashHtml.includes('Spot Trading'), 'found "Spot Trading"');
        check('dashboard page HTML has no SPOT string', !dashHtml.includes('SPOT'), 'found "SPOT"');

        // --- 7. No subscription was ever stored (no push could go anywhere) ---
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
