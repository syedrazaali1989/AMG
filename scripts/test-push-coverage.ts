// Deterministic end-to-end test for push coverage: old scalping + on-chain
// engines in the watcher (scripts/test-push-coverage).
//
// Runs the REAL checkAndNotify() from src/lib/push/notify.ts (compiled
// with tsc, no Next server) against:
//   - a FAKE Upstash Redis REST endpoint on 127.0.0.1 (in-memory; extends
//     the scripts/test-push-label-icon.mjs fake with SET ... EX, TTL, DEL,
//     FLUSHALL so first-seen TTLs can be asserted exactly)
//   - a FAKE HTTPS push endpoint on 127.0.0.1 (throwaway self-signed cert;
//     web-push only speaks HTTPS) with a real ECDH P-256 subscription, so
//     captured payloads are DECRYPTED (RFC 8291 aes128gcm) and asserted
//     field by field
//   - a fetch stub serving RECORDED live data
//     (scripts/fixtures/push-coverage-fixtures.json — captured by
//     scripts/capture-push-coverage-fixtures.ts):
//       * 5m klines (48) for the top-30 scalping pairs, captured live;
//         re-timestamped to "now" at test time (prices are the recorded
//         live data, only candle open times shift) so the 30-min strict
//         freshness gate passes on reruns
//       * 1H klines (100) per pair ending at a REAL core-firing bar
//         (2026-11-21T05:00Z, SHORT) from the canonical backtest dataset,
//         plus each pair's 4H closes (250) derived from the same series
//       * a live-captured Blockchain.info block (>= $500K txs only), net
//         flow NEUTRAL so the whale veto never blocks the SHORT event
//     Unmatched URLs pass through to the REAL network (scalping-v2 and
//     gold run live; their signals are tolerated, never asserted on).
//   - Math.random pinned to 0.5 (same as the backtest harnesses: the
//     core's AdvancedMarketAnalyzer derives 30% of its composite trend
//     score from Math.random components).
//   - Date.now is wrapped with a mutable offset (installed in main()
//     before the first tick, offset 0): the scalping anchor is the last
//     CLOSED 5m bar as of wall-clock "now", so a bar advance is simulated
//     by advancing the clock, which also re-timestamps the 5m fixture
//     (the same Date.now) so the freshness gate still passes. The 1H
//     fixture is historical, so the standard/on-chain anchors never move
//     with the offset.
//
// What it proves:
//   (a) Scalping + On-Chain payload titles carry their labels and the
//       logo icon/badge, with the right URL per engine.
//   (b) NO spam — the same persistent setup evaluated across repeated
//       watch ticks (including across a 5m bar advance) notifies exactly
//       once (first-seen anchor holds).
//   (c) A genuinely new setup IS notified — after the first-seen key
//       expires (simulated by deleting it) with the bar advanced, the
//       setup notifies again under a NEW id.
//   (d) On-chain BTC does not double-notify when Standard has the same
//       pair + side + bar (funding neutral); the on-chain alt legs still
//       notify.
//   (e) A failing engine (scalping 5m fetches 500) does not block the
//       other engines.
//   (f) A second tick sends nothing new.
//   (g) First-seen TTLs are the signal expiries (scalping 4h, on-chain
//       48h), asserted via the TTL command.
//
// The test FAILS clearly (exit 1 with the reason) when the fixture has
// no firing scalping pair or the on-chain core does not fire — it never
// passes vacuously.
//
// Compile + run:
//   npx tsc -p scripts/tsconfig.test-push-coverage.json
//   node /tmp/amg-bt-build/scripts/test-push-coverage.js
// Exits 0 on pass, 1 on any failed assertion.
import * as fs from 'fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkAndNotify } from '../src/lib/push/notify';

Math.random = () => 0.5;

const cjsRequire = createRequire(__filename);
const { generateVAPIDKeys } = cjsRequire('web-push');

const LOGO_URL = 'https://amgtrading.vercel.app/logo.png';
const TITLE_RE = /^(Standard|Scalping V2|Gold|Scalping|On-Chain) Signal: \S+ (LONG|SHORT)$/;
const BODY_RE = /^Entry \S+ · SL \S+ · TP1 \S+$/;
const ENGINE_URL: Record<string, string> = {
    Standard: '/dashboard',
    'Scalping V2': '/scalping-v2',
    Gold: '/gold',
    Scalping: '/scalping',
    'On-Chain': '/on-chain'
};

