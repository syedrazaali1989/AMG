// Multi-Timeframe Correlation Analyzer
// Analyzes trend alignment across different timeframes

import {
    Timeframe,
    TimeframeAlignment,
    TimeframeData,
    MarketType
} from '../signals/types';
import { TechnicalIndicators } from '../signals/indicators';
import { MarketDataManager } from '../signals/marketData';

export class MultiTimeframeAnalyzer {
    /**
     * Analyze correlation across multiple timeframes
     * @param pair Trading pair
     * @param marketType Market type (CRYPTO/FOREX)
     * @param currentPrices Current price data (for reference)
     * @returns Timeframe alignment analysis
     */
    static async analyzeTimeframes(
        pair: string,
        marketType: MarketType,
        currentPrices: number[]
    ): Promise<TimeframeAlignment> {
        const timeframes: Timeframe[] = [
            Timeframe.FIVE_MINUTES,
            Timeframe.FIFTEEN_MINUTES,
            Timeframe.ONE_HOUR,
            Timeframe.FOUR_HOURS,
            Timeframe.ONE_DAY
        ];

        const timeframeDataList: TimeframeData[] = [];

        // Analyze each timeframe
        for (const timeframe of timeframes) {
            try {
                const data = await this.analyzeTimeframe(
                    pair,
                    marketType,
                    timeframe,
                    currentPrices
                );
                if (data) {
                    timeframeDataList.push(data);
                }
            } catch (error) {
                console.error(`Error analyzing ${timeframe}:`, error);
            }
        }

        // Calculate alignment
        return this.calculateAlignment(timeframeDataList);
    }

    /**
     * Analyze single timeframe
     */
    private static async analyzeTimeframe(
        pair: string,
        marketType: MarketType,
        timeframe: Timeframe,
        currentPrices: number[]
    ): Promise<TimeframeData | null> {
        try {
            // For simulation, we'll use current prices with different sampling
            // In production, you'd fetch actual timeframe-specific data
            const dataPoints = this.getDataPointsForTimeframe(timeframe);
            const sampledPrices = this.samplePrices(currentPrices, dataPoints);

            if (sampledPrices.length < 30) return null;

            // Calculate indicators for this timeframe
            const rsi = TechnicalIndicators.calculateRSI(sampledPrices);
            const macd = TechnicalIndicators.calculateMACD(sampledPrices);
            const ema9 = TechnicalIndicators.calculateEMA(sampledPrices, 9);
            const ema21 = TechnicalIndicators.calculateEMA(sampledPrices, 21);
            const ema50 = TechnicalIndicators.calculateEMA(sampledPrices, 50);

            // Determine trend
            let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
            if (ema9 > ema21 && ema21 > ema50) {
                trend = 'BULLISH';
            } else if (ema9 < ema21 && ema21 < ema50) {
                trend = 'BEARISH';
            } else {
                trend = 'NEUTRAL';
            }

            // Calculate trend strength
            const emaSpread = Math.abs(ema9 - ema50) / ema50;
            const strength = Math.min(100, Math.round(emaSpread * 1000));

            // MACD signal
            let macdSignal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
            if (macd.histogram > 0 && macd.macd > macd.signal) {
                macdSignal = 'BULLISH';
            } else if (macd.histogram < 0 && macd.macd < macd.signal) {
                macdSignal = 'BEARISH';
            } else {
                macdSignal = 'NEUTRAL';
            }

            return {
                timeframe,
                trend,
                strength,
                rsi,
                macdSignal
            };
        } catch (error) {
            console.error(`Error in analyzeTimeframe for ${timeframe}:`, error);
            return null;
        }
    }

