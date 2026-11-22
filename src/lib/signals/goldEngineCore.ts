// Gold Signal Engine Core - pure, synchronous decision logic
//
// A dedicated engine for ONE instrument: PAXG/USDT on Binance spot.
// PAXG is Paxos-issued tokenised gold (1 PAXG = 1 troy ounce of
// physical gold); its price tracks the spot gold price. Binance spot
// does not list a direct XAU pair, and the site's old forex layer is
// simulated, so PAXG is the only REAL gold price source available to
// this site (verified 2026-11-22: PAXGUSDT 1H klines on
// data-api.binance.vision reach back to 2020-08-28, ~$9.4M quote
// volume / 53k trades per 24h at probe time).
//
// ARCHITECTURE: deliberately mirrors the crypto engine
// (src/lib/signals/engineCore.ts) - the same indicator scoring family
// (RSI / momentum / ROC / MACD / Bollinger / EMA trend / volume), the
// same pullback-confirmed long entries, the same counter-trend gate,
// the same ATR-based stop and TP1/TP2/TP3 ladder (25% / 65% / 85% of
// the move, full TP = trade target), and the same honest accounting
// downstream (win only at full TP; the signal lifetime and the
// London / New York session gate are issuance rules that live in
// goldSignals.ts, not in this core - see the F+B note there).
//
// WHAT DIFFERS FROM CRYPTO, AND WHY:
//  - No BTC regime filter (meaningless for gold). Replaced by a
//    DAILY-REGIME filter on gold itself: no longs while the price is
//    below its daily EMA200, no shorts while above it.
//  - No funding filter (PAXG here is spot data; there is no funding).
//  - The 4H multi-timeframe confirmation is kept (gold's own 4H
//    EMA50 vs EMA200 must agree with the direction).
//  - Gold-specific parameters are explicit (GoldEngineParams) because
//    gold's hourly volatility is far lower than crypto's: the crypto
//    long-entry pullback band (0.5-1.5% within 10 hours) and the 0.5%
//    minimum TP distance are large moves for gold. Which parameter
//    set production runs is decided ONLY by the walk-forward backtest
//    gate (see GOLD-REPORT.md); GOLD_PRODUCTION_PARAMS below is the
//    gate's frozen winner, not a guess.

import {
    MarketData,
    SignalDirection
} from './types';
import { TechnicalIndicators } from './indicators';
import { AdvancedMarketAnalyzer, MarketAnalysis } from './advancedAnalyzer';
import { calculateATR } from './engineCore';

export interface GoldEngineParams {
    /** 4H trend (EMA50 vs EMA200 on gold's own 4H closes) must agree. */
    mtfConfirm: boolean;
    /** No longs below the daily EMA200, no shorts above it. */
    dailyRegime: boolean;
    /** Minimum technical score to issue (crypto engine: 58). */
    minScore: number;
    /** Minimum score for counter-trend signals (crypto engine: 70). */
    counterTrendMinScore: number;
    /** Long entries need a pullback of [min, max] % from the 10h high. */
    pullbackMinPct: number;
    pullbackMaxPct: number;
    /** Minimum full-TP distance as % of entry (crypto engine: 0.5). */
    minTpDistancePct: number;
}

/** The crypto engine's parameters, ported verbatim (the untuned base). */
export const GOLD_DEFAULT_PARAMS: GoldEngineParams = {
    mtfConfirm: true,
    dailyRegime: true,
    minScore: 58,
    counterTrendMinScore: 70,
    pullbackMinPct: 0.5,
    pullbackMaxPct: 1.5,
    minTpDistancePct: 0.5
};

/** Gold-scaled volatility parameters (bands sized to gold's ATR). */
export const GOLD_SCALED_PARAMS: GoldEngineParams = {
    ...GOLD_DEFAULT_PARAMS,
    pullbackMinPct: 0.1,
    pullbackMaxPct: 0.5,
    minTpDistancePct: 0.2
};