let failures = 0;
function check(name: string, cond: boolean, extra = ''): void {
    if (cond) {
        console.log(`  PASS ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name} ${extra}`);
    }
}

// ---------------------------------------------------------------- fixture
// The test is run from the repo root; the fixture lives in scripts/fixtures.
const FIXTURE_PATH = path.join(process.cwd(), 'scripts', 'fixtures', 'push-coverage-fixtures.json');
const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as {
    capturedAt: string;
    scalping5m: Record<string, number[][]>;
    scalpingFiringLive: string[];
    blockchain: { btcPrice: number; latestHash: string; blockHeight: number; prevBlock: string; txs: any[] };
    blockchainLive: { parsedCount: number; netFlowUSD: number; sentiment: string; crossCheckMissing: number };
    event: { index: number; iso: string; direction: string };
    klines1h: Record<string, number[][]>;
    closes4h: Record<string, number[]>;
};
const EVENT_BAR_MS = Date.parse(fixture.event.iso);
const FIVE_MIN_MS = 5 * 60 * 1000;

function lastClosed5mOpen(nowMs: number): number {
    return Math.floor((nowMs - FIVE_MIN_MS) / FIVE_MIN_MS) * FIVE_MIN_MS;
}

// Re-timestamp the recorded 5m klines so the last candle opens at the
// last closed 5m bar as of "now" (+ an optional whole-bar shift, for
// the bar-advance scenarios). Prices are untouched.
function scalpingKlines(symbol: string, barShift: number): number[][] {
    const src = fixture.scalping5m[symbol];
    if (!src) return [];
    const lastOpen = src[src.length - 1][0] as number;
    const shift = lastClosed5mOpen(Date.now()) + barShift * FIVE_MIN_MS - lastOpen;
    return src.map(k => {
        const c = [...k];
        c[0] = (k[0] as number) + shift;
        c[6] = (k[6] as number) + shift;
        return c;
    });
}

// 4h klines derived from the recorded 4H closes (only the close is ever
// read by get4hCloses/getBtcRegime). Open times step back 4h from the
// partial block holding the event bar.
function fourHourKlines(symbol: string): number[][] {
    const closes = fixture.closes4h[symbol];
    if (!closes) return [];
    const partialOpen = Math.floor(EVENT_BAR_MS / (4 * 60 * 60 * 1000)) * (4 * 60 * 60 * 1000);
    return closes.map((close, idx) => {
        const openTime = partialOpen - (closes.length - 1 - idx) * 4 * 60 * 60 * 1000;
        return [openTime, close, close, close, close, 0, openTime + 4 * 60 * 60 * 1000 - 1, 0, 0, 0, 0, 0];
    });
}

// ---------------------------------------------------------------- fake Redis
// Same subset of the Upstash REST protocol as
// scripts/test-signal-history.mjs, plus SET ... EX/PX, TTL, DEL,
// FLUSHALL (needed to assert first-seen TTLs and reset between phases).
const hashes = new Map<string, Map<string, string>>();
const zsets = new Map<string, Map<string, number>>();
const kv = new Map<string, { value: string; expiresAt: number | null }>();

function kvGet(key: string): string | null {
    const entry = kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
        kv.delete(key);
        return null;
    }
    return entry.value;
}

