// Backtest harness for on-chain ROUND 5: standard entry + core ATR levels,
// basket-wide (pre-registered in ONCHAIN-ROUND5-REPORT.md — read it first).
//
//   TESTED: evaluateSignalCore() verbatim (DEFAULT_RULES) on BTC as the
//   entry, with the CORE'S OWN ATR LEVELS applied basket-wide — verbatim
//   core output for the BTC leg, and the verbatim core level formula
//   (engineCore.ts: slMultiplier = 1.5 - 0.3*conf, tpMultiplier =
//   3.5 + 2.5*conf, ATR(14), Bollinger stop adjustment, TP1/2/3 at
//   25%/65%/85% of TP distance, 0.5%-of-entry minimum distance) applied
//   to each alt's own ATR/Bollinger at the event hour, for the BTC
//   direction, with the production alt confidence (BTC confidence + 2,
//   cap 95). Basket = BTC + top-10 correlated coins, MATIC slot =
//   POLUSDT (see the report for why). 48h (R5) and 96h (R5-96) expiry.
//   One basket event at a time; the next BTC evaluation starts at the
//   BTC leg's resolution hour + 1 (identical cadence to D0).
//
//   The whale veto CANNOT be evaluated in the backtest (no historical
//   whale data). It is a documented no-op here; the backtest validates
//   entry + levels ONLY, never the veto. No whale input is simulated.
//
//   Honest outcome rules, same as rounds 1-4:
//     WIN     = final TP (core takeProfit) reached before the stop loss
//     LOSS    = stop loss reached first
//     AMBIG   = final TP and SL inside the same candle (excluded)
//     EXPIRED = neither within expiry (excluded from win rate/expectancy)
//   Win R per leg = the core's own RR for that leg (TP distance / SL
//   distance); a LOSS is -1R.
//
//   FIDELITY CHECKS (abort if either fails):
//     (1) The alt-level formula, applied to the BTC leg with the exact
//         inputs the core used, must reproduce core.stopLoss /
//         core.takeProfit (relative error < 1e-9).
//     (2) The BTC-leg subtotal must reproduce D0 exactly (12 fired,
//         6W/1L, +0.480R) — same entry, same levels, same cadence.
//
//   Gate (pre-registered, pooled basket outcomes — ALL must hold):
//     expectancy > +0.15R AND resolved >= 7 AND win rate >= 50% AND
//     max single-trade R / |sumR| <= 0.5.
//
// Data: JSON files in BT_DATA_DIR (default /tmp/amg-backtest-data);
// run with BT_DATA_DIR=$HOME/workspace/.amg-bt/data (canonical set
// plus APTUSDT/LTCUSDT/POLUSDT fetched 2026-11-25 from
// data-api.binance.vision, same window, openTime-aligned with BTC).
//
// Run:
//   npx tsc -p scripts/tsconfig.backtest-onchain-round5.json
//   BT_DATA_DIR=$HOME/workspace/.amg-bt/data node /tmp/amg-bt-build/scripts/backtest-onchain-round5.js

import * as fs from 'fs';
import * as path from 'path';
import {
    evaluateSignalCore,
    DEFAULT_RULES,
    calculateATR
} from '../src/lib/signals/engineCore';
import { TechnicalIndicators } from '../src/lib/signals/indicators';
import {
    MarketData,
    MarketType,
    SignalType,
    SignalDirection
} from '../src/lib/signals/types';

// Reproducibility: AdvancedMarketAnalyzer derives 30% of its composite
// trend score from Math.random() components. Pinned to neutral 0.5 here,
// same as scripts/backtest.ts; the gate's logic itself is exercised
// unchanged.
Math.random = () => 0.5;
const log = console.log;
console.log = () => { /* silence engine logging during the sweep */ };

const DATA_DIR = process.env.BT_DATA_DIR || '/tmp/amg-backtest-data';
const WINDOW = 100;          // engine input window (1H candles)
const EVAL_START = 800;      // first evaluated hour index (4H EMA200 ready)