/**
 * Production parameter set: the walk-forward gate's frozen winner
 * G6 (gold-scaled volatility parameters, both filters on, score
 * >= 52) - exactly the configuration that was backtested (see
 * GOLD-REPORT.md). Shipped on the user's explicit decision
 * (2026-11-22) even though G6 did not clear the gate's statistical
 * bar on unseen data (+0.086R vs a +/-0.106R standard error); the
 * /gold page discloses that plainly.
 *
 * Since 2026-11-23 production pairs these parameters with the F+B
 * issuance rules from the A-to-Z round (GOLD2-REPORT.md), applied
 * in goldSignals.ts exactly as they wrapped this core in the
 * backtest: a London / New York session gate (issue only when the
 * signal bar opens 07:00-21:00 UTC) and a 72h signal lifetime.
 * These parameters themselves are unchanged.
 */
export const GOLD_PRODUCTION_PARAMS: GoldEngineParams = { ...GOLD_SCALED_PARAMS, minScore: 52 };

export interface GoldSignalCoreResult {
    direction: SignalDirection;
    confidence: number;
    buyScore: number;
    sellScore: number;
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    bollingerBands: { upper: number; middle: number; lower: number };
    volumeAvg: number;
    currentVolume: number;
    atr: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    advancedAnalysis: MarketAnalysis;
    isCounterTrend: boolean;
}

/** Momentum (rate of price change) - verbatim from engineCore. */
function calculateMomentum(prices: number[], period: number = 10): number {
    if (prices.length < period + 1) return 0;

    const recentPrices = prices.slice(-period);
    let upMoves = 0;
    let downMoves = 0;
    let totalChange = 0;

    for (let i = 1; i < recentPrices.length; i++) {
        const change = recentPrices[i] - recentPrices[i - 1];
        totalChange += change;
        if (change > 0) upMoves++;
        else if (change < 0) downMoves++;
    }

    const avgChange = totalChange / period;
    const currentPrice = prices[prices.length - 1];
    const momentum = (avgChange / currentPrice) * 100;

    return Math.max(-5, Math.min(5, momentum * 50));
}

/** Rate of Change (ROC) - verbatim from engineCore. */
function calculateROC(prices: number[], period: number = 10): number {
    if (prices.length < period + 1) return 0;

    const currentPrice = prices[prices.length - 1];
    const oldPrice = prices[prices.length - period - 1];

    return ((currentPrice - oldPrice) / oldPrice) * 100;
}

/** Counter-trend check - verbatim from engineCore. */
function isCounterTrendSignal(direction: SignalDirection, trend: string): boolean {
    const isBullishSignal = direction === SignalDirection.BUY || direction === SignalDirection.LONG;
    const isBearishSignal = direction === SignalDirection.SELL || direction === SignalDirection.SHORT;

    const isBearishMarket = trend === 'BEARISH' || trend === 'STRONG_BEARISH';
    const isBullishMarket = trend === 'BULLISH' || trend === 'STRONG_BULLISH';

    return (isBullishSignal && isBearishMarket) || (isBearishSignal && isBullishMarket);
}

/**
 * Evaluate the gold engine's decision for PAXG at one point in time.
 * FUTURE semantics (LONG/SHORT) - the same convention the crypto
 * engine uses when /api/signals serves type=FUTURE against spot data.
 * Returns null when no signal should be issued.
 */