function runCommand(cmd: unknown[]): unknown {
    const [name, ...args] = cmd.map(String);
    switch (name.toUpperCase()) {
        case 'HSET': {
            const m = hashes.get(String(cmd[1])) ?? new Map<string, string>();
            let added = 0;
            for (let i = 2; i + 1 < cmd.length; i += 2) {
                if (!m.has(String(cmd[i]))) added++;
                m.set(String(cmd[i]), String(cmd[i + 1]));
            }
            hashes.set(String(cmd[1]), m);
            return added;
        }
        case 'HGETALL': {
            const m = hashes.get(String(cmd[1]));
            const out: string[] = [];
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
            const m = zsets.get(String(cmd[1])) ?? new Map<string, number>();
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
            return kvGet(String(cmd[1]));
        }
        case 'SET': {
            // SET key value [EX seconds | PX ms] [NX|XX]
            let expiresAt: number | null = null;
            for (let i = 3; i < cmd.length; i++) {
                const opt = String(cmd[i]).toUpperCase();
                if (opt === 'EX') expiresAt = Date.now() + parseFloat(String(cmd[i + 1])) * 1000;
                if (opt === 'PX') expiresAt = Date.now() + parseFloat(String(cmd[i + 1]));
            }
            kv.set(String(cmd[1]), { value: String(cmd[2]), expiresAt });
            return 'OK';
        }
        case 'TTL': {
            const entry = kv.get(String(cmd[1]));
            if (!entry) return -2;
            if (entry.expiresAt === null) return -1;
            const left = Math.ceil((entry.expiresAt - Date.now()) / 1000);
            if (left <= 0) { kv.delete(String(cmd[1])); return -2; }
            return left;
        }
        case 'DEL': {
            let n = 0;
            for (let i = 1; i < cmd.length; i++) {
                if (kv.delete(String(cmd[i]))) n++;
                if (hashes.delete(String(cmd[i]))) n++;
                if (zsets.delete(String(cmd[i]))) n++;
            }
            return n;
        }
        case 'FLUSHALL': {
            hashes.clear(); zsets.clear(); kv.clear();
            return 'OK';
        }
        default:
            throw new Error(`fake redis: unsupported command ${name}`);
    }
}

const FAKE_REDIS_PORT = 6393;
const fakeRedis = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        try {
            const parsed = JSON.parse(body || '[]');
            let result: unknown;
            if (req.url === '/pipeline') {
                result = (parsed as unknown[][]).map(c => ({ result: runCommand(c) }));
            } else {
                result = { result: runCommand(parsed as unknown[]) };
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: String(err) }));
        }
    });
});

async function redisCmd(cmd: unknown[]): Promise<any> {
    const res = await realFetch(`http://127.0.0.1:${FAKE_REDIS_PORT}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cmd)
    });
    const json: any = await res.json();
    if (json.error) throw new Error(`fake redis error: ${json.error}`);
    return json.result;
}

// ---------------------------------------------------------------- fake push
const captured: { headers: Record<string, string>; body: Buffer; at: number }[] = [];
let fakePush: https.Server;
const FAKE_PUSH_PORT = 6394;

function startFakePush(): Promise<void> {
    const keyPath = '/tmp/push-coverage-test-key.pem';
    const certPath = '/tmp/push-coverage-test-cert.pem';
    execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes ` +
        `-subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" 2>/dev/null`,
        { stdio: 'ignore' }
    );
    fakePush = https.createServer(
        { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
        (req, res) => {
            const chunks: Buffer[] = [];
            req.on('data', c => chunks.push(c as Buffer));
            req.on('end', () => {
                captured.push({ headers: req.headers as Record<string, string>, body: Buffer.concat(chunks), at: Date.now() });
                res.writeHead(201);
                res.end();
            });
        }
    );
    return new Promise(r => fakePush.listen(FAKE_PUSH_PORT, '127.0.0.1', () => r()));
}

// ---------------------------------------------------------------- RFC 8291 decrypt
function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
    return crypto.createHmac('sha256', salt).update(ikm).digest();
}
function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
    const t1 = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
    return t1.subarray(0, length);
}
function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
    return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}
function decryptPush(body: Buffer, ecdh: crypto.ECDH, authB64: string): string {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const keyid = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const shared = ecdh.computeSecret(keyid);
    const auth = Buffer.from(authB64, 'base64url');
    const receiverPub = ecdh.getPublicKey();
    const secret = hkdf(auth, shared, Buffer.concat([Buffer.from('WebPush: info\0'), receiverPub, keyid]), 32);
    const prk = hkdfExtract(salt, secret);
    const cek = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0])]), 16);
    const nonce = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce'), Buffer.from([0])]), 12);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const data = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    let i = plain.length - 1;
    while (i >= 0 && plain[i] === 0) i--;
    if (i < 0 || plain[i] !== 2) throw new Error('invalid aes128gcm padding');
    return plain.subarray(0, i).toString('utf8');
}

// ---------------------------------------------------------------- fetch stub
const realFetch = globalThis.fetch.bind(globalThis);
// Mutable stub controls (one per scenario).
const stubState = {
    fundingRate: 0.0001,
    fiveMinShiftBars: 0,
    scalpingFail: false
};