// Basket: BTC + top-10 correlated coins (CorrelationMatrix,
// getCorrelatedCoins(0.74).slice(0, 10), read from the code).
// MATIC slot = POLUSDT (see ONCHAIN-ROUND5-REPORT.md).
const BASKET: { symbol: string; file: string }[] = [
    { symbol: 'BTC', file: 'BTCUSDT.json' },
    { symbol: 'ETH', file: 'ETHUSDT.json' },
    { symbol: 'SOL', file: 'SOLUSDT.json' },
    { symbol: 'AVAX', file: 'AVAXUSDT.json' },
    { symbol: 'POL', file: 'POLUSDT.json' },   // MATIC slot
    { symbol: 'BNB', file: 'BNBUSDT.json' },
    { symbol: 'LTC', file: 'LTCUSDT.json' },
    { symbol: 'DOT', file: 'DOTUSDT.json' },
    { symbol: 'LINK', file: 'LINKUSDT.json' },
    { symbol: 'APT', file: 'APTUSDT.json' },
    { symbol: 'UNI', file: 'UNIUSDT.json' },
];

interface CandleSeries {
    openTime: number[];
    high: number[];
    low: number[];
    close: number[];
    volume: number[];
}

interface LegLevels {
    entry: number;
    stopLoss: number;
    takeProfit: number;   // final TP
    takeProfit1: number;  // milestone
}

interface LegOutcome {
    pair: string;
    outcome: 'WIN' | 'LOSS' | 'AMBIG' | 'EXPIRED';
    r: number;            // winR on WIN, -1 on LOSS, 0 otherwise
    tp1Hit: boolean;
}

interface VariantResult {
    variant: string;
    events: number;
    legs: number;
    skippedLegs: number;
    wins: number;
    losses: number;
    ambiguous: number;
    expired: number;
    winRate: number;
    expectancyR: number;
    sumR: number;
    maxShare: number;
    tp1Hit: number;
    perPair: Record<string, { fired: number; w: number; l: number; exp: number; sumR: number }>;
    perEventR: number[];  // basket-total R per BTC event (resolved legs only)
}

function loadSeries(file: string): CandleSeries {
    return JSON.parse(
        fs.readFileSync(path.join(DATA_DIR, file), 'utf8')
    ) as CandleSeries;
}

/** 4H closes visible at 1H index i — copied from scripts/backtest.ts. */
function closes4hAt(close: number[], i: number): number[] {
    const out: number[] = [];
    const fullBlocks = Math.floor((i + 1) / 4);
    for (let b = 0; b < fullBlocks; b++) out.push(close[4 * b + 3]);
    if ((i + 1) % 4 !== 0) out.push(close[i]);
    return out;
}

/**
 * The core's ATR level formula, VERBATIM from engineCore.ts
 * (slMultiplier = 1.5 - 0.3*conf, tpMultiplier = 3.5 + 2.5*conf,
 * Bollinger stop adjustment, TP1/2/3 at 25%/65%/85%, 0.5% minimum
 * distance). Returns null if any level is invalid (the core returns
 * null in that case too).
 */
