// Money Rotation - the real concept, computed from live Binance data.
//
// "Money rotation" = capital moving between pairs. It is measured here
// with two auditable quantities per pair, both derived from the pair's
// own 1h candles (data-api.binance.vision, server-side):
//
//  1. QUOTE-VOLUME SHARE: the pair's share of the scan universe's total
//     USDT quote volume over the last 24h, vs its share over the 24h
//     before that. A rising share means a growing slice of the market's
//     traded money is flowing into this pair.
//  2. RELATIVE STRENGTH vs BTC: the pair's price change minus BTC's
//     price change over 1h / 4h / 24h (percentage points). Positive =
//     outperforming the market benchmark.
//
// Rotation score (0-100, formula shown on the page - no black box):
//     rsComposite    = 0.5*RS24h + 0.3*RS4h + 0.2*RS1h        (pp)
//     shareMomentum  = (shareNow - sharePrev) / sharePrev * 100 (%)
//     rotationScore  = clamp(50 + 1.5*shareMomentum + 2.5*rsComposite, 0, 100)
//
// Classification:
//     ROTATING IN : shareMomentum >= +5% AND rsComposite > 0
//     ROTATING OUT: shareMomentum <= -5% AND rsComposite < 0
//     NEUTRAL     : everything else
//
// TRADE SIGNALS FROM THIS TABLE ARE DISABLED (2026-11-21). Signals
// derived from this rotation table were backtested on 90 days of
// market data and did not perform (resolved expectancy -0.92R per
// trade at the 5R target, -0.15R at the 1.5R target - see
// ROTATION-BACKTEST-REPORT.md), so the signal layer was removed.
// This module now computes the rotation table only: market
// information, not trading advice.
//
// There is NO fabricated data anywhere in this path: pairs whose candles
// cannot be fetched or fail the freshness gate are excluded and counted;
// if BTC (the benchmark) or most of the universe is unavailable, the
// caller gets an error and the page shows "live data unavailable".

import { BinanceAPI } from './binanceAPI';
import { SCALPING_V2_PAIRS } from './scalpingV2';

export type RotationClass = 'IN' | 'OUT' | 'NEUTRAL';

export interface RotationEvidence {
    classification: RotationClass;
    rotationScore: number;
    /** Quote-volume share of the universe, last 24h (%) */
    shareNow: number;
    /** Quote-volume share of the universe, prior 24h (%) */
    sharePrev: number;
    /** shareNow - sharePrev (percentage points) */
    shareChangePp: number;
    /** Relative change of the share (%) */
    shareMomentumPct: number;
    /** Relative strength vs BTC (percentage points) */
    rs1h: number;
    rs4h: number;
    rs24h: number;
    rsComposite: number;
    /** USDT quote volume, last 24h */
    quoteVolume24h: number;
}

export interface RotationRow extends RotationEvidence {
    pair: string;
    price: number;
    change1hPct: number;
    change4hPct: number;
    change24hPct: number;
}

export interface MoneyRotationResult {
    rows: RotationRow[];
    btc: { change1hPct: number; change4hPct: number; change24hPct: number };
    totals: {
        pairsRequested: number;
        pairsLoaded: number;
        pairsExcluded: number;
        totalQuoteVolume24h: number;
    };
    generatedAt: string;
}

const HOURLY_MS = 60 * 60 * 1000;
const KLINE_LIMIT = 49; // 48 full hours + in-progress hour

interface PairWindows {
    pair: string;
    price: number;
    closes: number[];
    highs: number[];
    lows: number[];
    change1h: number; // fractions
    change4h: number;
    change24h: number;
    quoteVolNow24: number;
    quoteVolPrev24: number;
}

function pctChange(closes: number[], back: number): number {
    const last = closes[closes.length - 1];
    const ref = closes[closes.length - 1 - back];
    return ref > 0 ? last / ref - 1 : 0;
}

