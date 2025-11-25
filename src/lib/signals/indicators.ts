// Technical Analysis Indicators

export class TechnicalIndicators {
    /**
     * Calculate RSI (Relative Strength Index)
     * @param prices Array of prices
     * @param period Period for RSI calculation (default: 14)
     * @returns RSI value (0-100)
     */
    static calculateRSI(prices: number[], period: number = 14): number {
        if (prices.length < period + 1) return 50;

        const changes = prices.slice(1).map((price, i) => price - prices[i]);
        const gains = changes.map(change => change > 0 ? change : 0);
        const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);

        const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
        const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));

        return rsi;
    }

    /**
     * Calculate MACD (Moving Average Convergence Divergence)
     * @param prices Array of prices
     * @returns MACD object with macd, signal, and histogram
     */
    static calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
        if (prices.length < 26) {
            return { macd: 0, signal: 0, histogram: 0 };
        }

        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macd = ema12 - ema26;

        // Calculate proper signal line: 9-period EMA of MACD values
        // For accuracy, we need historical MACD values
        const macdValues: number[] = [];

        // Calculate MACD for the last 35 periods (26 + 9 for signal line)
        const startIndex = Math.max(0, prices.length - 35);
        for (let i = startIndex; i < prices.length; i++) {
            const slicePrices = prices.slice(0, i + 1);
            const ema12Temp = this.calculateEMA(slicePrices, 12);
            const ema26Temp = this.calculateEMA(slicePrices, 26);
            macdValues.push(ema12Temp - ema26Temp);
        }

        // Calculate signal line as 9-period EMA of MACD values
        const signal = macdValues.length >= 9
            ? this.calculateEMA(macdValues, 9)
            : macd * 0.9; // Fallback for insufficient data

        const histogram = macd - signal;

        return { macd, signal, histogram };
    }

    /**
     * Calculate EMA (Exponential Moving Average)
     * @param prices Array of prices
     * @param period Period for EMA calculation
     * @returns EMA value
     */
    static calculateEMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];

        const multiplier = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < prices.length; i++) {
            ema = (prices[i] - ema) * multiplier + ema;
        }

        return ema;
    }

    /**
     * Calculate SMA (Simple Moving Average)
     * @param prices Array of prices
     * @param period Period for SMA calculation
     * @returns SMA value
     */
    static calculateSMA(prices: number[], period: number): number {
        if (prices.length < period) return prices[prices.length - 1];

        const slice = prices.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    /**
     * Calculate Bollinger Bands
     * @param prices Array of prices
     * @param period Period for calculation (default: 20)
     * @param stdDev Standard deviation multiplier (default: 2)
     * @returns Bollinger Bands object
     */
    static calculateBollingerBands(
        prices: number[],
        period: number = 20,
        stdDev: number = 2
    ): { upper: number; middle: number; lower: number } {
        const middle = this.calculateSMA(prices, period);
        const slice = prices.slice(-period);

        const variance = slice.reduce((sum, price) => {
            return sum + Math.pow(price - middle, 2);
        }, 0) / period;

        const standardDeviation = Math.sqrt(variance);

        return {
            upper: middle + (standardDeviation * stdDev),
            middle,
            lower: middle - (standardDeviation * stdDev)
        };
    }

    /**
     * Calculate Volume Average
     * @param volumes Array of volumes
     * @param period Period for average (default: 20)
     * @returns Average volume
     */
    static calculateVolumeAverage(volumes: number[], period: number = 20): number {
        if (volumes.length < period) return volumes[volumes.length - 1];

        const slice = volumes.slice(-period);
        return slice.reduce((a, b) => a + b, 0) / period;
    }

    /**
     * Calculate Fibonacci Retracement Levels
     * @param high Highest price
     * @param low Lowest price
     * @returns Fibonacci levels
     */
    static calculateFibonacciLevels(high: number, low: number): {
        level_0: number;
        level_236: number;
        level_382: number;
        level_500: number;
        level_618: number;
        level_786: number;
        level_1000: number;
    } {
        const diff = high - low;

        return {
            level_0: high,
            level_236: high - (diff * 0.236),
            level_382: high - (diff * 0.382),
            level_500: high - (diff * 0.500),
            level_618: high - (diff * 0.618),
            level_786: high - (diff * 0.786),
            level_1000: low
        };
    }

    /**
     * Determine trend based on moving averages
     * @param prices Array of prices
     * @returns Trend direction: 'BULLISH', 'BEARISH', or 'NEUTRAL'
     */
    static determineTrend(prices: number[]): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        const ema9 = this.calculateEMA(prices, 9);
        const ema21 = this.calculateEMA(prices, 21);
        const ema50 = this.calculateEMA(prices, 50);

        if (ema9 > ema21 && ema21 > ema50) return 'BULLISH';
        if (ema9 < ema21 && ema21 < ema50) return 'BEARISH';
        return 'NEUTRAL';
    }

    /**
     * Calculate support and resistance levels
     * @param prices Array of prices
     * @returns Support and resistance levels
     */
    static calculateSupportResistance(prices: number[]): {
        support: number;
        resistance: number;
    } {
        const recentPrices = prices.slice(-50);
        const high = Math.max(...recentPrices);
        const low = Math.min(...recentPrices);

        return {
            support: low,
            resistance: high
        };
    }
}