function coreLevelsFormula(
    entry: number,
    isLong: boolean,
    atr: number,
    confidence: number,
    bollinger: { upper: number; middle: number; lower: number }
): LegLevels | null {
    const confidenceMultiplier = confidence / 100;
    const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
    const tpMultiplier = 3.5 + (confidenceMultiplier * 2.5);

    let stopLoss: number;
    let takeProfit: number;
    if (isLong) {
        stopLoss = entry - (atr * slMultiplier);
        takeProfit = entry + (atr * tpMultiplier);
        if (stopLoss > bollinger.lower) {
            stopLoss = bollinger.lower * 0.995;
        }
    } else {
        stopLoss = entry + (atr * slMultiplier);
        takeProfit = entry - (atr * tpMultiplier);
        if (stopLoss < bollinger.upper) {
            stopLoss = bollinger.upper * 1.005;
        }
    }

    let takeProfit1: number;
    if (isLong) {
        let tpDistance = takeProfit - entry;
        const minDistance = entry * 0.005;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entry + tpDistance;
        }
        takeProfit1 = entry + (tpDistance * 0.25);
    } else {
        let tpDistance = entry - takeProfit;
        const minDistance = entry * 0.005;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entry - tpDistance;
        }
        takeProfit1 = entry - (tpDistance * 0.25);
    }

    const pricesToValidate = [entry, stopLoss, takeProfit, takeProfit1];
    if (pricesToValidate.some(p => !p || isNaN(p) || !isFinite(p) || p <= 0)) {
        return null;
    }
    return { entry, stopLoss, takeProfit, takeProfit1 };
}

function resolveLeg(
    s: CandleSeries,
    i: number,
    expiryH: number,
    isLong: boolean,
    lv: LegLevels
): LegOutcome {
    const winR = isLong
        ? (lv.takeProfit - lv.entry) / (lv.entry - lv.stopLoss)
        : (lv.entry - lv.takeProfit) / (lv.stopLoss - lv.entry);
    let hitTp1 = false;
    for (let j = i + 1; j <= i + expiryH; j++) {
        const hitWIN = isLong ? s.high[j] >= lv.takeProfit : s.low[j] <= lv.takeProfit;
        const hitSL = isLong ? s.low[j] <= lv.stopLoss : s.high[j] >= lv.stopLoss;
        if (!hitTp1 && (isLong ? s.high[j] >= lv.takeProfit1 : s.low[j] <= lv.takeProfit1)) hitTp1 = true;
        if (hitWIN && hitSL) return { pair: '', outcome: 'AMBIG', r: 0, tp1Hit: hitTp1 };
        if (hitWIN) return { pair: '', outcome: 'WIN', r: winR, tp1Hit: hitTp1 };
        if (hitSL) return { pair: '', outcome: 'LOSS', r: -1, tp1Hit: hitTp1 };
    }
    return { pair: '', outcome: 'EXPIRED', r: 0, tp1Hit: hitTp1 };
}