function stubFetch(input: any, init?: any): Promise<Response> {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith('http://127.0.0.1') || url.startsWith('https://127.0.0.1')) {
        return realFetch(input, init);
    }
    const u = new URL(url);
    // Binance klines.
    if (u.hostname === 'data-api.binance.vision' && u.pathname === '/api/v3/klines') {
        const symbol = u.searchParams.get('symbol') || '';
        const interval = u.searchParams.get('interval') || '';
        const limit = parseInt(u.searchParams.get('limit') || '0', 10);
        if (interval === '1h' && limit === 100) {
            const klines = fixture.klines1h[symbol];
            if (!klines) return Promise.resolve(new Response('unknown symbol', { status: 404 }));
            return Promise.resolve(new Response(JSON.stringify(klines), { status: 200 }));
        }
        if (interval === '4h') {
            const klines = fourHourKlines(symbol);
            if (klines.length === 0) return Promise.resolve(new Response('unknown symbol', { status: 404 }));
            return Promise.resolve(new Response(JSON.stringify(klines), { status: 200 }));
        }
        // 5m klines: served from the recorded fixture series for BOTH
        // limits the engines ask for (48 for old Scalping, 100 for
        // Scalping V2). The fixture holds 48 candles; a limit-100
        // request legitimately returns fewer candles than asked for
        // when the series is shorter (Binance does the same), and the
        // ICT engine tolerates short series (all length-sensitive
        // paths are guarded). This matters because the watcher's
        // per-tick kline cache shares ONE (symbol, interval) series
        // across engines: the V2 5m/100 fetch and the Scalping 5m/48
        // fetch must read the SAME underlying series, or the test
        // would exercise a split-brain the production cache never
        // produces. When scalpingFail is set (Phase 1), BOTH limits
        // fail: a 5m-endpoint outage takes down V2's 5m fetch too, so
        // the cache cannot smuggle live data past the outage.
        if (interval === '5m' && (limit === 48 || limit === 100)) {
            if (stubState.scalpingFail) {
                return Promise.resolve(new Response('stubbed scalping outage', { status: 500 }));
            }
            const klines = scalpingKlines(symbol, stubState.fiveMinShiftBars);
            if (klines.length === 0) return Promise.resolve(new Response('unknown symbol', { status: 404 }));
            return Promise.resolve(new Response(JSON.stringify(klines), { status: 200 }));
        }
        // v2 1m limit=100 and anything else: live.
        return realFetch(input, init);
    }
    // Binance futures funding. The per-pair call (?symbol=X) returns
    // one object, exactly as Binance does; the bulk call (no symbol)
    // returns the full array. The Standard engine now uses the bulk
    // call (one request per tick instead of one per pair), so the stub
    // must serve the array shape with one row per known symbol, all
    // carrying the phase's stub funding rate.
    if (u.hostname === 'fapi.binance.com' && u.pathname === '/fapi/v1/premiumIndex') {
        if (u.searchParams.get('symbol')) {
            return Promise.resolve(new Response(JSON.stringify({ lastFundingRate: String(stubState.fundingRate) }), { status: 200 }));
        }
        const rows = Object.keys(fixture.klines1h).map((pair) => ({
            symbol: pair.replace('/', ''),
            lastFundingRate: String(stubState.fundingRate)
        }));
        return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
    }
    // Blockchain.info.
    if (u.hostname === 'blockchain.info') {
        if (u.pathname === '/ticker') {
            return Promise.resolve(new Response(JSON.stringify({ USD: { last: fixture.blockchain.btcPrice } }), { status: 200 }));
        }
        if (u.pathname === '/latestblock') {
            return Promise.resolve(new Response(JSON.stringify({ hash: fixture.blockchain.latestHash }), { status: 200 }));
        }
        if (u.pathname.startsWith('/rawblock/')) {
            return Promise.resolve(new Response(JSON.stringify({
                hash: fixture.blockchain.latestHash,
                height: fixture.blockchain.blockHeight,
                prev_block: fixture.blockchain.prevBlock,
                tx: fixture.blockchain.txs
            }), { status: 200 }));
        }
    }
    return realFetch(input, init);
}

// ---------------------------------------------------------------- test main
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function seedSubscription(ecdh: crypto.ECDH, auth: string, endpoint: string): Promise<void> {
    const sub = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } };
    await redisCmd(['HSET', 'push:subs', endpoint, JSON.stringify(sub)]);
}

