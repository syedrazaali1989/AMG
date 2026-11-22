// Gold signal generation service (server-side).
//
// Runs the dedicated gold engine (goldEngineCore, configuration G6 -
// the walk-forward gate's frozen winner, see GOLD-REPORT.md) against
// live PAXG/USDT data from Binance spot, so every visitor sees the
// same signal for the same market state. Production runs the G6 core
// with the F+B upgrade from the A-to-Z round (GOLD2-REPORT.md),
// applied at issuance in this file, exactly as backtested:
//  - (B) SESSION GATE: a signal is issued only when the signal bar
//    opens inside London / New York hours, 07:00-21:00 UTC.
//  - (F) EXPIRY: gold setups live 72 hours instead of 48.
// The core's parameters and decision logic are unchanged from G6.
//
//  - REAL DATA ONLY. PAXG is Paxos-issued tokenised gold (1 PAXG =
//    1 troy ounce of physical gold); its Binance spot price is the
//    only REAL gold price available to this site - Binance spot does
//    not list a direct XAU pair, and the site's old forex layer is
//    simulated and is NOT used. There is no simulated fallback: if
//    the live 1H series cannot be fetched or is stale, this throws
//    and the route answers 502 ("live data unavailable").
//  - SHIPPED ON THE USER'S DECISION. G6's frozen out-of-sample
//    backtest (PAXG hourly data, 2023-2026) was positive but small
//    (+0.086R per resolved trade) and did NOT clear the statistical
//    bar this site's crypto engine was held to. The /gold page says
//    so plainly; nothing here claims otherwise.
//  - HONEST ACCOUNTING downstream: the signal's takeProfit is the
//    FULL take profit. TP1/TP2/TP3 are milestones only - the shared
//    SignalGenerator.updateSignal rules close a trade as COMPLETED
//    only at the full target, STOPPED at the stop loss, EXPIRED at
//    the 72h expiry.

import { BinanceAPI } from './binanceAPI';
import { evaluateGoldSignalCore, GoldSignalCoreResult } from './goldEngineCore';
import {
    MarketData,
    MarketType,
    Signal,
    SignalDirection,
    SignalStatus,
    SignalType,
    Timeframe
} from './types';

/** The real instrument priced by the gold engine (Binance spot). */
export const GOLD_DATA_PAIR = 'PAXG/USDT';

/**
 * The pair label shown to visitors. It names the underlying
 * instrument (PAXG) - visitors are never led to believe these are
 * direct spot XAU/USD quotes from a forex feed.
 */
export const GOLD_DISPLAY_PAIR = 'XAU/USD (PAXG)';

// Gold setups expire 72h after issuance (the F+B backtested rule -
// GOLD-REPORT.md gate used 48h; the A-to-Z round's F family and the
// winning F+B combination extended the resolution window to 72h).
export const GOLD_EXPIRY_MS = 72 * 60 * 60 * 1000;

// F+B session gate (B), exactly as backtested in GOLD2-REPORT.md:
// the gate reads the signal (entry) bar's UTC OPEN hour and keeps
// the signal only when that hour is in [07:00, 21:00) - London and
// New York trading hours. In the harness the gate vetoed an
// otherwise-valid core signal after the core decision; it is
// applied the same way below, on the last 1H candle's open time
// (Binance kline timestamps are open times).
export const GOLD_SESSION_START_UTC_HOUR = 7;
export const GOLD_SESSION_END_UTC_HOUR = 21; // exclusive

/** True when a bar opening at `barOpenTimeMs` is inside the gold session. */
export function isGoldSessionBar(barOpenTimeMs: number): boolean {
    const hour = new Date(barOpenTimeMs).getUTCHours();
    return hour >= GOLD_SESSION_START_UTC_HOUR && hour < GOLD_SESSION_END_UTC_HOUR;
}

const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

export interface GoldSignalResult {
    signals: Signal[];
    /** Latest live PAXG price the evaluation ran on. */
    price: number;
    /** True when the engine issued a signal on this pass. */
    issued: boolean;
    generatedAt: string;
}

/**
 * Evaluate the gold engine once on live PAXG data.
 * Throws only when live 1H data is unavailable or stale.
 */