function runVariant(
    variantId: string,
    expiryH: number,
    series: Record<string, CandleSeries>,
    btcTrendAt: ('UP' | 'DOWN' | 'NEUTRAL')[]
): VariantResult {
    const btc = series['BTC'];
    const n = btc.close.length;
    const evalEnd = n - expiryH - 1;

    let events = 0, skippedLegs = 0;
    let wins = 0, losses = 0, ambiguous = 0, expired = 0;
    let sumR = 0, tp1Hit = 0;
    let maxAbsR = 0;
    const perPair: Record<string, { fired: number; w: number; l: number; exp: number; sumR: number }> = {};
    for (const p of BASKET) perPair[p.symbol] = { fired: 0, w: 0, l: 0, exp: 0, sumR: 0 };
    const perEventR: number[] = [];

    // BTC-leg subtotal (fidelity check 2: must reproduce D0 exactly).
    let btcFired = 0, btcW = 0, btcL = 0, btcExp = 0, btcSumR = 0, btcTp1 = 0;

    let i = EVAL_START;
    while (i <= evalEnd) {
        const md: MarketData = {
            pair: 'BTC/USDT',
            marketType: MarketType.CRYPTO,
            prices: btc.close.slice(i - WINDOW + 1, i + 1),
            highs: btc.high.slice(i - WINDOW + 1, i + 1),
            lows: btc.low.slice(i - WINDOW + 1, i + 1),
            volumes: btc.volume.slice(i - WINDOW + 1, i + 1),
            timestamps: [],
            currentPrice: btc.close[i],
            closes4h: closes4hAt(btc.close, i),
            btcTrend: btcTrendAt[i],
            fundingRate: undefined
        };

        const core = evaluateSignalCore(md, SignalType.FUTURE, DEFAULT_RULES);
        if (!core) { i++; continue; }

        const isLong = core.direction === SignalDirection.LONG || core.direction === SignalDirection.BUY;
        const entry = core.entryPrice;
        events++;

        // --- FIDELITY CHECK 1: the verbatim formula must reproduce
        // the core's own BTC levels exactly (same inputs).
        const btcAtr = calculateATR(md.prices, md.highs, md.lows);
        const btcBb = TechnicalIndicators.calculateBollingerBands(md.prices);
        const formulaBtc = coreLevelsFormula(entry, isLong, btcAtr, core.confidence, btcBb);
        if (!formulaBtc) {
            throw new Error(`FIDELITY CHECK 1 FAILED at hour ${i}: formula returned null for the BTC leg`);
        }
        const relErr = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
        if (relErr(formulaBtc.stopLoss, core.stopLoss) > 1e-9 || relErr(formulaBtc.takeProfit, core.takeProfit) > 1e-9) {
            throw new Error(
                `FIDELITY CHECK 1 FAILED at hour ${i}: formula SL ${formulaBtc.stopLoss} vs core ${core.stopLoss}; ` +
                `formula TP ${formulaBtc.takeProfit} vs core ${core.takeProfit}. STOP — the ship test does not run.`
            );
        }

        // --- Resolve the BTC leg (verbatim core levels) and every alt leg.
        let eventR = 0;
        let btcResHour = i + expiryH;
        for (const p of BASKET) {
            const s = series[p.symbol];
            let lv: LegLevels | null;
            if (p.symbol === 'BTC') {
                lv = { entry, stopLoss: core.stopLoss, takeProfit: core.takeProfit, takeProfit1: core.takeProfit1 };
            } else {
                const altPrices = s.close.slice(i - WINDOW + 1, i + 1);
                const altHighs = s.high.slice(i - WINDOW + 1, i + 1);
                const altLows = s.low.slice(i - WINDOW + 1, i + 1);
                const altAtr = calculateATR(altPrices, altHighs, altLows);
                const altBb = TechnicalIndicators.calculateBollingerBands(altPrices);
                const altConfidence = Math.min(core.confidence + 2, 95);
                lv = coreLevelsFormula(s.close[i], isLong, altAtr, altConfidence, altBb);
            }
            if (!lv) { skippedLegs++; continue; }

            const out = resolveLeg(s, i, expiryH, isLong, lv);
            out.pair = p.symbol;
            perPair[p.symbol].fired++;
            if (out.tp1Hit) { tp1Hit++; if (p.symbol === 'BTC') btcTp1++; }
            if (out.outcome === 'WIN') {
                wins++; sumR += out.r; eventR += out.r;
                perPair[p.symbol].w++; perPair[p.symbol].sumR += out.r;
                if (Math.abs(out.r) > maxAbsR) maxAbsR = Math.abs(out.r);
                if (p.symbol === 'BTC') { btcW++; btcSumR += out.r; }
            } else if (out.outcome === 'LOSS') {
                losses++; sumR -= 1; eventR -= 1;
                perPair[p.symbol].l++; perPair[p.symbol].sumR -= 1;
                if (1 > maxAbsR) maxAbsR = 1;
                if (p.symbol === 'BTC') { btcL++; btcSumR -= 1; }
            } else if (out.outcome === 'AMBIG') {
                ambiguous++;
            } else {
                expired++;
                perPair[p.symbol].exp++;
                if (p.symbol === 'BTC') btcExp++;
            }
            if (p.symbol === 'BTC') {
                btcFired++;
                // BTC leg resolution hour drives the cadence (same as D0).
                if (out.outcome !== 'EXPIRED') {
                    // Re-walk to find the resolution hour.
                    for (let j = i + 1; j <= i + expiryH; j++) {
                        const hitWIN = isLong ? s.high[j] >= lv.takeProfit : s.low[j] <= lv.takeProfit;
                        const hitSL = isLong ? s.low[j] <= lv.stopLoss : s.high[j] >= lv.stopLoss;
                        if (hitWIN || hitSL) { btcResHour = j; break; }
                    }
                }
            }
        }
        perEventR.push(eventR);

        i = btcResHour + 1; // one basket event at a time
    }

    // --- FIDELITY CHECK 2: BTC-leg subtotal must reproduce D0 exactly.
    // Applies ONLY to the 48h variant: the 96h variant has a different
    // resolution cadence by design (longer holding changes the advance),
    // so its BTC leg legitimately differs from D0.
    if (expiryH === 48) {
    const btcResolved = btcW + btcL;
    const btcExp2 = btcResolved > 0 ? btcSumR / btcResolved : 0;
    if (!(btcFired === 12 && btcW === 6 && btcL === 1 && btcExp === 5 && Math.abs(btcExp2 - 0.480) < 0.001)) {
        throw new Error(
            `FIDELITY CHECK 2 FAILED: BTC leg fired ${btcFired} (want 12), W ${btcW} (want 6), L ${btcL} (want 1), ` +
            `expired ${btcExp} (want 5), expectancy ${btcExp2.toFixed(3)}R (want +0.480R). STOP — the ship test does not run.`
        );
    }
    }

    const resolved = wins + losses;
    const expectancyR = resolved > 0 ? sumR / resolved : 0;
    const maxShare = Math.abs(sumR) > 0 ? maxAbsR / Math.abs(sumR) : 0;
    return {
        variant: variantId,
        events,
        legs: wins + losses + ambiguous + expired,
        skippedLegs,
        wins, losses, ambiguous, expired,
        winRate: resolved > 0 ? (wins / resolved) * 100 : 0,
        expectancyR,
        sumR,
        maxShare,
        tp1Hit,
        perPair,
        perEventR
    };
}

