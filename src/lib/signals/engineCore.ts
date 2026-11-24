// Signal Engine Core - pure, synchronous decision logic
//
// This module holds the engine's actual decision path: indicator scoring,
// direction gates, quality filters and entry/SL/TP level derivation.
// SignalGenerator.generateSignal (generator.ts) delegates to
// evaluateSignalCore() and then adds the display-only extras (news,
// ML predictions, rationale text) around the result. Keeping the core
// pure and synchronous means the exact production decision logic can be
// backtested offline (see scripts/backtest.ts) with no second,
// divergent implementation.
//
// QUALITY FILTERS (each behind a switch so the backtest gate could
// measure them one at a time; DEFAULT_RULES is what production runs):
//  - mtfConfirm:     signal direction must agree with the pair's 4H trend
//                    (EMA50 vs EMA200 on 4H closes). KEPT by the gate:
//                    +0.207R expectancy on its own in the 95-day backtest.
//  - btcRegime:      no longs while BTCUSDT is below its 4H EMA200,
//                    no shorts while it is above. KEPT by the gate:
//                    +0.189R on its own; combined with mtfConfirm +0.262R.
//  - fundingFilter:  (futures only) block longs when the latest funding
//                    rate > +0.05% and shorts when < -0.05% (crowded
//                    side). Unavailable funding = neutral, never blocks.
//                    NOT backtestable (no historical funding data); kept
//                    as a live-only guardrail, excluded from all
//                    backtest performance claims.
//
// Tested and DROPPED by the gate (see IMPROVE-REPORT.md; measured with
// the pre-removal harness in this branch's git history):
//  - structure-based stops (swing high/low + 0.25xATR, TP scaled by the
//    old risk:reward): expectancy collapsed to -0.654R - the scaled TP
//    was almost never reached within expiry while the far stop was.
//  - RSI room filter (shorts need RSI >= 38, longs <= 62): expectancy
//    -0.086R vs base -0.004R and win rate fell - it filtered out the
//    engine's profitable momentum entries.

import {
    MarketData,
    SignalDirection,
    SignalType
} from './types';
import { TechnicalIndicators } from './indicators';
import { AdvancedMarketAnalyzer, MarketAnalysis, MarketTrend } from './advancedAnalyzer';

export interface EngineRuleSwitches {
    mtfConfirm: boolean;
    btcRegime: boolean;
    fundingFilter: boolean;
}

export const ALL_RULES_OFF: EngineRuleSwitches = {
    mtfConfirm: false,
    btcRegime: false,
    fundingFilter: false
};

export const ALL_RULES_ON: EngineRuleSwitches = {
    mtfConfirm: true,
    btcRegime: true,
    fundingFilter: true
};

// Production rule set. Updated by the backtest gate: only rules that
// measurably improved expectancy / win rate in backtesting stay on.
export const DEFAULT_RULES: EngineRuleSwitches = { ...ALL_RULES_ON };

export interface SignalCoreResult {
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

// Issuance thresholds (technical score). See generator.ts history: 58 is
// the engine's own direction gate and the level the scoring system was
// designed around; counter-trend signals need 70.
const BUY_THRESHOLD = 58;
const SELL_THRESHOLD = 58;
const COUNTER_TREND_MIN_CONFIDENCE = 70;
const FUTURES_MIN_CONFIDENCE = 58;

// Quality-filter constants
const FUNDING_BLOCK_THRESHOLD = 0.0005; // 0.05% as a decimal fraction

/**
 * Calculate Momentum (rate of price change) - moved verbatim from
 * SignalGenerator so the core is self-contained.
 */
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
    const momentum = (avgChange / currentPrice) * 100; // Percentage

    // Scale to -5 to +5 range
    return Math.max(-5, Math.min(5, momentum * 50));
}

/**
 * Calculate Rate of Change (ROC) - moved verbatim from SignalGenerator.
 */
function calculateROC(prices: number[], period: number = 10): number {
    if (prices.length < period + 1) return 0;

    const currentPrice = prices[prices.length - 1];
    const oldPrice = prices[prices.length - period - 1];

    return ((currentPrice - oldPrice) / oldPrice) * 100;
}

/**
 * ATR from TRUE RANGE: max(high-low, |high-prevClose|, |low-prevClose|).
 * Falls back to close-to-close change when the feed provides no OHLC.
 * (Moved verbatim from SignalGenerator.calculateATR.)
 */
export function calculateATR(
    prices: number[],
    highs?: number[],
    lows?: number[],
    period: number = 14
): number {
    if (prices.length < period + 1) {
        return prices[prices.length - 1] * 0.02; // 2% fallback
    }

    const hasOHLC = highs && lows && highs.length === prices.length && lows.length === prices.length;

    const trueRanges: number[] = [];

    for (let i = 1; i < prices.length; i++) {
        const prevClose = prices[i - 1];
        let tr: number;
        if (hasOHLC) {
            const high = highs[i];
            const low = lows[i];
            tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
        } else {
            tr = Math.abs(prices[i] - prevClose);
        }
        trueRanges.push(tr);
    }

    const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
    return atr;
}

