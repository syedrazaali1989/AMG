/**
 * Live smoke test for push coverage (old scalping + on-chain in the watcher).
 *
 * Runs the REAL production build (`next start`) against a FAKE Upstash
 * Redis REST endpoint + a FAKE HTTPS push endpoint (throwaway VAPID +
 * real ECDH P-256 subscription, payloads decrypted per RFC 8291) and
 * REAL live Binance / Blockchain.info data.
 *
 * What it proves:
 *  (a) the 5-engine watch tick completes over HTTP (no timeout) and
 *      returns configured:true with a history summary;
 *  (b) a second watch tick sends nothing already sent (dedup over the
 *      wire — no duplicate payload titles; a genuinely new scalping
 *      setup appearing across a 5m bar boundary is legitimate and is
 *      reported, not hidden);
 *  (c) each engine route still responds (Standard, Scalping V2, Gold,
 *      Scalping, On-Chain) — timed individually, so the load each engine
 *      adds to the tick is visible;
 *  (d) the tick duration vs the Vercel Hobby ~10s serverless limit:
 *      the module test (scripts/test-push-coverage.ts) proves payload
 *      correctness deterministically; this smoke measures REAL load.
 *      A tick > ~8s is reported as a load risk, not hidden.
 *
 * ORDER MATTERS: the watch ticks run FIRST, before any engine-route
 * call — /api/signals fires a fire-and-forget opportunistic
 * checkAndNotify in the background, which would otherwise overlap the
 * measured tick and contaminate its timing (both ticks compete for the
 * same CPU and Binance rate limit).
 *
 * Payload proof lives in the module test; this smoke does NOT fail
 * when the live market has no signals at that moment (it reports the
 * live counts instead). It FAILS when the watch route errors, times
 * out, or any engine route errors.
 *
 * Usage: npm run build && node scripts/test-push-coverage-smoke.mjs
 * Exits 0 on pass, 1 on any failed assertion. Kills the server it started.
 */
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { generateVAPIDKeys } = require('web-push');

const FAKE_REDIS_PORT = 6395;
const FAKE_PUSH_PORT = 6396;
const NEXT_PORT = 3102;
const BASE = `http://127.0.0.1:${NEXT_PORT}`;
const WATCH_SECRET = 'test-watch-secret-push-coverage-smoke';
const LOGO_URL = 'https://amgtrading.vercel.app/logo.png';
const TITLE_RE = /^(Standard|Scalping V2|Gold|Scalping|On-Chain) Signal: \S+ (LONG|SHORT)$/;

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
// Extended subset of the Upstash REST protocol (SET ... EX + TTL, as the
// first-seen keys are written with an expiry).
const hashes = new Map();
const zsets = new Map();
const kv = new Map();

function kvGet(key) {
    const e = kv.get(key);
    if (!e) return null;
    if (e.expiresAt !== null && Date.now() >= e.expiresAt) { kv.delete(key); return null; }
    return e.value;
}

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
        case 'HLEN': return hashes.get(String(cmd[1]))?.size ?? 0;
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
        case 'ZCARD': return zsets.get(String(cmd[1]))?.size ?? 0;
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
        case 'GET': return kvGet(String(cmd[1]));
        case 'SET': {
            let expiresAt = null;
            for (let i = 3; i < cmd.length; i++) {
                const opt = String(cmd[i]).toUpperCase();
                if (opt === 'EX') expiresAt = Date.now() + parseFloat(String(cmd[i + 1])) * 1000;
                if (opt === 'PX') expiresAt = Date.now() + parseFloat(String(cmd[i + 1]));
            }
            kv.set(String(cmd[1]), { value: String(cmd[2]), expiresAt });
            return 'OK';
        }
        case 'TTL': {
            const e = kv.get(String(cmd[1]));
            if (!e) return -2;
            if (e.expiresAt === null) return -1;
            const left = Math.ceil((e.expiresAt - Date.now()) / 1000);
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
        case 'FLUSHALL': hashes.clear(); zsets.clear(); kv.clear(); return 'OK';
        default: throw new Error(`fake redis: unsupported command ${name}`);
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

// ---------------------------------------------------------------- fake push + decrypt
const captured = [];
let fakePush;
function startFakePush() {
    const keyPath = '/tmp/push-coverage-smoke-key.pem';
    const certPath = '/tmp/push-coverage-smoke-cert.pem';
    execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes ` +
        `-subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" 2>/dev/null`,
        { stdio: 'ignore' }
    );
    fakePush = https.createServer(
        { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) },
        (req, res) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                captured.push({ headers: req.headers, body: Buffer.concat(chunks), at: Date.now() });
                res.writeHead(201);
                res.end();
            });
        }
    );
    return new Promise(r => fakePush.listen(FAKE_PUSH_PORT, '127.0.0.1', () => r()));
}