function printResult(r: VariantResult): void {
    log(`\n=== ${r.variant} ===`);
    log(`basket events ${r.events} | legs ${r.legs} (skipped ${r.skippedLegs}) | W ${r.wins} / L ${r.losses} / ambig ${r.ambiguous} / expired ${r.expired}`);
    log(`win rate ${r.winRate.toFixed(1)}% | expectancy ${r.expectancyR >= 0 ? '+' : ''}${r.expectancyR.toFixed(3)}R | sumR ${r.sumR >= 0 ? '+' : ''}${r.sumR.toFixed(2)}R | max single-trade share ${(r.maxShare * 100).toFixed(1)}% | TP1 touched on ${r.tp1Hit} of ${r.legs} legs`);
    log(`per-pair (fired W/L/exp sumR):`);
    for (const p of BASKET) {
        const pp = r.perPair[p.symbol];
        log(`  ${p.symbol.padEnd(4)} ${pp.fired}  ${pp.w}/${pp.l}/${pp.exp}  ${pp.sumR >= 0 ? '+' : ''}${pp.sumR.toFixed(2)}R`);
    }
    const netPos = r.perEventR.filter(x => x > 0).length;
    const netNeg = r.perEventR.filter(x => x < 0).length;
    const netFlat = r.perEventR.filter(x => x === 0).length;
    log(`per-event basket R: ${netPos} net-positive / ${netNeg} net-negative / ${netFlat} flat (expired) of ${r.perEventR.length} events`);
    log(`  event R values: [${r.perEventR.map(x => (x >= 0 ? '+' : '') + x.toFixed(2)).join(', ')}]`);
}

