/**
 * Mocked end-to-end test for push notification labels + logo icon.
 *
 * Runs the REAL production build (`next start`) against:
 *  - a FAKE Upstash Redis REST endpoint on 127.0.0.1 (in-memory, this file)
 *  - a FAKE push endpoint on 127.0.0.1 (HTTPS with a throwaway
 *    self-signed cert; web-push only speaks HTTPS, and the server runs
 *    with NODE_TLS_REJECT_UNAUTHORIZED=0 so it accepts the cert)
 *  - throwaway VAPID keys + a real ECDH P-256 subscription keypair
 *    generated here, so captured payloads can be DECRYPTED (RFC 8291
 *    aes128gcm) and their titles / icon / badge asserted exactly
 *  - REAL live Binance data for the engines (read-only)
 *
 * What it proves:
 *  (a) every push payload title names its engine:
 *      "<Engine> Signal: <PAIR> <DIRECTION>" (Standard / Scalping V2 / Gold)
 *  (b) every payload carries icon + badge = the AMG logo URL
 *  (c) no duplicate sends (second watch tick sends nothing new)
 *  (d) an engine with no signals does not block the others
 *      (Promise.allSettled in the watcher + live: payloads arrive while
 *      at least one engine's route returns zero signals)
 *
 * The test seeds ONE subscription via the real POST /api/push/subscribe
 * route, then drives the real GET /api/push/watch trigger. Fresh fake
 * Redis means every currently-active live signal is "fresh" on the
 * first tick. If the live market fires no signal at all during the run
 * (possible in a dead market), the test FAILS clearly with that reason
 * instead of passing vacuously.
 *
 * Usage: npm run build && node scripts/test-push-label-icon.mjs
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

const FAKE_REDIS_PORT = 6391;
const FAKE_PUSH_PORT = 6392;
const NEXT_PORT = 3101;
const BASE = `http://127.0.0.1:${NEXT_PORT}`;
const WATCH_SECRET = 'test-watch-secret-push-label-icon';
const LOGO_URL = 'https://amgtrading.vercel.app/logo.png';
const TITLE_RE = /^(Standard|Scalping V2|Gold) Signal: \S+ (LONG|SHORT)$/;
const BODY_RE = /^Entry \S+ · SL \S+ · TP1 \S+$/;
const ENGINE_URL = { Standard: '/dashboard', 'Scalping V2': '/scalping-v2', Gold: '/gold' };

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
// Same subset of the Upstash REST protocol as scripts/test-signal-history.mjs.
const hashes = new Map();
const zsets = new Map();
const kv = new Map();

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

// ---------------------------------------------------------------- fake push endpoint
// Captures every POST the server's web-push send makes (headers + raw body).
const captured = [];
let fakePush;
function startFakePush() {
    const keyPath = '/tmp/push-test-key.pem';
    const certPath = '/tmp/push-test-cert.pem';
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
                captured.push({
                    headers: req.headers,
                    body: Buffer.concat(chunks),
                    at: Date.now()
                });
                res.writeHead(201);
                res.end();
            });
        }
    );
    return new Promise(r => fakePush.listen(FAKE_PUSH_PORT, '127.0.0.1', r));
}

// ---------------------------------------------------------------- RFC 8291 aes128gcm decrypt
// Exact construction http_ece (the library web-push uses) implements:
//   secret = HKDF(auth, ECDH(myPriv, keyid),
//                  "WebPush: info" || 0x00 || receiverPub || senderPub, 32)
//   prk    = HKDF-Extract(messageSalt, secret)
//   key    = HKDF-Expand(prk, "Content-Encoding: aes128gcm" || 0x00, 16)
//   nonce  = HKDF-Expand(prk, "Content-Encoding: nonce" || 0x00, 12)
//   record = AES-128-GCM(key, nonce, ciphertext); plaintext ends
//            "...message 0x00*pad 0x02" (trailing 0x02 delimiter).
function hkdfExtract(salt, ikm) {
    return crypto.createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk, info, length) {
    const t1 = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest();
    return t1.subarray(0, length);
}

function hkdf(salt, ikm, info, length) {
    return hkdfExpand(hkdfExtract(salt, ikm), info, length);
}

function decryptPush(body, ecdh, authB64) {
    const salt = body.subarray(0, 16);
    const idlen = body[20];
    const keyid = body.subarray(21, 21 + idlen);
    const ciphertext = body.subarray(21 + idlen);
    const shared = ecdh.computeSecret(keyid);
    const auth = Buffer.from(authB64, 'base64url');
    const receiverPub = ecdh.getPublicKey();
    const secret = hkdf(auth, shared,
        Buffer.concat([Buffer.from('WebPush: info\0'), receiverPub, keyid]), 32);
    const prk = hkdfExtract(salt, secret);
    const cek = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0])]), 16);
    const nonce = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce'), Buffer.from([0])]), 12);
    const tag = ciphertext.subarray(ciphertext.length - 16);
    const data = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    // Trailing padding: message || 0x00*pad || 0x02 (last record).
    let i = plain.length - 1;
    while (i >= 0 && plain[i] === 0) i--;
    if (i < 0 || plain[i] !== 2) throw new Error('invalid aes128gcm padding');
    return plain.subarray(0, i).toString('utf8');
}

// ---------------------------------------------------------------- helpers
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- main
async function main() {
    await new Promise(r => fakeRedis.listen(FAKE_REDIS_PORT, '127.0.0.1', r));
    console.log(`fake Upstash Redis on 127.0.0.1:${FAKE_REDIS_PORT}`);
    await startFakePush();
    console.log(`fake push endpoint on https://127.0.0.1:${FAKE_PUSH_PORT}`);

    // Real ECDH P-256 subscription keypair (the test holds the private
    // half, so captured payloads can be decrypted and asserted exactly).
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    const p256dh = ecdh.getPublicKey().toString('base64url');
    const auth = crypto.randomBytes(16).toString('base64url');
    const endpoint = `https://127.0.0.1:${FAKE_PUSH_PORT}/push/test-sub-1`;

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
        WATCH_SECRET,
        NODE_TLS_REJECT_UNAUTHORIZED: '0'
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

        // --- 1. Push key + subscribe via the real routes ---
        const keyRes = await fetch(`${BASE}/api/push/key`);
        const keyJson = await keyRes.json();
        check('push key returns the throwaway public key', keyJson.publicKey === vapid.publicKey);

        const subRes = await fetch(`${BASE}/api/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: { endpoint, keys: { p256dh, auth } } })
        });
        const subJson = await subRes.json();
        check('subscribe stores the subscription', subRes.status === 200 && subJson.ok === true, JSON.stringify(subJson));
        const subs = await redisCmd(['HGETALL', 'push:subs']);
        // HGETALL comes back as a FLAT array [field, value, ...]: one
        // stored subscription = two array entries.
        check('exactly one subscription stored', (subs?.length ?? 0) / 2 === 1, JSON.stringify(subs));

        // --- 2. Watch tick: live engines fire, payloads land at the fake endpoint ---
        // Fresh fake Redis, so every currently-active live signal is "fresh".
        // A transient 418 can leave an engine empty; retry a few times.
        let watch = null;
        let payloads = [];
        for (let attempt = 1; attempt <= 4; attempt++) {
            console.log(`GET /api/push/watch (attempt ${attempt}/4)`);
            watch = await (await fetch(`${BASE}/api/push/watch`, {
                headers: { 'x-watch-secret': WATCH_SECRET }
            })).json();
            console.log('  watch:', JSON.stringify(watch));
            await sleep(2000); // let in-flight sends land
            if (captured.length > 0) break;
            if (attempt < 4) {
                console.log('  no payloads yet - retrying watch in 60s (live engines may have been rate-limited)');
                await sleep(60000);
            }
        }

        check('watch configured', watch?.configured === true);
        check('at least one push payload captured (live signals fired)', captured.length > 0,
            captured.length === 0 ? 'no live signal fired during the run - rerun when an engine has an active signal' : '');
        check('watch sent equals payloads received', watch?.sent === captured.length,
            `sent=${watch?.sent} captured=${captured.length}`);
        check('watch newCount equals payloads received', watch?.newCount === captured.length,
            `newCount=${watch?.newCount} captured=${captured.length}`);

        // --- 3. Decrypt + assert every payload ---
        for (const [i, c] of captured.entries()) {
            check(`payload ${i + 1} is aes128gcm`, c.headers['content-encoding'] === 'aes128gcm',
                `got ${c.headers['content-encoding']}`);
            let payload;
            try {
                payload = JSON.parse(decryptPush(c.body, ecdh, auth));
            } catch (err) {
                check(`payload ${i + 1} decrypts`, false, String(err));
                continue;
            }
            console.log(`  payload ${i + 1}:`, JSON.stringify(payload));
            const titleMatch = TITLE_RE.exec(payload.title ?? '');
            check(`payload ${i + 1} title names its engine`, titleMatch !== null, payload.title);
            check(`payload ${i + 1} body format unchanged (Entry · SL · TP1)`, BODY_RE.test(payload.body ?? ''), payload.body);
            check(`payload ${i + 1} icon is the logo URL`, payload.icon === LOGO_URL, payload.icon);
            check(`payload ${i + 1} badge is the logo URL`, payload.badge === LOGO_URL, payload.badge);
            if (titleMatch) {
                check(`payload ${i + 1} url matches its engine`, payload.url === ENGINE_URL[titleMatch[1]],
                    `${payload.url} for ${titleMatch[1]}`);
            }
            payloads.push(payload);
        }
        const titles = payloads.map(p => p.title);
        check('no duplicate payload titles', payloads.length > 0 && new Set(titles).size === titles.length, JSON.stringify(titles));

        // --- 4. Dedup: a second watch tick sends nothing new ---
        const before = captured.length;
        const watch2 = await (await fetch(`${BASE}/api/push/watch`, {
            headers: { 'x-watch-secret': WATCH_SECRET }
        })).json();
        console.log('  watch 2:', JSON.stringify(watch2));
        await sleep(2000);
        check('second watch finds nothing new', watch2.newCount === 0, `newCount=${watch2.newCount}`);
        check('second watch sends nothing', watch2.sent === 0, `sent=${watch2.sent}`);
        check('no additional POSTs after second watch', captured.length === before,
            `${captured.length} vs ${before}`);

        // --- 5. Engine isolation: an empty engine does not block the others ---
        // Fetch the three engine routes AFTER the payload checks (their
        // opportunistic trigger can only re-check already-recorded ids).
        const routeCounts = {};
        for (const [name, path] of [['Standard', '/api/signals'], ['Scalping V2', '/api/scalping-v2/signals'], ['Gold', '/api/gold/signals']]) {
            try {
                const r = await fetch(`${BASE}${path}`);
                const j = await r.json();
                routeCounts[name] = Array.isArray(j.signals) ? j.signals.length : -1;
            } catch {
                routeCounts[name] = -1;
            }
        }
        console.log('  live route signal counts:', JSON.stringify(routeCounts));
        const enginesWithPayloads = new Set(payloads.map(p => TITLE_RE.exec(p.title)?.[1]).filter(Boolean));
        const emptyEngines = Object.entries(routeCounts).filter(([, n]) => n === 0).map(([n]) => n);
        check('payloads arrived for at least one engine', enginesWithPayloads.size >= 1);
        check('an engine with zero live signals did not block the others',
            emptyEngines.length > 0 && enginesWithPayloads.size >= 1,
            emptyEngines.length === 0
                ? 'all three engines were firing live, so isolation is shown by code (Promise.allSettled) not by this run'
                : `empty: ${emptyEngines.join(', ')}; notified: ${[...enginesWithPayloads].join(', ')}`);
        const notifySrc = fs.readFileSync(path.join(ROOT, 'src/lib/push/notify.ts'), 'utf8');
        check('watcher isolates engines with Promise.allSettled', notifySrc.includes('Promise.allSettled'));

        // --- 6. Served assets: sw.js passes icon/badge through; logo serves ---
        const swRes = await fetch(`${BASE}/sw.js`);
        const swText = await swRes.text();
        check('served sw.js passes data.icon through', swText.includes('icon: data.icon'));
        check('served sw.js passes data.badge through', swText.includes('badge: data.badge'));
        const logoRes = await fetch(`${BASE}/logo.png`);
        check('logo serves 200 as PNG', logoRes.status === 200 && (logoRes.headers.get('content-type') || '').includes('image/png'),
            `${logoRes.status} ${(logoRes.headers.get('content-type') || '')}`);

        // --- 7. Subscription still stored, nothing removed ---
        const subsAfter = await redisCmd(['HGETALL', 'push:subs']);
        check('subscription still stored after sends', (subsAfter?.length ?? 0) / 2 === 1, JSON.stringify(subsAfter));
        check('no subscriptions removed by the watcher', (watch?.removedSubscriptions ?? 0) === 0);
    } finally {
        killServer();
        fakeRedis.close();
        try { fakePush.close(); } catch { /* already closed */ }
        for (const f of ['/tmp/push-test-key.pem', '/tmp/push-test-cert.pem']) {
            try { fs.unlinkSync(f); } catch { /* already gone */ }
        }
        if (serverLog.trim()) console.log('--- server log (tail) ---\n' + serverLog.slice(-3000));
    }

    console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