export async function generateGoldSignals(): Promise<GoldSignalResult> {
    // Mandatory: the 1H series the engine scores. Throws on failure.
    const candles1h = await BinanceAPI.getCandles(GOLD_DATA_PAIR, '1h', 100);
    if (!BinanceAPI.isCandleSeriesFresh(candles1h, HOURLY_INTERVAL_MS)) {
        throw new Error('Live market data unavailable');
    }

    // Filter context, exactly as the backtest supplied it: 250 4H
    // closes for the MTF confirmation and 250 daily closes for the
    // daily-regime filter (the last daily candle is the in-progress
    // day, so its close is the latest price - the backtest's
    // "completed days + current close" convention). A context fetch
    // that fails leaves the field undefined and that filter does not
    // block - context failure never invents data.
    let closes4h: number[] | undefined;
    try {
        closes4h = await BinanceAPI.get4hCloses(GOLD_DATA_PAIR, 250);
    } catch {
        console.warn('Gold 4H closes unavailable (MTF filter neutral)');
    }

    let dailyCloses: number[] | undefined;
    try {
        const daily = await BinanceAPI.getCandles(GOLD_DATA_PAIR, '1d', 250);
        dailyCloses = daily.map(c => c.close);
    } catch {
        console.warn('Gold daily closes unavailable (daily-regime filter neutral)');
    }

    const marketData: MarketData = {
        pair: GOLD_DATA_PAIR,
        marketType: MarketType.CRYPTO,
        prices: candles1h.map(c => c.close),
        highs: candles1h.map(c => c.high),
        lows: candles1h.map(c => c.low),
        volumes: candles1h.map(c => c.volume),
        timestamps: candles1h.map(c => new Date(c.timestamp)),
        currentPrice: candles1h[candles1h.length - 1].close,
        closes4h,
        dailyCloses
    };

    const core = evaluateGoldSignalCore(marketData);
    const lastCandle = candles1h[candles1h.length - 1];

    // F+B session gate (B): the core's decision stands, but a signal
    // is ISSUED only when the signal bar opened inside the London /
    // New York window - the same post-core veto the backtest used.
    const issuedCore = core && isGoldSessionBar(lastCandle.timestamp) ? core : null;

    return {
        signals: issuedCore ? [goldCoreToSignal(issuedCore, lastCandle.timestamp)] : [],
        price: marketData.currentPrice,
        issued: issuedCore !== null,
        generatedAt: new Date().toISOString()
    };
}

/** Convert a gold engine decision into the repo's shared Signal shape. */
function goldCoreToSignal(core: GoldSignalCoreResult, barTimestampMs: number): Signal {
    const now = Date.now();

    const rationale: string[] = [
        `Gold engine score ${core.confidence}/100 (issuance threshold 52) - RSI ${core.rsi.toFixed(1)}, MACD histogram ${core.macd.histogram >= 0 ? '+' : ''}${core.macd.histogram.toFixed(2)}`,
        'Direction confirmed on two timeframes: the 4H trend (EMA50 vs EMA200) and the daily regime (price vs the daily EMA200) both agree with the signal',
        'Priced on PAXG/USDT (Binance spot). PAXG is tokenised gold: 1 PAXG = 1 troy ounce of gold',
        'Issued during London / New York trading hours (07:00-21:00 UTC) - this engine does not issue gold signals outside that session window',
        'TP1, TP2 and TP3 are milestones only - a trade completes only when the full take profit is reached before the stop loss; it expires after 72 hours'
    ];

    const signal: Signal = {
        // One deterministic id per signal bar, so repeat scans of the
        // same bar do not duplicate the signal in the local store.
        id: `gold-PAXGUSDT-${barTimestampMs}`,
        marketType: MarketType.CRYPTO,
        signalType: SignalType.FUTURE,
        direction: core.direction,
        status: SignalStatus.ACTIVE,
        pair: GOLD_DISPLAY_PAIR,
        entryPrice: core.entryPrice,
        currentPrice: core.entryPrice,
        stopLoss: core.stopLoss,
        // The trade's target is the FULL take profit. TP1/TP2/TP3 are
        // partial milestones and never complete the trade.
        takeProfit: core.takeProfit,
        takeProfit1: core.takeProfit1,
        takeProfit2: core.takeProfit2,
        takeProfit3: core.takeProfit3,
        confidence: core.confidence,
        timestamp: new Date(now),
        expiresAt: new Date(now + GOLD_EXPIRY_MS),
        timeframe: Timeframe.ONE_HOUR,
        rsi: core.rsi,
        macdValue: core.macd.macd,
        macdSignal: core.macd.signal,
        isCounterTrend: core.isCounterTrend,
        marketTrend: core.advancedAnalysis.trend,
        riskScore: core.advancedAnalysis.riskScore,
        volumeVsAverage: core.volumeAvg > 0
            ? (core.currentVolume / core.volumeAvg) * 100
            : undefined,
        rationalePoints: rationale
    };

    // Marker for the Gold store/history views.
    (signal as unknown as Record<string, unknown>).isGold = true;

    return signal;
}