    /**
     * Calculate overall alignment from timeframe data
     */
    private static calculateAlignment(timeframeDataList: TimeframeData[]): TimeframeAlignment {
        if (timeframeDataList.length === 0) {
            return {
                aligned: false,
                alignedTimeframes: [],
                conflictingTimeframes: [],
                strength: 0,
                dominantTrend: 'NEUTRAL',
                divergences: ['Insufficient timeframe data'],
                timeframeData: []
            };
        }

        // Count trends
        const bullishCount = timeframeDataList.filter(t => t.trend === 'BULLISH').length;
        const bearishCount = timeframeDataList.filter(t => t.trend === 'BEARISH').length;
        const neutralCount = timeframeDataList.filter(t => t.trend === 'NEUTRAL').length;

        // Determine dominant trend
        let dominantTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
        if (bullishCount > bearishCount && bullishCount > neutralCount) {
            dominantTrend = 'BULLISH';
        } else if (bearishCount > bullishCount && bearishCount > neutralCount) {
            dominantTrend = 'BEARISH';
        } else {
            dominantTrend = 'NEUTRAL';
        }

        // Find aligned and conflicting timeframes
        const alignedTimeframes: Timeframe[] = [];
        const conflictingTimeframes: Timeframe[] = [];

        for (const data of timeframeDataList) {
            if (data.trend === dominantTrend) {
                alignedTimeframes.push(data.timeframe);
            } else if (data.trend !== 'NEUTRAL') {
                conflictingTimeframes.push(data.timeframe);
            }
        }

        // Check if aligned (at least 70% agreement)
        const aligned = alignedTimeframes.length / timeframeDataList.length >= 0.7;

        // Calculate alignment strength
        const agreementRatio = alignedTimeframes.length / timeframeDataList.length;
        const avgStrength = timeframeDataList
            .filter(t => t.trend === dominantTrend)
            .reduce((sum, t) => sum + t.strength, 0) / (alignedTimeframes.length || 1);

        const strength = Math.round(agreementRatio * avgStrength);

        // Identify divergences
        const divergences: string[] = [];

        // Higher timeframe conflicts (more serious)
        const higherTimeframes = [Timeframe.ONE_DAY, Timeframe.FOUR_HOURS];
        const higherConflicts = timeframeDataList.filter(
            t => higherTimeframes.includes(t.timeframe) && t.trend !== dominantTrend && t.trend !== 'NEUTRAL'
        );

        if (higherConflicts.length > 0) {
            for (const conflict of higherConflicts) {
                divergences.push(`${conflict.timeframe} shows ${conflict.trend} trend (conflicts with ${dominantTrend})`);
            }
        }

        // Lower timeframe conflicts (less serious)
        const lowerTimeframes = [Timeframe.FIVE_MINUTES, Timeframe.FIFTEEN_MINUTES];
        const lowerConflicts = timeframeDataList.filter(
            t => lowerTimeframes.includes(t.timeframe) && t.trend !== dominantTrend && t.trend !== 'NEUTRAL'
        );

        if (lowerConflicts.length > 0) {
            divergences.push(`Lower timeframes show mixed signals`);
        }

        // RSI divergence
        const rsiOverbought = timeframeDataList.filter(t => t.rsi > 70).length;
        const rsiOversold = timeframeDataList.filter(t => t.rsi < 30).length;

        if (rsiOverbought >= 2) {
            divergences.push(`${rsiOverbought} timeframes show RSI overbought (>70)`);
        }
        if (rsiOversold >= 2) {
            divergences.push(`${rsiOversold} timeframes show RSI oversold (<30)`);
        }

        return {
            aligned,
            alignedTimeframes,
            conflictingTimeframes,
            strength,
            dominantTrend,
            divergences,
            timeframeData: timeframeDataList
        };
    }

    /**
     * Get number of data points to fetch for timeframe
     */
    private static getDataPointsForTimeframe(timeframe: Timeframe): number {
        switch (timeframe) {
            case Timeframe.ONE_MINUTE:
                return 60; // 1 hour of 1m candles
            case Timeframe.FIVE_MINUTES:
                return 100; // ~8 hours
            case Timeframe.FIFTEEN_MINUTES:
                return 100; // ~24 hours
            case Timeframe.ONE_HOUR:
                return 100; // ~4 days
            case Timeframe.FOUR_HOURS:
                return 100; // ~16 days
            case Timeframe.ONE_DAY:
                return 100; // ~3 months
            default:
                return 100;
        }
    }

    /**
     * Sample prices to simulate different timeframes
     * In production, you'd fetch actual timeframe-specific candles
     */
    private static samplePrices(prices: number[], targetLength: number): number[] {
        if (prices.length <= targetLength) {
            return [...prices];
        }

        // Sample evenly across the price array
        const step = prices.length / targetLength;
        const sampled: number[] = [];

        for (let i = 0; i < targetLength; i++) {
            const index = Math.floor(i * step);
            sampled.push(prices[index]);
        }

        return sampled;
    }

    /**
     * Check if higher timeframe confirms lower timeframe signal
     * @param signal Lower timeframe signal direction
     * @param alignment Timeframe alignment analysis
     * @returns True if higher timeframes confirm
     */
    static higherTimeframeConfirms(
        signal: 'BULLISH' | 'BEARISH',
        alignment: TimeframeAlignment
    ): boolean {
        const higherTimeframes = [Timeframe.FOUR_HOURS, Timeframe.ONE_DAY];

        const higherTrends = alignment.timeframeData
            .filter(t => higherTimeframes.includes(t.timeframe))
            .map(t => t.trend);

        // Check if at least one higher timeframe matches signal
        return higherTrends.some(trend => trend === signal);
    }

    /**
     * Get timeframe priority score (higher = more important)
     */
    private static getTimeframePriority(timeframe: Timeframe): number {
        switch (timeframe) {
            case Timeframe.ONE_DAY:
                return 6;
            case Timeframe.FOUR_HOURS:
                return 5;
            case Timeframe.ONE_HOUR:
                return 4;
            case Timeframe.FIFTEEN_MINUTES:
                return 3;
            case Timeframe.FIVE_MINUTES:
                return 2;
            case Timeframe.ONE_MINUTE:
                return 1;
            default:
                return 0;
        }
    }
}