async function loadPairWindows(pair: string): Promise<PairWindows> {
    const candles = await BinanceAPI.getCandles(pair, '1h', KLINE_LIMIT);
    if (candles.length < KLINE_LIMIT) {
        throw new Error(`Insufficient history for ${pair}: ${candles.length} candles`);
    }
    if (!BinanceAPI.isCandleSeriesFresh(candles, HOURLY_MS)) {
        throw new Error(`Stale candle series for ${pair}`);
    }
    const closes = candles.map(c => c.close);
    const quoteVols = candles.map(c => c.quoteVolume);
    return {
        pair,
        price: closes[closes.length - 1],
        closes,
        highs: candles.map(c => c.high),
        lows: candles.map(c => c.low),
        change1h: pctChange(closes, 1),
        change4h: pctChange(closes, 4),
        change24h: pctChange(closes, 24),
        quoteVolNow24: quoteVols.slice(-24).reduce((a, b) => a + b, 0),
        quoteVolPrev24: quoteVols.slice(-48, -24).reduce((a, b) => a + b, 0)
    };
}

/**
 * Compute the money-rotation table for the scan universe.
 * Throws when the BTC benchmark or most of the universe is unavailable.
 */
export async function computeMoneyRotation(
    pairs: string[] = SCALPING_V2_PAIRS
): Promise<MoneyRotationResult> {
    const results = await Promise.allSettled(pairs.map(loadPairWindows));

    const loaded: PairWindows[] = [];
    let excluded = 0;
    for (const r of results) {
        if (r.status === 'fulfilled') loaded.push(r.value);
        else excluded++;
    }

    const btc = loaded.find(p => p.pair === 'BTC/USDT');
    if (!btc || loaded.length < Math.ceil(pairs.length / 2)) {
        // Without the benchmark (or with most of the universe missing)
        // the shares and RS numbers would be meaningless: fail honestly.
        throw new Error('Live market data unavailable');
    }

    const totalNow = loaded.reduce((a, p) => a + p.quoteVolNow24, 0);
    const totalPrev = loaded.reduce((a, p) => a + p.quoteVolPrev24, 0);

    const rows: RotationRow[] = loaded.map(p => {
        const shareNow = totalNow > 0 ? (p.quoteVolNow24 / totalNow) * 100 : 0;
        const sharePrev = totalPrev > 0 ? (p.quoteVolPrev24 / totalPrev) * 100 : 0;
        const shareChangePp = shareNow - sharePrev;
        const shareMomentumPct = sharePrev > 0 ? (shareChangePp / sharePrev) * 100 : 0;

        const rs1h = (p.change1h - btc.change1h) * 100;
        const rs4h = (p.change4h - btc.change4h) * 100;
        const rs24h = (p.change24h - btc.change24h) * 100;
        const rsComposite = 0.5 * rs24h + 0.3 * rs4h + 0.2 * rs1h;

        const rotationScore = Math.round(
            Math.max(0, Math.min(100, 50 + 1.5 * shareMomentumPct + 2.5 * rsComposite)) * 10
        ) / 10;

        const classification: RotationClass =
            shareMomentumPct >= 5 && rsComposite > 0 ? 'IN'
                : shareMomentumPct <= -5 && rsComposite < 0 ? 'OUT'
                    : 'NEUTRAL';

        return {
            pair: p.pair,
            price: p.price,
            change1hPct: p.change1h * 100,
            change4hPct: p.change4h * 100,
            change24hPct: p.change24h * 100,
            classification,
            rotationScore,
            shareNow,
            sharePrev,
            shareChangePp,
            shareMomentumPct,
            rs1h,
            rs4h,
            rs24h,
            rsComposite,
            quoteVolume24h: p.quoteVolNow24
        };
    }).sort((a, b) => b.rotationScore - a.rotationScore);

    return {
        rows,
        btc: {
            change1hPct: btc.change1h * 100,
            change4hPct: btc.change4h * 100,
            change24hPct: btc.change24h * 100
        },
        totals: {
            pairsRequested: pairs.length,
            pairsLoaded: loaded.length,
            pairsExcluded: excluded,
            totalQuoteVolume24h: totalNow
        },
        generatedAt: new Date().toISOString()
    };
}
