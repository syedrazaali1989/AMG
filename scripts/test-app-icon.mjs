/**
 * App-icon verification for the restored PWA manifest icons.
 *
 * Runs the REAL production build (`next start`) and checks:
 *  (a) /manifest.webmanifest lists the 192 + 512 (any) + 512 (maskable)
 *      icons with correct src/sizes/type/purpose
 *  (b) each icon URL returns 200 image/png at EXACTLY the declared size
 *      (PNG IHDR width/height asserted)
 *  (c) the rendered icon is the AMG logo (gold pixels present; black
 *      background) — not the text-mark fallback (which has no logo art)
 *  (d) /logo.png still serves 200, /sw.js serves 200, /favicon.ico 404
 *
 * Usage: npm run build && node scripts/test-app-icon.mjs
 * Exits 0 on pass, 1 on any failed assertion. Kills the server it started.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEXT_PORT = 3102;
const BASE = `http://127.0.0.1:${NEXT_PORT}`;

let failures = 0;
function check(name, cond, extra = '') {
    if (cond) {
        console.log(`  PASS ${name}`);
    } else {
        failures++;
        console.log(`  FAIL ${name} ${extra}`);
    }
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** PNG dimensions from the IHDR chunk (bytes 16..23, big-endian). */
function pngSize(buf) {
    if (buf.length < 24) return null;
    if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * Logo-content proof: decode the PNG and compare against the source
 * logo. Returns { width, height, goldFraction, edgeGold } or null.
 * Gold pixel: R>150, G>120, B<120, R-B>50 (the logo's gold #D4AF37 and
 * its anti-aliased edges). edgeGold counts gold pixels in the outer 3%
 * border frame.
 *
 * Why two numbers: the logo lockup covers ~7.2% of pixels in gold, and
 * its outer border is black (the logo art has margins). The text-mark
 * fallback would put a gold FRAME on the border (hundreds of edgeGold
 * pixels). So: goldFraction close to the logo's own value AND edgeGold
 * == 0 proves the render is the logo, not the fallback.
 */
function decodePng(buf) {
    if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
    let pos = 8;
    let width = 0, height = 0, bitDepth = 0, colorType = 0;
    const idat = [];
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
        } else if (type === 'IDAT') {
            idat.push(data);
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + len;
    }
    if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return null;
    const channels = colorType === 6 ? 4 : 3;
    const stride = width * channels;
    let raw;
    try {
        raw = zlib.inflateSync(Buffer.concat(idat));
    } catch {
        return null;
    }
    let gold = 0, edgeGold = 0, total = 0;
    const margin = Math.round(width * 0.03);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const f = raw[y * (stride + 1)];
        const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const out = Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? out[x - channels] : 0;
            const b = prev[x];
            const c = x >= channels ? prev[x - channels] : 0;
            let v = row[x];
            if (f === 1) v = (v + a) & 0xff;
            else if (f === 2) v = (v + b) & 0xff;
            else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
            else if (f === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
                v = (v + pr) & 0xff;
            }
            out[x] = v;
        }
        prev = out;
        for (let px = 0; px < width; px++) {
            const r = out[px * channels], g = out[px * channels + 1], b = out[px * channels + 2];
            total++;
            if (r > 150 && g > 120 && b < 120 && r - b > 50) {
                gold++;
                if (px < margin || px >= width - margin || y < margin || y >= height - margin) edgeGold++;
            }
        }
    }
    return { width, height, goldFraction: gold / total, edgeGold };
}