function main(): void {
    const series: Record<string, CandleSeries> = {};
    for (const p of BASKET) {
        series[p.symbol] = loadSeries(p.file);
        // All series must be time-aligned with BTC (verified at fetch).
        if (series[p.symbol].openTime.length !== series['BTC'].openTime.length) {
            throw new Error(`${p.symbol}: length ${series[p.symbol].openTime.length} != BTC ${series['BTC'].openTime.length}`);
        }
        for (let k = 0; k < series['BTC'].openTime.length; k++) {
            if (series[p.symbol].openTime[k] !== series['BTC'].openTime[k]) {
                throw new Error(`${p.symbol}: openTime misaligned at index ${k}`);
            }
        }
    }
    const btc = series['BTC'];

    const btcTrendAt: ('UP' | 'DOWN' | 'NEUTRAL')[] = new Array(btc.close.length).fill('NEUTRAL');
    for (let i = 0; i < btc.close.length; i++) {
        const c4 = closes4hAt(btc.close, i);
        if (c4.length >= 200) {
            const ema200 = TechnicalIndicators.calculateEMA(c4, 200);
            btcTrendAt[i] = btc.close[i] > ema200 ? 'UP' : 'DOWN';
        }
    }

    const evalStartISO = new Date(btc.openTime[EVAL_START]).toISOString();
    const evalEndISO = new Date(btc.openTime[btc.close.length - 48 - 1]).toISOString();
    log(`Basket BTC+10 alts (POL = MATIC slot) | eval window ${evalStartISO} -> ${evalEndISO} (48h variants; 96h variants end 48h earlier) | standard core (DEFAULT_RULES) + core ATR levels, basket-wide`);
    log(`Regime mix in eval window: UP ${btcTrendAt.slice(EVAL_START).filter(t => t === 'UP').length}h / DOWN ${btcTrendAt.slice(EVAL_START).filter(t => t === 'DOWN').length}h / NEUTRAL ${btcTrendAt.slice(EVAL_START).filter(t => t === 'NEUTRAL').length}h`);

    // Pre-registered variants (ONCHAIN-ROUND5-REPORT.md, written before
    // running). Gate (pooled basket outcomes, ALL must hold):
    // expectancy > +0.15R AND resolved >= 7 AND win rate >= 50% AND
    // max single-trade R / |sumR| <= 0.5.
    const VARIANTS = [
        { id: 'R5: standard entry + core ATR levels, basket, 48h', expiryH: 48 },
        { id: 'R5-96: R5 with 96h expiry', expiryH: 96 },
    ];

    const results = VARIANTS.map(v => runVariant(v.id, v.expiryH, series, btcTrendAt));
    for (const r of results) printResult(r);

    log(`\n--- GATE (expectancy > +0.15R, resolved >= 7, win rate >= 50%, max single-trade share <= 50%; pooled basket) ---`);
    const passers = results.filter(r =>
        r.expectancyR > 0.15 && (r.wins + r.losses) >= 7 && r.winRate >= 50 && r.maxShare <= 0.5
    );
    if (passers.length === 0) {
        log('NO VARIANT PASSED. No-ship.');
        for (const r of results) {
            const fails: string[] = [];
            if (!(r.expectancyR > 0.15)) fails.push(`expectancy ${r.expectancyR >= 0 ? '+' : ''}${r.expectancyR.toFixed(3)}R <= +0.15R`);
            if (!((r.wins + r.losses) >= 7)) fails.push(`resolved ${r.wins + r.losses} < 7`);
            if (!(r.winRate >= 50)) fails.push(`win rate ${r.winRate.toFixed(1)}% < 50%`);
            if (!(r.maxShare <= 0.5)) fails.push(`max single-trade share ${(r.maxShare * 100).toFixed(1)}% > 50%`);
            log(`  ${r.variant}: FAILED — ${fails.join('; ')}`);
        }
    } else {
        for (const p of passers) {
            log(`PASS: ${p.variant} | expectancy +${p.expectancyR.toFixed(3)}R | resolved ${p.wins + p.losses} | win rate ${p.winRate.toFixed(1)}% | max share ${(p.maxShare * 100).toFixed(1)}%`);
        }
        const best = passers.reduce((a, b) => (b.expectancyR > a.expectancyR ? b : a));
        log(`\n--- SHIP CANDIDATE ---`);
        log(`Best passer: ${best.variant}`);
    }
}

main();
