import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { ScalpingMarketData } from './scalpingMarketData';
import { ExchangeAvailability } from './exchangeAvailability';
import { lastClosedBarOpen } from './standardSignals';
import type { TickKlineCache } from './klineCache';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Scalping Signal Generator
 * Fast trading signals for 15-60 minute profit targets
 */
export class ScalpingSignalGenerator {
    /**
     * Generate scalping signals for multiple pairs.
     *
     * Strict mode (server route): live data is mandatory. A pair whose
     * live data cannot be fetched is SKIPPED, and if every pair fails
     * the call throws so the route can answer an honest 502 - signals
     * are never generated from simulated prices. In non-strict mode
     * (legacy client path) the data layer keeps its old fallback.
     *
     * Returns the signals AND the per-pair decision-bar anchor: the open
     * time of the last fully closed 5m candle the scan evaluated. The
     * anchor is plumbing for the push watcher only — scoring, levels,
     * thresholds and expiry are untouched. A persistent setup re-fires
     * on every new 5m bar, so the watcher maps this per-evaluation
     * anchor to the FIRST-SEEN bar (Redis) before notifying; the anchor
     * here is never itself a notification id.
     */
    static async generateScalpingSignals(
        pairs: Array<{ pair: string; marketType: MarketType }>,
        signalType: SignalType,
        opts?: { strict?: boolean },
        cache?: TickKlineCache
    ): Promise<{ signals: Signal[]; barAnchors: Map<string, number> }> {
        const signals: Signal[] = [];
        const barAnchors = new Map<string, number>();
        let failedPairs = 0;

        for (const { pair, marketType } of pairs) {
            try {
                const { signal, anchorMs } = await this.generateSingleScalpingSignal(pair, marketType, signalType, opts?.strict ?? false, cache);
                if (signal) {
                    signals.push(signal);
                    if (anchorMs !== null) barAnchors.set(pair, anchorMs);
                }
            } catch (error) {
                // Strict mode: count the failure and keep scanning the
                // remaining pairs - one dead pair must not kill the scan.
                if (opts?.strict) {
                    failedPairs++;
                    continue;
                }
                throw error;
            }
        }

        if (opts?.strict && failedPairs === pairs.length && pairs.length > 0) {
            throw new Error('Live market data unavailable for all scalping pairs');
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        return { signals, barAnchors };
    }

    /**
     * Generate single scalping signal. Returns the signal (null when the
     * pair does not qualify) plus the decision-bar anchor for the
     * evaluation: the open time of the last fully closed 5m candle.
     * The anchor is plumbing for the push watcher only.
     */
    private static async generateSingleScalpingSignal(
        pair: string,
        marketType: MarketType,
        signalType: SignalType,
        strict = false,
        cache?: TickKlineCache
    ): Promise<{ signal: Signal | null; anchorMs: number | null }> {
        // Get 5-minute candle data (now fetches real Binance prices)
        const data = await ScalpingMarketData.generateScalpingData(pair, marketType, 48, strict, cache);
        const { prices, volumes } = data;
        const currentPrice = prices[prices.length - 1];

        // Decision-bar anchor: the last fully closed 5m candle. Only
        // the live Binance path carries candle timestamps; the legacy
        // simulated/Exness paths do not, so they fall back to the
        // wall-clock 5m grid (same fallback the standard engine uses).
        const timestamps = (data as { timestamps?: Date[] }).timestamps;
        const anchorMs = timestamps && timestamps.length > 0
            ? lastClosedBarOpen(timestamps, FIVE_MINUTES_MS)
            : Math.floor(Date.now() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;

        // COMPREHENSIVE PRICE VALIDATION
        // Filter out invalid prices that would show as 0.0000 or cause errors
        if (!currentPrice || isNaN(currentPrice) || !isFinite(currentPrice) || currentPrice <= 0) {
            console.log(`⚠️ Skipping ${pair} - invalid price (${currentPrice})`);
            return { signal: null, anchorMs };
        }

        // Reject extremely low-priced coins (< $0.0001)
        if (currentPrice < 0.0001) {
            console.log(`⚠️ Skipping ${pair} - price too low (${currentPrice})`);
            return { signal: null, anchorMs };
        }

        // Calculate fast indicators for scalping
        const rsi = this.calculateFastRSI(prices, 7); // 7-period RSI (faster)
        const macd = this.calculateFastMACD(prices); // Faster MACD
        const volumeRatio = volumes[volumes.length - 1] / (volumes.reduce((a, b) => a + b) / volumes.length);

        // Scalping score calculation
        let buyScore = 0;
        let sellScore = 0;

        // RSI Scoring (HIGHER WEIGHT - RSI is critical for scalping!)
        if (rsi < 45) {
            buyScore += 30; // Oversold - strong buy signal
            // Prevent SHORT when oversold
            if (rsi < 35) sellScore = 0;
        } else if (rsi > 55) {
            sellScore += 30; // Overbought - strong sell signal
            // Prevent LONG when overbought
            if (rsi > 65) buyScore = 0;
        }

        // MACD Scoring
        if (macd.histogram > 0 && macd.histogram > macd.previousHistogram) {
            if (rsi < 65) buyScore += 25; // Only add if not overbought
        } else if (macd.histogram < 0 && macd.histogram < macd.previousHistogram) {
            if (rsi > 35) sellScore += 25; // Only add if not oversold
        }

        // Additional MACD signals (only if RSI allows)
        if (macd.histogram > 0 && rsi < 60) buyScore += 10;
        if (macd.histogram < 0 && rsi > 40) sellScore += 10;

        // Volume confirmation (doesn't add to direction, just confirms)
        let volumeBoost = 0;
        if (volumeRatio >= 2.0) {
            volumeBoost = 15;
        } else if (volumeRatio >= 1.0) {
            volumeBoost = 10;
        } else if (volumeRatio < 0.8) {
            return { signal: null, anchorMs }; // Skip very low volume signals
        }

        // Apply volume boost to winning direction only (not both!)
        // We'll apply this after determining direction

        // Short-term momentum
        const momentum = (currentPrice - prices[prices.length - 10]) / prices[prices.length - 10];
        if (momentum > 0.001 && rsi < 60) buyScore += 10;
        if (momentum < -0.001 && rsi > 40) sellScore += 10;

        // Determine preliminary direction
        let preliminaryBuyScore = buyScore;
        let preliminarySellScore = sellScore;

        // Apply volume boost to the winning direction only
        if (preliminaryBuyScore > preliminarySellScore) {
            buyScore += volumeBoost;
        } else if (preliminarySellScore > preliminaryBuyScore) {
            sellScore += volumeBoost;
        }

        // Minimum score for scalping
        const MIN_SCORE = 30;
        let direction: SignalDirection | null = null;
        let confidence = 0;

        if (buyScore >= MIN_SCORE && buyScore > sellScore) {
            direction = SignalDirection.LONG;
            confidence = Math.round(Math.min((buyScore / 70) * 100, 95));
        } else if (sellScore >= MIN_SCORE && sellScore > buyScore) {
            direction = SignalDirection.SHORT;
            confidence = Math.round(Math.min((sellScore / 70) * 100, 95));
        } else {
            return { signal: null, anchorMs }; // Not strong enough
        }

        // Calculate scalping TP/SL (tight levels)
        const { tp1, tp2, tp3, stopLoss } = this.calculateScalpingLevels(
            currentPrice,
            direction,
            prices
        );

        // Get available exchanges for this pair
        const availableExchanges = ExchangeAvailability.getAvailableExchanges(pair, marketType);

        // Create signal
        const signal: Signal = {
            id: `SCALP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            pair,
            direction,
            entryPrice: currentPrice,
            currentPrice,
            takeProfit: tp3,
            takeProfit1: tp1,
            takeProfit2: tp2,
            takeProfit3: tp3,
            stopLoss,
            confidence,
            rsi,
            macdValue: macd.value,
            macdSignal: macd.signal,
            marketType,
            signalType,
            status: SignalStatus.ACTIVE,
            timestamp: new Date(), // Correct field name!
            timeframe: Timeframe.FIVE_MINUTES, // Scalping timeframe
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            highestPrice: currentPrice,
            lowestPrice: currentPrice,
            rationalePoints: [this.generateScalpingRationale(rsi, macd, volumeRatio, direction)],
            availableExchanges // Add exchange availability
        };

        return { signal, anchorMs };
    }

    /**
     * Calculate fast RSI (7-period for scalping)
     */
    private static calculateFastRSI(prices: number[], period: number = 7): number {
        if (prices.length < period + 1) return 50;

        let gains = 0;
        let losses = 0;

        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) gains += change;
            else losses -= change;
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    /**
     * Calculate fast MACD (5, 13, 4 for scalping)
     */
    private static calculateFastMACD(prices: number[]) {
        const ema5 = this.calculateEMA(prices, 5);
        const ema13 = this.calculateEMA(prices, 13);
        const macdLine = ema5 - ema13;

        // Signal line (4-period EMA of MACD)
        const macdHistory = [macdLine]; // Simplified
        const signal = macdLine * 0.8; // Approximation
        const histogram = macdLine - signal;
        const previousHistogram = histogram * 0.9; // Approximation

        return {
            value: macdLine,
            signal,
            histogram,
            previousHistogram
        };
    }

    /**
     * Calculate EMA
     */
    private static calculateEMA(prices: number[], period: number): number {
        const multiplier = 2 / (period + 1);
        let ema = prices[prices.length - period];

        for (let i = prices.length - period + 1; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    /**
     * Calculate tight TP/SL levels for scalping
     */
    private static calculateScalpingLevels(
        entryPrice: number,
        direction: SignalDirection,
        prices: number[]
    ) {
        // Calculate volatility (smaller for 5-min)
        const volatility = this.calculateVolatility(prices);

        if (direction === SignalDirection.BUY || direction === SignalDirection.LONG) {
            return {
                tp1: entryPrice * 1.010, // 1.0% - quick target
                tp2: entryPrice * 1.020, // 2.0% - main target
                tp3: entryPrice * 1.030, // 3.0% - bonus target
                stopLoss: entryPrice * 0.993 // -0.7% stop
            };
        } else {
            return {
                tp1: entryPrice * 0.990, // 1.0%
                tp2: entryPrice * 0.980, // 2.0%
                tp3: entryPrice * 0.970, // 3.0%
                stopLoss: entryPrice * 1.007 // -0.7%
            };
        }
    }

    /**
     * Calculate volatility
     */
    private static calculateVolatility(prices: number[]): number {
        const returns = [];
        for (let i = 1; i < prices.length; i++) {
            returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
        }

        const mean = returns.reduce((a, b) => a + b) / returns.length;
        const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
        return Math.sqrt(variance);
    }

    /**
     * Generate scalping rationale
     */
    private static generateScalpingRationale(
        rsi: number,
        macd: any,
        volumeRatio: number,
        direction: SignalDirection
    ): string {
        const reasons: string[] = [];

        if (direction === SignalDirection.LONG || direction === SignalDirection.BUY) {
            if (rsi < 40) reasons.push('RSI oversold - bounce expected');
            if (macd.histogram > 0) reasons.push('MACD bullish momentum');
            if (volumeRatio >= 2) reasons.push('Strong buying volume');
        } else {
            if (rsi > 60) reasons.push('RSI overbought - pullback expected');
            if (macd.histogram < 0) reasons.push('MACD bearish momentum');
            if (volumeRatio >= 2) reasons.push('Strong selling volume');
        }

        reasons.push('5-min scalping setup - quick exit expected');

        return reasons.join(' • ');
    }
}