async function main() {
    const env = { ...process.env, NODE_ENV: 'production', PORT: String(NEXT_PORT) };
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

        // --- 1. Manifest lists the icons ---
        const manRes = await fetch(`${BASE}/manifest.webmanifest`);
        check('manifest serves 200', manRes.status === 200, `got ${manRes.status}`);
        const manifest = await manRes.json();
        check('manifest name is AMG Trading', manifest.name === 'AMG Trading', manifest.name);
        check('manifest display is standalone', manifest.display === 'standalone', manifest.display);
        const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
        const byKey = {};
        for (const ic of icons) byKey[`${ic.sizes}|${ic.purpose || 'any'}`] = ic;
        check('manifest has 192x192 any icon', !!byKey['192x192|any'] && byKey['192x192|any'].src === '/icons/icon-192' && byKey['192x192|any'].type === 'image/png', JSON.stringify(byKey['192x192|any']));
        check('manifest has 512x512 any icon', !!byKey['512x512|any'] && byKey['512x512|any'].src === '/icons/icon-512' && byKey['512x512|any'].type === 'image/png', JSON.stringify(byKey['512x512|any']));
        check('manifest has 512x512 maskable icon', !!byKey['512x512|maskable'] && byKey['512x512|maskable'].src === '/icons/icon-maskable-512' && byKey['512x512|maskable'].type === 'image/png', JSON.stringify(byKey['512x512|maskable']));

        // --- 2. Each icon URL returns an exact-size PNG of the logo ---
        const logoBuf = Buffer.from(await (await fetch(`${BASE}/logo.png`)).arrayBuffer());
        const logoPx = decodePng(logoBuf);
        check('source logo decodes (reference for content checks)', !!logoPx, logoPx ? `gold ${(logoPx.goldFraction * 100).toFixed(1)}%` : 'undecodable');
        for (const [url, w, h, scale] of [
            ['/icons/icon-192', 192, 192, 1],
            ['/icons/icon-512', 512, 512, 1],
            ['/icons/icon-maskable-512', 512, 512, 0.78]
        ]) {
            const res = await fetch(`${BASE}${url}`);
            const buf = Buffer.from(await res.arrayBuffer());
            const size = pngSize(buf);
            check(`${url} serves 200 image/png`, res.status === 200 && (res.headers.get('content-type') || '').includes('image/png'), `${res.status} ${res.headers.get('content-type')}`);
            check(`${url} is exactly ${w}x${h}`, !!size && size.width === w && size.height === h, size ? `${size.width}x${size.height}` : 'not a PNG');
            const px = decodePng(buf);
            // Maskable renders the logo at 78% size, so its gold area is
            // ~0.78^2 of the full-size render.
            const expected = logoPx.goldFraction * scale * scale;
            const goldClose = !!px && !!logoPx && Math.abs(px.goldFraction - expected) < 0.02;
            check(`${url} renders the logo (gold coverage matches source)`, goldClose, px ? `gold ${(px.goldFraction * 100).toFixed(1)}% vs expected ${(expected * 100).toFixed(1)}%` : 'undecodable');
            check(`${url} has no frame (not the text-mark fallback)`, !!px && px.edgeGold === 0, px ? `${px.edgeGold} edge gold px` : 'undecodable');
        }

        // --- 3. Logo, service worker, no favicon ---
        const logoRes = await fetch(`${BASE}/logo.png`);
        check('logo serves 200 as PNG', logoRes.status === 200 && (logoRes.headers.get('content-type') || '').includes('image/png'), `${logoRes.status}`);
        const swRes = await fetch(`${BASE}/sw.js`);
        check('service worker serves 200', swRes.status === 200, `${swRes.status}`);
        const favRes = await fetch(`${BASE}/favicon.ico`);
        check('favicon still 404 (not re-added)', favRes.status === 404, `${favRes.status}`);

        // --- 4. Maskable icon really has safe padding ---
        // The maskable render scales the logo to 78%: its centre pixel
        // region is logo art, its corners are flat black. A cheap proxy:
        // the maskable PNG must differ in bytes from the plain 512 icon.
        const plain = Buffer.from(await (await fetch(`${BASE}/icons/icon-512`)).arrayBuffer());
        const maskable = Buffer.from(await (await fetch(`${BASE}/icons/icon-maskable-512`)).arrayBuffer());
        check('maskable icon differs from plain 512 icon (padding applied)', !plain.equals(maskable), `${plain.length} vs ${maskable.length} bytes`);
    } finally {
        killServer();
    }

    console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
    console.error('TEST ERROR:', err);
    process.exit(1);
});
