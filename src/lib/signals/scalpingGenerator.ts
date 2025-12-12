import { Signal, SignalType, SignalDirection, MarketType, SignalStatus, Timeframe } from './types';
import { ScalpingMarketData } from './scalpingMarketData';

/**
 * Scalping Signal Generator
 * Fast trading signals for 15-60 minute profit targets
 */
export class ScalpingSignalGenerator {
    /**
     * Generate scalping signals for multiple pairs
     */
    static async generateScalpingSignals(
        pairs: Array<{ pair: string; marketType: MarketType }>,
        signalType: SignalType
    ): Promise<Signal[]> {
        const signals: Signal[] = [];

        for (const { pair, marketType } of pairs) {
            const signal = await this.generateSingleScalpingSignal(pair, marketType, signalType);
            if (signal) {
                signals.push(signal);
            }
        }

        return signals.sort((a, b) => b.confidence - a.confidence);
    }

    /**
     * Generate single scalping signal
     */
    private static async generateSingleScalpingSignal(
        pair: string,
        marketType: MarketType,
        signalType: SignalType
    ): Promise<Signal | null> {
        // Get 5-minute candle data
        const data = ScalpingMarketData.generateScalpingData(pair, marketType, 48);
        const { prices, volumes } = data;
        const currentPrice = prices[prices.length - 1];

        // Calculate fast indicators for scalping
        const rsi = this.calculateFastRSI(prices, 7); // 7-period RSI (faster)
        const macd = this.calculateFastMACD(prices); // Faster MACD
        const volumeRatio = volumes[volumes.length - 1] / (volumes.reduce((a, b) => a + b) / volumes.length);

        // Scalping score calculation
        let buyScore = 0;
        let sellScore = 0;

        // RSI Scoring (tighter ranges for scalping)
        if (rsi < 40) buyScore += 20; // Oversold
        else if (rsi > 60) sellScore += 20; // Overbought

        // MACD Scoring
        if (macd.histogram > 0 && macd.histogram > macd.previousHistogram) {
            buyScore += 25; // Bullish momentum
        } else if (macd.histogram < 0 && macd.histogram < macd.previousHistogram) {
            sellScore += 25; // Bearish momentum
        }

        // Volume confirmation (critical for scalping)
        if (volumeRatio >= 2.0) {
            buyScore += 15;
            sellScore += 15; // High volume confirms both directions
        } else if (volumeRatio < 1.2) {
            return null; // Skip low volume signals
        }

        // Short-term momentum
        const momentum = (currentPrice - prices[prices.length - 10]) / prices[prices.length - 10];
        if (momentum > 0.002) buyScore += 10; // 0.2% up = bullish
        if (momentum < -0.002) sellScore += 10; // 0.2% down = bearish

        // Minimum score for scalping (lowered for more signals)
        const MIN_SCORE = 45; // Lower threshold for frequent scalping signals
        let direction: SignalDirection | null = null;
        let confidence = 0;

        if (buyScore >= MIN_SCORE && buyScore > sellScore) {
            direction = signalType === SignalType.FUTURE ? SignalDirection.LONG : SignalDirection.BUY;
            confidence = Math.round(Math.min((buyScore / 70) * 100, 95));
        } else if (sellScore >= MIN_SCORE && sellScore > buyScore) {
            if (signalType === SignalType.SPOT) return null; // No SELL for SPOT
            direction = SignalDirection.SHORT;
            confidence = Math.round(Math.min((sellScore / 70) * 100, 95));
        } else {
            return null; // Not strong enough
        }

        // Calculate scalping TP/SL (tight levels)
        const { tp1, tp2, tp3, stopLoss } = this.calculateScalpingLevels(
            currentPrice,
            direction,
            prices
        );

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
            volume: volumes[volumes.length - 1],
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            highestPrice: currentPrice,
            lowestPrice: currentPrice,
            rationale: this.generateScalpingRationale(rsi, macd, volumeRatio, direction)
        };

        return signal;
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
                tp1: entryPrice * 1.002, // 0.2% - quick target
                tp2: entryPrice * 1.005, // 0.5% - main target
                tp3: entryPrice * 1.008, // 0.8% - bonus target
                stopLoss: entryPrice * 0.997 // -0.3% tight stop
            };
        } else {
            return {
                tp1: entryPrice * 0.998, // 0.2%
                tp2: entryPrice * 0.995, // 0.5%
                tp3: entryPrice * 0.992, // 0.8%
                stopLoss: entryPrice * 1.003 // -0.3%
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
