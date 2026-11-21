// ICT firing-sanity harness for the Scalping V2 port.
//
// The original amg-eight engine's core failure was that it NEVER fired
// on real data (0 signals in ~1,556 reconstructed scans) because its
// grade gate was arithmetically out of reach. This harness runs the
// PORTED production engine (src/lib/signals/ictEngine.ts - the exact
// code the /api/scalping-v2/signals route calls) over the last 48h of
// real Binance 5m/1m candles for a subset of liquid pairs and counts
// how many signals fire.
//
// Method (mirrors the original audit's harness):
//  - Closed candles only; evaluation every 5 minutes.
//  - At each step the engine gets the trailing 100 x 5m (HTF) and
//    100 x 1m (LTF) candles ending at that step.
//  - dailyOpen approximated by the open of the 5m candle 24h earlier
//    (production uses the 24h ticker openPrice).
//  - One open signal per pair: after a pair fires, it is suppressed
//    for 60 minutes (and not re-evaluated during suppression).
//  - Caveat: the engine's session score uses wall-clock time, so all
//    historical steps are scored with the session at run time (<= 5
//    points). The original audit harness had the identical property.
//
// Data: fetched live from data-api.binance.vision at run time.
//
// Run:
//   npx tsc -p scripts/tsconfig.ict.json
//   node /tmp/amg-ict-build/scripts/ict-sanity.js

import { ICTEngine, ICTCandle, ICTFunnelStage } from '../src/lib/signals/ictEngine';

const BASE = 'https://data-api.binance.vision/api/v3';
const PAIRS = [
    'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT',
    'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'NEAR/USDT', 'SUI/USDT', 'ARB/USDT'
];
const HOURS = 48;
const STEP_MS = 5 * 60 * 1000;
const SUPPRESS_MS = 60 * 60 * 1000;

async function fetchKlines(symbol: string, interval: string, limit: number, endTime?: number): Promise<ICTCandle[]> {
    const url = `${BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}` + (endTime ? `&endTime=${endTime}` : '');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`klines ${symbol} ${interval}: HTTP ${res.status}`);
    const raw = (await res.json()) as unknown[][];
    return raw.map(k => ({
        timestamp: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5]))
    }));
}

async function fetchHistory(symbol: string, interval: string, intervalMs: number, totalNeeded: number): Promise<ICTCandle[]> {
    let all: ICTCandle[] = [];
    let endTime: number | undefined = undefined;
    while (all.length < totalNeeded) {
        const batch = await fetchKlines(symbol, interval, Math.min(1000, totalNeeded - all.length + 50), endTime);
        if (batch.length === 0) break;
        all = batch.concat(all);
        endTime = batch[0].timestamp - intervalMs;
        if (batch.length < 1000 && all.length >= totalNeeded) break;
    }
    // Dedupe + sort
    const seen = new Map<number, ICTCandle>();
    for (const c of all) seen.set(c.timestamp, c);
    return [...seen.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/** Index of the first candle that is NOT fully closed at time t. */
function closedCount(candles: ICTCandle[], intervalMs: number, t: number): number {
    let lo = 0, hi = candles.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (candles[mid].timestamp + intervalMs <= t) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

async function main() {
    const now = Date.now();
    const windowStart = now - HOURS * 60 * 60 * 1000;
    const firstStep = Math.floor(windowStart / STEP_MS) * STEP_MS;

    const funnel: Record<string, number> = {};
    const fires: { pair: string; time: string; type: string; score: number; grade: string }[] = [];
    let totalEvals = 0;
    const scoredValues: number[] = [];

    for (const pair of PAIRS) {
        const symbol = pair.replace('/', '');
        const htf = await fetchHistory(symbol, '5m', 300000, 700);
        const ltf = await fetchHistory(symbol, '1m', 60000, 3100);
        let suppressedUntil = 0;
        let pairFires = 0;

        for (let t = firstStep; t <= now; t += STEP_MS) {
            if (t < suppressedUntil) continue;
            const hEnd = closedCount(htf, 300000, t);
            const lEnd = closedCount(ltf, 60000, t);
            if (hEnd < 100 || lEnd < 100) continue;
            const h = htf.slice(hEnd - 100, hEnd);
            const l = ltf.slice(lEnd - 100, lEnd);

            // dailyOpen: open of the 5m candle that opened 24h before t
            const dayAgoIdx = closedCount(htf, 300000, t - 24 * 60 * 60 * 1000);
            const dailyOpen = dayAgoIdx > 0 ? htf[dayAgoIdx - 1].open : h[0].open;

            const { signal, diagnostic } = ICTEngine.evaluateICT(h, l, pair, dailyOpen);
            totalEvals++;
            const stage: ICTFunnelStage = diagnostic.stage;
            funnel[stage] = (funnel[stage] || 0) + 1;
            if (diagnostic.score !== undefined) scoredValues.push(diagnostic.score);

            if (signal) {
                pairFires++;
                fires.push({
                    pair,
                    time: new Date(t).toISOString(),
                    type: signal.type,
                    score: signal.score.total,
                    grade: signal.score.grade
                });
                suppressedUntil = t + SUPPRESS_MS;
            }
        }
        console.log(`${pair}: ${pairFires} fires`);
    }

    scoredValues.sort((a, b) => b - a);
    console.log('\n=== ICT SANITY SUMMARY ===');
    console.log(`pairs: ${PAIRS.length}, window: ${HOURS}h, evals: ${totalEvals}`);
    console.log(`total fires: ${fires.length} (${(fires.length / (HOURS / 24)).toFixed(1)}/day across ${PAIRS.length} pairs)`);
    console.log('funnel:', JSON.stringify(funnel));
    console.log('top scores seen:', scoredValues.slice(0, 10).join(', ') || 'none');
    for (const f of fires) {
        console.log(`FIRE ${f.time} ${f.pair} ${f.type} score=${f.score} grade=${f.grade}`);
    }
}

main().catch(err => {
    console.error('sanity harness failed:', err);
    process.exit(1);
});