export function evaluateGoldSignalCore(
    marketData: MarketData,
    params: GoldEngineParams = GOLD_PRODUCTION_PARAMS
): GoldSignalCoreResult | null {
    const { prices, volumes, pair, currentPrice } = marketData;

    if (!currentPrice || isNaN(currentPrice) || !isFinite(currentPrice) || currentPrice <= 0) {
        return null;
    }

    // Calculate all technical indicators (same family as engineCore)
    const rsi = TechnicalIndicators.calculateRSI(prices);
    const macd = TechnicalIndicators.calculateMACD(prices);
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices);
    const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
    const ema21 = TechnicalIndicators.calculateEMA(prices, 21);
    const trend = TechnicalIndicators.determineTrend(prices);
    const volumeAvg = TechnicalIndicators.calculateVolumeAverage(volumes);
    const currentVolume = volumes[volumes.length - 1];

    const momentum = calculateMomentum(prices, 10);
    const roc = calculateROC(prices, 10);

    // Signal scoring system - identical weights to engineCore.
    let buyScore = 0;
    let sellScore = 0;

    // RSI Analysis with Momentum Confirmation
    if (rsi < 30 && momentum > -1.5) {
        buyScore += 25;
    } else if (rsi < 40 && momentum > 0) {
        buyScore += 15;
    } else if (rsi > 70) {
        sellScore += 25;
    } else if (rsi > 60 && momentum < 0) {
        sellScore += 15;
    }

    // Strong Downtrend Detection
    if (momentum < -2 && roc < -3) {
        sellScore += 25;
    } else if (momentum < -1 && roc < -2) {
        sellScore += 15;
    }

    // Strong Uptrend Detection
    if (momentum > 2 && roc > 3) {
        buyScore += 25;
    } else if (momentum > 1 && roc > 2) {
        buyScore += 15;
    }

    // MACD Analysis
    if (macd.histogram > 0 && macd.macd > macd.signal) buyScore += 20;
    else if (macd.histogram < 0 && macd.macd < macd.signal) sellScore += 20;

    // Bollinger Bands Analysis
    if (currentPrice <= bollingerBands.lower && momentum > -1) {
        buyScore += 20;
    } else if (currentPrice >= bollingerBands.upper) {
        sellScore += 20;
    }

    // EMA Trend Analysis
    if (trend === 'BULLISH') buyScore += 15;
    else if (trend === 'BEARISH') sellScore += 15;

    // Volume Confirmation
    if (currentVolume > volumeAvg * 1.5) {
        if (buyScore > sellScore) buyScore += 10;
        else if (sellScore > buyScore) sellScore += 10;
    }

    // Price action relative to EMAs
    if (currentPrice > ema9 && currentPrice > ema21) buyScore += 10;
    else if (currentPrice < ema9 && currentPrice < ema21) sellScore += 10;

    // SAFETY CHECK: Prevent Falling Knife & Rising Rocket
    if (momentum < -2.5 && roc < -4) {
        if (rsi < 40) {
            buyScore = Math.max(0, buyScore - 30);
        }
    }

    if (momentum > 2.5 && roc > 4) {
        if (rsi > 60) {
            sellScore = Math.max(0, sellScore - 30);
        }
    }

    // Determine if signal is strong enough
    let direction: SignalDirection | null = null;
    let technicalConfidence = 0;

    // PULLBACK CONFIRMATION for longs: price must have pulled back
    // from the recent 10-candle high by [pullbackMinPct, pullbackMaxPct].
    const recentHighs = prices.slice(-10);
    const recentHigh = Math.max(...recentHighs);
    const pullbackPercent = ((recentHigh - currentPrice) / recentHigh) * 100;
    const hasPullback = pullbackPercent >= params.pullbackMinPct && pullbackPercent <= params.pullbackMaxPct;

    if (buyScore >= params.minScore && buyScore > sellScore) {
        if (hasPullback) {
            direction = SignalDirection.LONG;
            technicalConfidence = Math.min(buyScore, 100);
        } else {
            return null;
        }
    } else if (sellScore >= params.minScore && sellScore > buyScore) {
        direction = SignalDirection.SHORT;
        technicalConfidence = Math.min(sellScore, 100);
    }

    if (!direction) return null;

    const isLong = direction === SignalDirection.LONG;

    const advancedAnalysis = AdvancedMarketAnalyzer.generateAnalysis(
        pair,
        currentPrice,
        prices,
        volumes
    );

    const isCounterTrend = isCounterTrendSignal(direction, advancedAnalysis.trend);
    const confidence = Math.round(Math.max(0, Math.min(100, technicalConfidence)));

    if (isCounterTrend && confidence < params.counterTrendMinScore) {
        return null;
    }

    if (confidence < params.minScore) {
        return null;
    }

    // ============================================================
    // QUALITY FILTERS (backtest-gated; see GOLD-REPORT.md)
    // ============================================================

    // MULTI-TIMEFRAME CONFIRMATION: gold's own 4H trend (EMA50 vs
    // EMA200 on 4H closes) must agree with the direction. Needs >= 200
    // 4H closes; when the caller cannot supply them the filter does
    // not block (the /api/gold/signals route always supplies 250).
    if (params.mtfConfirm) {
        const closes4h = marketData.closes4h;
        if (closes4h && closes4h.length >= 200) {
            const ema50_4h = TechnicalIndicators.calculateEMA(closes4h, 50);
            const ema200_4h = TechnicalIndicators.calculateEMA(closes4h, 200);
            if (isLong && ema50_4h <= ema200_4h) return null;
            if (!isLong && ema50_4h >= ema200_4h) return null;
        }
    }

    // DAILY REGIME (replaces the crypto engine's BTC regime): no
    // longs while gold trades below its daily EMA200, no shorts
    // while above it. Needs >= 200 daily closes; absent data never
    // blocks (the gold route always supplies 250 daily closes).
    if (params.dailyRegime) {
        const dailyCloses = marketData.dailyCloses;
        if (dailyCloses && dailyCloses.length >= 200) {
            const ema200_daily = TechnicalIndicators.calculateEMA(dailyCloses, 200);
            if (isLong && currentPrice <= ema200_daily) return null;
            if (!isLong && currentPrice >= ema200_daily) return null;
        }
    }

    // ============================================================
    // LEVELS: entry, stop loss, take profit (same derivation as
    // engineCore, with the gold minimum-distance parameter)
    // ============================================================
    const entryPrice = currentPrice;
    let stopLoss: number;
    let takeProfit: number;

    const atr = calculateATR(prices, marketData.highs, marketData.lows);

    const confidenceMultiplier = confidence / 100;
    const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
    const tpMultiplier = 3.5 + (confidenceMultiplier * 2.5);

    if (isLong) {
        stopLoss = entryPrice - (atr * slMultiplier);
        takeProfit = entryPrice + (atr * tpMultiplier);

        if (stopLoss > bollingerBands.lower) {
            stopLoss = bollingerBands.lower * 0.995;
        }
    } else {
        stopLoss = entryPrice + (atr * slMultiplier);
        takeProfit = entryPrice - (atr * tpMultiplier);

        if (stopLoss < bollingerBands.upper) {
            stopLoss = bollingerBands.upper * 1.005;
        }
    }

    // Partial Take Profits: TP1 25%, TP2 65%, TP3 85% of the move.
    let takeProfit1: number;
    let takeProfit2: number;
    let takeProfit3: number;

    const minDistance = entryPrice * (params.minTpDistancePct / 100);

    if (isLong) {
        let tpDistance = takeProfit - entryPrice;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entryPrice + tpDistance;
        }
        takeProfit1 = entryPrice + (tpDistance * 0.25);
        takeProfit2 = entryPrice + (tpDistance * 0.65);
        takeProfit3 = entryPrice + (tpDistance * 0.85);
    } else {
        let tpDistance = entryPrice - takeProfit;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entryPrice - tpDistance;
        }
        takeProfit1 = entryPrice - (tpDistance * 0.25);
        takeProfit2 = entryPrice - (tpDistance * 0.65);
        takeProfit3 = entryPrice - (tpDistance * 0.85);
    }

    const pricesToValidate = [entryPrice, stopLoss, takeProfit, takeProfit1, takeProfit2, takeProfit3];
    const hasInvalidPrice = pricesToValidate.some(p => !p || isNaN(p) || !isFinite(p) || p <= 0);

    if (hasInvalidPrice) {
        return null;
    }

    return {
        direction,
        confidence,
        buyScore,
        sellScore,
        rsi,
        macd,
        bollingerBands,
        volumeAvg,
        currentVolume,
        atr,
        entryPrice,
        stopLoss,
        takeProfit,
        takeProfit1,
        takeProfit2,
        takeProfit3,
        advancedAnalysis,
        isCounterTrend
    };
}