/**
 * Check if signal direction contradicts market trend
 * (moved verbatim from SignalGenerator).
 */
function isCounterTrendSignal(direction: SignalDirection, trend: string): boolean {
    const isBullishSignal = direction === SignalDirection.BUY || direction === SignalDirection.LONG;
    const isBearishSignal = direction === SignalDirection.SELL || direction === SignalDirection.SHORT;

    const isBearishMarket = trend === 'BEARISH' || trend === 'STRONG_BEARISH';
    const isBullishMarket = trend === 'BULLISH' || trend === 'STRONG_BULLISH';

    // Counter-trend: LONG in bearish market OR SHORT in bullish market
    return (isBullishSignal && isBearishMarket) || (isBearishSignal && isBullishMarket);
}

/**
 * Evaluate the engine's decision for one pair at one point in time.
 * Returns null when no signal should be issued. Behaviour with all rule
 * switches OFF is exactly the post-honesty-fix production engine.
 */
export function evaluateSignalCore(
    marketData: MarketData,
    signalType: SignalType,
    rules: EngineRuleSwitches = DEFAULT_RULES
): SignalCoreResult | null {
    const { prices, volumes, pair, currentPrice } = marketData;

    // COMPREHENSIVE PRICE VALIDATION
    if (!currentPrice || isNaN(currentPrice) || !isFinite(currentPrice) || currentPrice <= 0) {
        return null;
    }

    // Reject extremely low-priced coins (< $0.0001)
    if (currentPrice < 0.0001) {
        return null;
    }

    // Calculate all technical indicators
    const rsi = TechnicalIndicators.calculateRSI(prices);
    const macd = TechnicalIndicators.calculateMACD(prices);
    const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices);
    const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
    const ema21 = TechnicalIndicators.calculateEMA(prices, 21);
    const trend = TechnicalIndicators.determineTrend(prices);
    const volumeAvg = TechnicalIndicators.calculateVolumeAverage(volumes);
    const currentVolume = volumes[volumes.length - 1];

    // HYBRID STRATEGY: Calculate Momentum & ROC
    const momentum = calculateMomentum(prices, 10);
    const roc = calculateROC(prices, 10);

    // Signal scoring system (HYBRID APPROACH)
    let buyScore = 0;
    let sellScore = 0;

    // === MEAN REVERSION SIGNALS (Reversal Trading) ===

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

    // === MOMENTUM TRADING SIGNALS (Trend Following) ===

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

    // MACD Analysis (works for both strategies)
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

    // === SAFETY CHECK: Prevent Falling Knife & Rising Rocket ===
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

    // PULLBACK CONFIRMATION: price must have pulled back from recent high
    const recentHighs = prices.slice(-10); // Last 10 candles
    const recentHigh = Math.max(...recentHighs);
    const pullbackPercent = ((recentHigh - currentPrice) / recentHigh) * 100;

    // For LONG/BUY: require 0.5-1.5% pullback from recent high
    const hasPullback = pullbackPercent >= 0.5 && pullbackPercent <= 1.5;

    if (buyScore >= BUY_THRESHOLD && buyScore > sellScore) {
        // LONG signals require pullback confirmation
        if (hasPullback) {
            direction = SignalDirection.LONG;
            technicalConfidence = Math.min(buyScore, 100);
        } else {
            // Skip signal - price at or near local top
            return null;
        }
    } else if (sellScore >= SELL_THRESHOLD && sellScore > buyScore) {
        direction = SignalDirection.SHORT;
        technicalConfidence = Math.min(sellScore, 100);
    }

    // No signal if not strong enough
    if (!direction) return null;

    const isLong = direction === SignalDirection.LONG;

    // Generate advanced market analysis (used for the counter-trend gate
    // here, and for display fields by the caller)
    const advancedAnalysis = AdvancedMarketAnalyzer.generateAnalysis(
        pair,
        currentPrice,
        prices,
        volumes
    );

    // Check if this is a counter-trend signal
    const isCounterTrend = isCounterTrendSignal(direction, advancedAnalysis.trend);

    // Confidence IS the technical confidence (raw score capped at 100).
    const confidence = Math.round(Math.max(0, Math.min(100, technicalConfidence)));

    // Counter-trend signals require a stronger technical score.
    if (isCounterTrend && confidence < COUNTER_TREND_MIN_CONFIDENCE) {
        return null; // Reject weak counter-trend signals (higher risk)
    }

    // Profile-based confidence threshold (technical score only)
    const minConfidence = FUTURES_MIN_CONFIDENCE;
    if (confidence < minConfidence) {
        return null; // Signal doesn't meet quality threshold for this type
    }

    // ============================================================
    // QUALITY FILTERS (backtest-gated; see DEFAULT_RULES)
    // ============================================================

    // MULTI-TIMEFRAME CONFIRMATION: the pair's own 4H trend
    // (EMA50 vs EMA200 on 4H closes) must agree with the direction.
    // Needs >= 200 4H closes; when the caller cannot supply them the
    // filter does not block (the /api/signals route always supplies 250).
    if (rules.mtfConfirm) {
        const closes4h = marketData.closes4h;
        if (closes4h && closes4h.length >= 200) {
            const ema50_4h = TechnicalIndicators.calculateEMA(closes4h, 50);
            const ema200_4h = TechnicalIndicators.calculateEMA(closes4h, 200);
            if (isLong && ema50_4h <= ema200_4h) {
                console.log(`🚫 ${pair} LONG blocked by 4H trend filter (EMA50 ${ema50_4h.toFixed(4)} <= EMA200 ${ema200_4h.toFixed(4)})`);
                return null;
            }
            if (!isLong && ema50_4h >= ema200_4h) {
                console.log(`🚫 ${pair} SHORT blocked by 4H trend filter (EMA50 ${ema50_4h.toFixed(4)} >= EMA200 ${ema200_4h.toFixed(4)})`);
                return null;
            }
        }
    }

    // BTC REGIME: no longs anywhere while BTCUSDT trades below its
    // 4H EMA200, no shorts while it trades above it. The regime is
    // computed by the caller (route / backtest) from BTC 4H closes.
    if (rules.btcRegime && marketData.btcTrend) {
        if (isLong && marketData.btcTrend === 'DOWN') {
            console.log(`🚫 ${pair} LONG blocked by BTC regime filter (BTC below 4H EMA200)`);
            return null;
        }
        if (!isLong && marketData.btcTrend === 'UP') {
            console.log(`🚫 ${pair} SHORT blocked by BTC regime filter (BTC above 4H EMA200)`);
            return null;
        }
    }

    // FUNDING FILTER (futures only): don't join the crowded side.
    // Funding unavailable (undefined) is neutral and never blocks.
    if (rules.fundingFilter && signalType === SignalType.FUTURE) {
        const fundingRate = marketData.fundingRate;
        if (fundingRate !== undefined) {
            if (isLong && fundingRate > FUNDING_BLOCK_THRESHOLD) {
                console.log(`🚫 ${pair} LONG blocked by funding filter (funding ${(fundingRate * 100).toFixed(3)}% > +0.05%: longs crowded)`);
                return null;
            }
            if (!isLong && fundingRate < -FUNDING_BLOCK_THRESHOLD) {
                console.log(`🚫 ${pair} SHORT blocked by funding filter (funding ${(fundingRate * 100).toFixed(3)}% < -0.05%: shorts crowded)`);
                return null;
            }
        }
    }

    // ============================================================
    // LEVELS: entry, stop loss, take profit
    // ============================================================
    const entryPrice = currentPrice;
    let stopLoss: number;
    let takeProfit: number;

    // Calculate ATR (true range) for volatility-based targets
    const atr = calculateATR(prices, marketData.highs, marketData.lows);

    // Multipliers depend on confidence only.
    // Higher confidence = wider TP, tighter SL
    const confidenceMultiplier = confidence / 100;
    const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
    const tpMultiplier = 3.5 + (confidenceMultiplier * 2.5);

    if (isLong) {
        stopLoss = entryPrice - (atr * slMultiplier);
        takeProfit = entryPrice + (atr * tpMultiplier);

        // Adjust stop based on Bollinger Bands
        if (stopLoss > bollingerBands.lower) {
            stopLoss = bollingerBands.lower * 0.995;
        }
    } else {
        stopLoss = entryPrice + (atr * slMultiplier);
        takeProfit = entryPrice - (atr * tpMultiplier);

        // Adjust stop based on Bollinger Bands
        if (stopLoss < bollingerBands.upper) {
            stopLoss = bollingerBands.upper * 1.005;
        }
    }

    // Calculate Partial Take Profits (TP1, TP2, TP3)
    let takeProfit1: number;
    let takeProfit2: number;
    let takeProfit3: number;

    if (isLong) {
        // TP1 at 25%, TP2 at 65%, TP3 at 85% of the move
        let tpDistance = takeProfit - entryPrice;

        // Ensure minimum distance (at least 0.5% of entry price)
        const minDistance = entryPrice * 0.005;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entryPrice + tpDistance;
        }

        takeProfit1 = entryPrice + (tpDistance * 0.25);
        takeProfit2 = entryPrice + (tpDistance * 0.65);
        takeProfit3 = entryPrice + (tpDistance * 0.85);
    } else {
        let tpDistance = entryPrice - takeProfit;

        const minDistance = entryPrice * 0.005;
        if (tpDistance < minDistance) {
            tpDistance = minDistance;
            takeProfit = entryPrice - tpDistance;
        }

        takeProfit1 = entryPrice - (tpDistance * 0.25);
        takeProfit2 = entryPrice - (tpDistance * 0.65);
        takeProfit3 = entryPrice - (tpDistance * 0.85);
    }

    // Final validation: Ensure all prices are valid
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

// Re-export so callers that only need the trend enum don't import the
// analyzer directly.
export { MarketTrend };
