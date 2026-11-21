// Backtest harness for the signal-quality gate.
//
// Runs the PRODUCTION decision core (src/lib/signals/engineCore.ts - the
// exact code SignalGenerator delegates to) over historical Binance spot
// 1H candles for the site's scan universe, once per rule variant, and
// scores every fired signal with the honest outcome rules:
//   WIN     = full take profit reached before the stop loss
//   LOSS    = stop loss reached first
//   AMBIG   = TP and SL inside the same candle (excluded)
//   EXPIRED = neither within the 48h futures expiry (excluded from
//             win rate and expectancy)
// One open signal per pair at a time; evaluation at every hourly close.
//
// Data: JSON files in BT_DATA_DIR (default /tmp/amg-backtest-data),
// one <SYMBOL>.json per pair with openTime/high/low/close/volume arrays,
// downloaded from data-api.binance.vision.
//
// Run:
//   npx tsc -p scripts/tsconfig.backtest.json
//   node /tmp/amg-bt-build/scripts/backtest.js
//
// Reproducibility note: AdvancedMarketAnalyzer (used by the engine's
// counter-trend gate) derives 30% of its composite trend score from
// Math.random() components (macro / on-chain / derivatives "scores").
// In production those are literally coin flips. They are pinned to the
// neutral 0.5 here so runs are reproducible; the gate's logic itself is
// exercised unchanged.
//
// Gate history: the original sweep (branch commit 7fb1131, harness with
// all five candidate rules) also measured structureStops (-0.654R) and
// rsiRoom (-0.086R vs base -0.004R). Both HURT and were removed from the
// engine; the variants below are the surviving rule set. Full numbers in
// IMPROVE-REPORT.md.

import * as fs from 'fs';
import * as path from 'path';
import {
    evaluateSignalCore,
    EngineRuleSwitches,
    ALL_RULES_OFF,
    ALL_RULES_ON
} from '../src/lib/signals/engineCore';
import { TechnicalIndicators } from '../src/lib/signals/indicators';
import {
    MarketData,
    MarketType,
    SignalType,
    SignalDirection
} from '../src/lib/signals/types';

Math.random = () => 0.5;
const log = console.log;
console.log = () => { /* silence engine logging during the sweep */ };

const DATA_DIR = process.env.BT_DATA_DIR || '/tmp/amg-backtest-data';
const WINDOW = 100;          // engine input window (1H candles)
const EVAL_START = 800;      // first evaluated hour index (4H EMA200 ready)
const EXPIRY_H = 48;         // futures expiry