function hkdfExtract(salt, ikm) { return crypto.createHmac('sha256', salt).update(ikm).digest(); }
function hkdfExpand(prk, info, length) {
    const t1 = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
    return t1.subarray(0, length);
}
function hkdf(salt, ikm, info, length) { return hkdfExpand(hkdfExtract(salt, ikm), info, length); }
function decryptPush(body, ecdh, authB64) {
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

// ---------------------------------------------------------------- main
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok || res.status === 404) return true;
        } catch { /* not up yet */ }
        await sleep(1000);
    }
    return false;
}

async function timedFetch(url, opts) {
    const t0 = Date.now();
    const res = await fetch(url, opts);
    const ms = Date.now() - t0;
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    return { status: res.status, ms, json };
}

async function main() {
    const vapid = generateVAPIDKeys();
    const env = {
        ...process.env,
        UPSTASH_REDIS_REST_URL: `http://127.0.0.1:${FAKE_REDIS_PORT}`,
        UPSTASH_REDIS_REST_TOKEN: 'test-token',
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        WATCH_SECRET,
        NODE_TLS_REJECT_UNAUTHORIZED: '0'
    };

    await new Promise(r => fakeRedis.listen(FAKE_REDIS_PORT, '127.0.0.1', () => r()));
    await startFakePush();
    console.log(`fake Upstash on 127.0.0.1:${FAKE_REDIS_PORT}; fake push on https://127.0.0.1:${FAKE_PUSH_PORT}`);

    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const auth = crypto.randomBytes(16).toString('base64url');
    const endpoint = `https://127.0.0.1:${FAKE_PUSH_PORT}/push/test-sub-1`;

    console.log('starting next start...');
    const server = spawn('npx', ['next', 'start', '-p', String(NEXT_PORT)], {
        cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    server.stdout.on('data', d => process.stdout.write(`[next] ${d}`));
    server.stderr.on('data', d => process.stdout.write(`[next:err] ${d}`));
    const kill = () => { try { server.kill('SIGTERM'); } catch { /* already dead */ } };

    try {
        if (!(await waitForServer(`${BASE}/api/history`))) {
            console.log('FAIL next start did not come up');
            failures++;
            return;
        }
        console.log('server up');

        // --- 1. Push key + subscribe via the real routes ---
        const keyRes = await timedFetch(`${BASE}/api/push/key`);
        console.log(`  /api/push/key ${keyRes.status} (${keyRes.ms}ms) publicKey present: ${!!keyRes.json?.publicKey}`);
        check('push key route serves the public key', keyRes.status === 200 && !!keyRes.json?.publicKey);

        const sub = { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth } };
        const subRes = await timedFetch(`${BASE}/api/push/subscribe`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub })
        });
        const subJson = subRes.json;
        console.log(`  POST /api/push/subscribe ${subRes.status} (${subRes.ms}ms) ${JSON.stringify(subJson)}`);
        check('subscribe route accepts the subscription', subRes.status === 200 && subJson?.ok === true, JSON.stringify(subJson));

        // --- 2. Watch tick 1 (timed) — FIRST engine evaluation (cold) ---
        console.log('\n-- watch tick 1 (all five engines, cold) --');
        const allPayloads = [];
        async function runWatch(label) {
            const mark = captured.length;
            const w = await timedFetch(`${BASE}/api/push/watch`, { headers: { 'x-watch-secret': WATCH_SECRET } });
            console.log(`  GET /api/push/watch ${label}: ${w.status} in ${w.ms}ms`);
            console.log(`  watch ${label}: ${JSON.stringify(w.json)}`);
            await sleep(1500);
            const payloads = [];
            for (let i = mark; i < captured.length; i++) {
                try { payloads.push(JSON.parse(decryptPush(captured[i].body, ecdh, auth))); } catch (err) {
                    check(`captured payload ${i + 1} decrypts`, false, String(err));
                }
            }
            console.log(`  payloads received ${label}: ${payloads.length} (watch sent ${w.json?.sent}, new ${w.json?.newCount})`);
            for (const p of payloads) console.log(`    ${p.title} | icon=${p.icon === LOGO_URL} badge=${p.badge === LOGO_URL} | ${p.url}`);
            return { w, payloads };
        }
        const tick1 = await runWatch('(tick 1, cold)');
        check('watch tick 1 returns 200', tick1.w.status === 200, `status=${tick1.w.status}`);
        check('watch tick 1 configured', tick1.w.json?.configured === true);
        check('watch tick 1 history configured', tick1.w.json?.history?.configured === true);
        check('watch tick 1 sent equals payloads received', tick1.w.json?.sent === tick1.payloads.length,
            `sent=${tick1.w.json?.sent} captured=${tick1.payloads.length}`);
        for (const p of tick1.payloads) {
            check(`payload title names its engine (${p.title})`, TITLE_RE.test(p.title ?? ''), p.title);
            check(`payload icon is the logo URL (${p.title})`, p.icon === LOGO_URL, p.icon);
            check(`payload badge is the logo URL (${p.title})`, p.badge === LOGO_URL, p.badge);
        }
        if (tick1.payloads.length === 0) {
            console.log('  NOTE: live market fired no signal during this run — payload proof lives in the deterministic module test (scripts/test-push-coverage.ts), not here.');
        }
        check('watch tick 1 within the ~10s Vercel Hobby budget', tick1.w.ms < 10000, `${tick1.w.ms}ms`);
        if (tick1.w.ms >= 8000) {
            console.log(`  LOAD RISK: watch tick 1 took ${tick1.w.ms}ms — within ~2s of the Vercel Hobby 10s serverless limit`);
        }
        allPayloads.push(...tick1.payloads);

        // --- 3. Watch tick 2 (timed) — dedup over the wire ---
        console.log('\n-- watch tick 2 (dedup) --');
        const tick2 = await runWatch('(tick 2)');
        check('watch tick 2 returns 200', tick2.w.status === 200, `status=${tick2.w.status}`);
        const dupTitles = tick2.payloads.filter(p => allPayloads.some(q => q.title === p.title)).map(p => p.title);
        check('watch tick 2 sends no duplicate payload titles', dupTitles.length === 0, JSON.stringify(dupTitles));
        check('watch tick 2 sent equals payloads received', tick2.w.json?.sent === tick2.payloads.length,
            `sent=${tick2.w.json?.sent} captured=${tick2.payloads.length}`);
        if ((tick2.w.json?.newCount ?? 0) > 0) {
            console.log(`  NOTE: tick 2 found ${tick2.w.json.newCount} genuinely new candidate(s) (live market moved across a 5m bar) — not a dedup failure.`);
        }
        check('watch tick 2 within the ~10s Vercel Hobby budget', tick2.w.ms < 10000, `${tick2.w.ms}ms`);
        allPayloads.push(...tick2.payloads);

        // --- 4. Time each engine route individually (load per engine) ---
        // (After the watches: /api/signals fires a background opportunistic
        // checkAndNotify, which is harmless now that the ticks are measured.)
        console.log('\n-- engine routes (live, timed) --');
        const routes = [
            ['Standard', '/api/signals'],
            ['Scalping V2', '/api/scalping-v2/signals'],
            ['Gold', '/api/gold/signals'],
            ['Scalping', '/api/scalping/signals'],
            ['On-Chain', '/api/on-chain/signals']
        ];
        const routeCounts = {};
        for (const [name, path] of routes) {
            const r = await timedFetch(`${BASE}${path}`);
            const n = Array.isArray(r.json?.signals) ? r.json.signals.length : -1;
            routeCounts[name] = n;
            console.log(`  ${name} ${path}: ${r.status} in ${r.ms}ms, ${n} signal(s)`);
            check(`${name} route responds 200`, r.status === 200, `status=${r.status}`);
        }
        console.log('  live route signal counts:', JSON.stringify(routeCounts));

        // --- 5. Watch tick 3 (warm steady-state tick, after the routes) ---
        console.log('\n-- watch tick 3 (warm) --');
        const tick3 = await runWatch('(tick 3, warm)');
        check('watch tick 3 returns 200', tick3.w.status === 200, `status=${tick3.w.status}`);
        check('watch tick 3 within the ~10s Vercel Hobby budget', tick3.w.ms < 10000, `${tick3.w.ms}ms`);
        if (tick3.w.ms >= 8000) {
            console.log(`  LOAD RISK: watch tick 3 took ${tick3.w.ms}ms — within ~2s of the Vercel Hobby 10s serverless limit`);
        }

        // --- 6. First-seen keys present with TTLs (read via the fake) ---
        console.log('\n-- first-seen keys (fake Redis) --');
        const firstSeen = [...kv.keys()].filter(k => k.startsWith('push:firstseen:'));
        console.log(`  ${firstSeen.length} first-seen key(s): ${firstSeen.slice(0, 8).join(', ')}${firstSeen.length > 8 ? ' ...' : ''}`);
        check('first-seen keys recorded for the new engines', firstSeen.some(k => k.startsWith('push:firstseen:scalping:')) || firstSeen.some(k => k.startsWith('push:firstseen:onchain:')) || allPayloads.length === 0,
            `keys=${JSON.stringify(firstSeen)} payloads=${allPayloads.length}`);
    } finally {
        kill();
        await sleep(1000);
        fakeRedis.close();
        try { fakePush.close(); } catch { /* already closed */ }
        for (const f of ['/tmp/push-coverage-smoke-key.pem', '/tmp/push-coverage-smoke-cert.pem']) {
            try { fs.unlinkSync(f); } catch { /* already gone */ }
        }
    }

    console.log(`\n${failures === 0 ? 'SMOKE PASSED' : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('SMOKE ERROR:', err);
    process.exit(1);
});