async function resetState(ecdh: crypto.ECDH, auth: string, endpoint: string): Promise<void> {
    await redisCmd(['FLUSHALL']);
    await seedSubscription(ecdh, auth, endpoint);
    stubState.fiveMinShiftBars = 0;
    stubState.scalpingFail = false;
}

/** Decrypt every payload captured since `fromIndex`; returns parsed payloads. */
function decryptNew(fromIndex: number, ecdh: crypto.ECDH, auth: string): any[] {
    const out: any[] = [];
    for (let i = fromIndex; i < captured.length; i++) {
        const c = captured[i];
        try {
            out.push(JSON.parse(decryptPush(c.body, ecdh, auth)));
        } catch (err) {
            check(`captured payload ${i + 1} decrypts`, false, String(err));
        }
    }
    return out;
}

function assertPayloadShape(payloads: any[], label: string): void {
    for (const p of payloads) {
        const m = TITLE_RE.exec(p.title ?? '');
        check(`${label}: title names its engine (${p.title})`, m !== null, p.title);
        if (m) {
            check(`${label}: url matches its engine (${p.title})`, p.url === ENGINE_URL[m[1]], `${p.url} for ${m[1]}`);
        }
        check(`${label}: body format unchanged (${p.title})`, BODY_RE.test(p.body ?? ''), p.body);
        check(`${label}: icon is the logo URL (${p.title})`, p.icon === LOGO_URL, p.icon);
        check(`${label}: badge is the logo URL (${p.title})`, p.badge === LOGO_URL, p.badge);
    }
    const titles = payloads.map(p => p.title);
    check(`${label}: no duplicate payload titles`, new Set(titles).size === titles.length, JSON.stringify(titles));
}