interface CandleSeries {
    openTime: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

interface VariantResult {
    variant: string;
    fired: number;
    longs: number;
    shorts: number;
    wins: number;
    losses: number;
    ambiguous: number;
    expired: number;
    winRate: number;      // wins / (wins + losses), %
    expectancyR: number;  // mean R over resolved (win = +RR, loss = -1)
    avgRR: number;
}

function loadSeries(): Map<string, CandleSeries> {
    const map = new Map<string, CandleSeries>();
    for (const file of fs.readdirSync(DATA_DIR)) {
        if (!file.endsWith('.json')) continue;
        const symbol = file.replace('.json', '');
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')) as CandleSeries;
        map.set(symbol, raw);
    }
    return map;
}

/** 4H closes visible at 1H index i: completed 4H candles plus the
 *  in-progress 4H candle (close = latest 1H close), mirroring what the
 *  live Binance 4H feed shows. */
function closes4hAt(close: number[], i: number): number[] {
    const out: number[] = [];
    const fullBlocks = Math.floor((i + 1) / 4);
    for (let b = 0; b < fullBlocks; b++) out.push(close[4 * b + 3]);
    if ((i + 1) % 4 !== 0) out.push(close[i]);
    return out;
}

function runVariant(
    name: string,
    rules: EngineRuleSwitches,
    universe: Map<string, CandleSeries>,
    btcTrendAt: ('UP' | 'DOWN' | 'NEUTRAL')[]
): VariantResult {
    let fired = 0, longs = 0, shorts = 0;
    let wins = 0, losses = 0, ambiguous = 0, expired = 0;
    let sumR = 0, sumRR = 0;

    for (const [symbol, s] of universe) {
        const pair = symbol.replace('USDT', '/USDT');
        const n = s.close.length;
        const evalEnd = n - EXPIRY_H - 1;
        let i = EVAL_START;
        while (i <= evalEnd) {
            const md: MarketData = {
                pair,
                marketType: MarketType.CRYPTO,
                prices: s.close.slice(i - WINDOW + 1, i + 1),
                highs: s.high.slice(i - WINDOW + 1, i + 1),
                lows: s.low.slice(i - WINDOW + 1, i + 1),
                volumes: s.volume.slice(i - WINDOW + 1, i + 1),
                timestamps: [],
                currentPrice: s.close[i],
                closes4h: rules.mtfConfirm ? closes4hAt(s.close, i) : undefined,
                btcTrend: rules.btcRegime ? btcTrendAt[i] : undefined,
                fundingRate: undefined // no historical funding data exists
            };

            const core = evaluateSignalCore(md, SignalType.FUTURE, rules);
            if (!core) { i++; continue; }

            fired++;
            const isLong = core.direction === SignalDirection.LONG || core.direction === SignalDirection.BUY;
            if (isLong) longs++; else shorts++;

            const rr = isLong
                ? (core.takeProfit - core.entryPrice) / (core.entryPrice - core.stopLoss)
                : (core.entryPrice - core.takeProfit) / (core.stopLoss - core.entryPrice);
            sumRR += rr;

            let outcome: 'WIN' | 'LOSS' | 'AMBIG' | 'EXPIRED' = 'EXPIRED';
            let resHour = i + EXPIRY_H;
            for (let j = i + 1; j <= i + EXPIRY_H; j++) {
                const hitTP = isLong ? s.high[j] >= core.takeProfit : s.low[j] <= core.takeProfit;
                const hitSL = isLong ? s.low[j] <= core.stopLoss : s.high[j] >= core.stopLoss;
                if (hitTP && hitSL) { outcome = 'AMBIG'; resHour = j; break; }
                if (hitTP) { outcome = 'WIN'; resHour = j; break; }
                if (hitSL) { outcome = 'LOSS'; resHour = j; break; }
            }

            if (outcome === 'WIN') { wins++; sumR += rr; }
            else if (outcome === 'LOSS') { losses++; sumR -= 1; }
            else if (outcome === 'AMBIG') ambiguous++;
            else expired++;

            i = resHour + 1; // one open signal per pair at a time
        }
    }

    const resolved = wins + losses;
    return {
        variant: name,
        fired, longs, shorts, wins, losses, ambiguous, expired,
        winRate: resolved > 0 ? (wins / resolved) * 100 : 0,
        expectancyR: resolved > 0 ? sumR / resolved : 0,
        avgRR: fired > 0 ? sumRR / fired : 0
    };
}

function main(): void {
    const universe = loadSeries();
    const btc = universe.get('BTCUSDT');
    if (!btc) throw new Error('BTCUSDT series missing');

    // Sanity: every series must share BTC's hourly grid.
    for (const [symbol, s] of universe) {
        if (s.openTime.length !== btc.openTime.length ||
            s.openTime[0] !== btc.openTime[0] ||
            s.openTime[s.openTime.length - 1] !== btc.openTime[btc.openTime.length - 1]) {
            throw new Error(`Grid mismatch: ${symbol}`);
        }
    }

    // Precompute the BTC regime (price vs 4H EMA200) for every hour.
    const btcTrendAt: ('UP' | 'DOWN' | 'NEUTRAL')[] = new Array(btc.close.length).fill('NEUTRAL');
    for (let i = 0; i < btc.close.length; i++) {
        const c4 = closes4hAt(btc.close, i);
        if (c4.length >= 200) {
            const ema200 = TechnicalIndicators.calculateEMA(c4, 200);
            btcTrendAt[i] = btc.close[i] > ema200 ? 'UP' : 'DOWN';
        }
    }

    const only = (patch: Partial<EngineRuleSwitches>): EngineRuleSwitches => ({ ...ALL_RULES_OFF, ...patch });

    const variants: Array<[string, EngineRuleSwitches]> = [
        ['base (post-honesty-fix engine)', ALL_RULES_OFF],
        ['+ mtfConfirm', only({ mtfConfirm: true })],
        ['+ btcRegime', only({ btcRegime: true })],
        ['+ fundingFilter (no hist. data)', only({ fundingFilter: true })],
        ['FINAL production set (ALL on)', ALL_RULES_ON]
    ];

    const evalStartISO = new Date(btc.openTime[EVAL_START]).toISOString();
    const evalEndISO = new Date(btc.openTime[btc.openTime.length - EXPIRY_H - 1]).toISOString();
    log(`Universe: ${universe.size} pairs | eval window ${evalStartISO} -> ${evalEndISO} | FUTURE mode, ${EXPIRY_H}h expiry`);

    const results: VariantResult[] = [];
    for (const [name, rules] of variants) {
        const t0 = Date.now();
        const r = runVariant(name, rules, universe, btcTrendAt);
        results.push(r);
        log(`\n=== ${r.variant} === (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        log(`fired ${r.fired} (LONG ${r.longs} / SHORT ${r.shorts}) | W ${r.wins} / L ${r.losses} / ambig ${r.ambiguous} / expired ${r.expired}`);
        log(`win rate ${r.winRate.toFixed(1)}% | expectancy ${r.expectancyR >= 0 ? '+' : ''}${r.expectancyR.toFixed(3)}R | avg RR ${r.avgRR.toFixed(2)}`);
    }

    fs.writeFileSync('/tmp/amg-bt-results.json', JSON.stringify({
        evalStartISO, evalEndISO, pairs: universe.size, results
    }, null, 2));
    log('\nResults written to /tmp/amg-bt-results.json');
}

main();