async function main(): Promise<void> {
    // Wall-clock offset (see header): advancing it simulates a real bar
    // advance. Installed before the first tick; offset 0 is identical.
    const realDateNow = Date.now.bind(Date);
    let nowOffsetMs = 0;
    Date.now = () => realDateNow() + nowOffsetMs;
    const advanceClock = (minutes: number) => { nowOffsetMs = minutes * 60 * 1000; };

    console.log(`fixture: captured ${fixture.capturedAt}; event ${fixture.event.iso} ${fixture.event.direction}; ` +
        `live scalping firing at capture: ${fixture.scalpingFiringLive.join(', ') || 'NONE'}; ` +
        `blockchain txs ${fixture.blockchain.txs.length}, net ${fixture.blockchainLive.netFlowUSD}`);
    if (fixture.scalpingFiringLive.length === 0) {
        console.log('FAIL fixture has no firing scalping pair at capture — re-run capture-push-coverage-fixtures.ts');
        failures++;
    }

    // Env for the watcher (fake Upstash + throwaway VAPID).
    const vapid = generateVAPIDKeys();
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${FAKE_REDIS_PORT}`;
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = vapid.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapid.privateKey;
    process.env.WATCH_SECRET = 'test-watch-secret-push-coverage';
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    await new Promise<void>(r => fakeRedis.listen(FAKE_REDIS_PORT, '127.0.0.1', () => r()));
    await startFakePush();
    console.log(`fake Upstash on 127.0.0.1:${FAKE_REDIS_PORT}; fake push on https://127.0.0.1:${FAKE_PUSH_PORT}`);

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16).toString('base64url');
    const endpoint = `https://127.0.0.1:${FAKE_PUSH_PORT}/push/test-sub-1`;
    await seedSubscription(ecdh, auth, endpoint);

    (globalThis as any).fetch = stubFetch;

    // ------------------------------------------------ Phase 1: engine failure isolation
    console.log('\n-- Phase 1: scalping engine failing (5m fetches 500) --');
    stubState.fundingRate = 0.0001; // neutral: Standard fires BTC SHORT too
    stubState.scalpingFail = true;
    let mark = captured.length;
    const t1 = Date.now();
    const w1 = await checkAndNotify();
    const t1ms = Date.now() - t1;
    await sleep(1500);
    const p1 = decryptNew(mark, ecdh, auth);
    console.log(`  watch: checked ${w1.checked} new ${w1.newCount} sent ${w1.sent} (${t1ms}ms)`);
    check('phase 1: watch configured', w1.configured === true);
    check('phase 1: sent equals payloads received', w1.sent === p1.length, `sent=${w1.sent} captured=${p1.length}`);
    check('phase 1: on-chain alt signals still notify', p1.some(p => p.title.startsWith('On-Chain Signal:') && !p.title.includes('BTC/USDT')), JSON.stringify(p1.map(p => p.title)));
    check('phase 1: standard signals still notify', p1.some(p => p.title.startsWith('Standard Signal:')), JSON.stringify(p1.map(p => p.title)));
    check('phase 1: no scalping payloads while its engine fails', !p1.some(p => p.title.startsWith('Scalping Signal:')), JSON.stringify(p1.map(p => p.title)));
    check('phase 1: on-chain BTC suppressed by Standard dedup', !p1.some(p => p.title === 'On-Chain Signal: BTC/USDT SHORT'), JSON.stringify(p1.map(p => p.title)));
    assertPayloadShape(p1, 'phase 1');

    // ------------------------------------------------ Phase 2: labels + no-spam
    console.log('\n-- Phase 2: labels + first-seen (funding blocks Standard SHORTs) --');
    await resetState(ecdh, auth, endpoint);
    stubState.fundingRate = -0.0006; // blocks Standard SHORTs (< -0.05%)
    mark = captured.length;
    const t2 = Date.now();
    const w2 = await checkAndNotify();
    const t2ms = Date.now() - t2;
    await sleep(1500);
    const p2 = decryptNew(mark, ecdh, auth);
    console.log(`  watch tick A: checked ${w2.checked} new ${w2.newCount} sent ${w2.sent} (${t2ms}ms)`);
    console.log(`  payloads: ${p2.map(p => p.title).join(' | ')}`);
    check('phase 2A: watch configured', w2.configured === true);
    check('phase 2A: sent equals payloads received', w2.sent === p2.length, `sent=${w2.sent} captured=${p2.length}`);
    check('phase 2A: Scalping Signal: UNI/USDT LONG', p2.some(p => p.title === 'Scalping Signal: UNI/USDT LONG'), JSON.stringify(p2.map(p => p.title)));
    check('phase 2A: Scalping Signal: NEAR/USDT LONG', p2.some(p => p.title === 'Scalping Signal: NEAR/USDT LONG'), JSON.stringify(p2.map(p => p.title)));
    check('phase 2A: Scalping Signal: BTC/USDT LONG', p2.some(p => p.title === 'Scalping Signal: BTC/USDT LONG'), JSON.stringify(p2.map(p => p.title)));
    check('phase 2A: On-Chain Signal: BTC/USDT SHORT', p2.some(p => p.title === 'On-Chain Signal: BTC/USDT SHORT'), JSON.stringify(p2.map(p => p.title)));
    check('phase 2A: on-chain alt signals notify', p2.some(p => p.title.startsWith('On-Chain Signal:') && !p.title.includes('BTC/USDT')), JSON.stringify(p2.map(p => p.title)));
    check('phase 2A: no Standard BTC SHORT (funding-blocked)', !p2.some(p => p.title === 'Standard Signal: BTC/USDT SHORT'), JSON.stringify(p2.map(p => p.title)));
    assertPayloadShape(p2, 'phase 2A');

    // Tick B: identical fixture -> nothing new.
    mark = captured.length;
    const w2b = await checkAndNotify();
    await sleep(1500);
    const p2b = decryptNew(mark, ecdh, auth);
    console.log(`  watch tick B: checked ${w2b.checked} new ${w2b.newCount} sent ${w2b.sent}`);
    check('phase 2B: second tick finds nothing new', w2b.newCount === 0, `newCount=${w2b.newCount}`);
    check('phase 2B: second tick sends nothing', w2b.sent === 0, `sent=${w2b.sent}`);
    check('phase 2B: no additional POSTs', p2b.length === 0, `${p2b.length} new payloads`);

    // Tick C: wall clock advanced one 5m bar (same setup persists) -> still nothing.
    advanceClock(5);
    mark = captured.length;
    const w2c = await checkAndNotify();
    await sleep(1500);
    const p2c = decryptNew(mark, ecdh, auth);
    console.log(`  watch tick C (wall clock +5m, one 5m bar advanced): checked ${w2c.checked} new ${w2c.newCount} sent ${w2c.sent}`);
    check('phase 2C: bar advance finds nothing new (first-seen holds)', w2c.newCount === 0, `newCount=${w2c.newCount}`);
    check('phase 2C: bar advance sends nothing', w2c.sent === 0, `sent=${w2c.sent}`);
    check('phase 2C: no additional POSTs', p2c.length === 0, `${p2c.length} new payloads`);

    // ------------------------------------------------ Phase 3: BTC dedup
    console.log('\n-- Phase 3: on-chain BTC dedup (funding neutral) --');
    stubState.fundingRate = 0.0001;
    mark = captured.length;
    const w3 = await checkAndNotify();
    await sleep(1500);
    const p3 = decryptNew(mark, ecdh, auth);
    console.log(`  watch tick D: checked ${w3.checked} new ${w3.newCount} sent ${w3.sent}`);
    console.log(`  payloads: ${p3.map(p => p.title).join(' | ')}`);
    check('phase 3: Standard BTC SHORT notifies', p3.some(p => p.title === 'Standard Signal: BTC/USDT SHORT'), JSON.stringify(p3.map(p => p.title)));
    check('phase 3: no new On-Chain BTC SHORT (deduped)', !p3.some(p => p.title === 'On-Chain Signal: BTC/USDT SHORT'), JSON.stringify(p3.map(p => p.title)));
    check('phase 3: sent equals payloads received', w3.sent === p3.length, `sent=${w3.sent} captured=${p3.length}`);
    assertPayloadShape(p3, 'phase 3');

    // ------------------------------------------------ Phase 4: expiry -> new setup
    console.log('\n-- Phase 4: first-seen expiry simulates a new setup --');
    // First-seen TTLs (asserted before simulating expiry).
    const ttlScalp = await redisCmd(['TTL', 'push:firstseen:scalping:NEAR/USDT:LONG']);
    const ttlOnchain = await redisCmd(['TTL', 'push:firstseen:onchain:BTC/USDT:SHORT']);
    console.log(`  TTL scalping NEAR LONG: ${ttlScalp}s (want ~14400); TTL on-chain BTC SHORT: ${ttlOnchain}s (want ~172800)`);
    check('phase 4: scalping first-seen TTL is 4h', typeof ttlScalp === 'number' && Math.abs(ttlScalp - 14400) <= 900, `TTL=${ttlScalp}`);
    check('phase 4: on-chain first-seen TTL is 48h', typeof ttlOnchain === 'number' && Math.abs(ttlOnchain - 172800) <= 900, `TTL=${ttlOnchain}`);
    // Expire UNI LONG's first-seen entry and advance the clock another
    // 10 minutes (two more 5m bars): it notifies again, under a NEW id.
    // (Deleting the key alone is not enough: the notified set would still
    // block the identical id — a genuinely new setup needs a new bar.)
    await redisCmd(['DEL', 'push:firstseen:scalping:UNI/USDT:LONG']);
    advanceClock(15);
    mark = captured.length;
    const w4 = await checkAndNotify();
    await sleep(1500);
    const p4 = decryptNew(mark, ecdh, auth);
    console.log(`  watch tick E: checked ${w4.checked} new ${w4.newCount} sent ${w4.sent}`);
    console.log(`  payloads: ${p4.map(p => p.title).join(' | ')}`);
    check('phase 4: UNI LONG notifies again after first-seen expiry', p4.some(p => p.title === 'Scalping Signal: UNI/USDT LONG'), JSON.stringify(p4.map(p => p.title)));
    const notifiedIds: string[] = await redisCmd(['ZRANGE', 'push:notified', 0, -1]);
    const uniIds = notifiedIds.filter(id => id.startsWith('scalping:UNI/USDT:LONG:'));
    console.log(`  scalping UNI LONG ids in push:notified: ${JSON.stringify(uniIds)}`);
    check('phase 4: two distinct scalping UNI LONG ids (old + new anchor)', uniIds.length === 2 && new Set(uniIds).size === 2, JSON.stringify(uniIds));
    assertPayloadShape(p4, 'phase 4');

    // ------------------------------------------------ summary
    console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
    fakeRedis.close();
    try { fakePush.close(); } catch { /* already closed */ }
    for (const f of ['/tmp/push-coverage-test-key.pem', '/tmp/push-coverage-test-cert.pem']) {
        try { fs.unlinkSync(f); } catch { /* already gone */ }
    }
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
