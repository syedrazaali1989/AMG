// Signal Generator - Advanced Trading Signal Generation

import {
    Signal,
    SignalType,
    SignalDirection,
    SignalStatus,
    MarketType,
    MarketData
} from './types';
import { TechnicalIndicators } from './indicators';
import { NewsAnalyzer } from './newsAnalyzer';
import { AdvancedMarketAnalyzer, MarketAnalysis } from './advancedAnalyzer';

export class SignalGenerator {
    /**
     * Generate trading signal based on technical analysis
     * @param marketData Market data for analysis
     * @param signalType Type of signal (SPOT/FUTURE)
     * @returns Generated signal or null
     */
    static generateSignal(
        marketData: MarketData,
        signalType: SignalType
    ): Signal | null {
        const { prices, volumes, pair, marketType, currentPrice } = marketData;

        // Calculate all technical indicators
        const rsi = TechnicalIndicators.calculateRSI(prices);
        const macd = TechnicalIndicators.calculateMACD(prices);
        const bollingerBands = TechnicalIndicators.calculateBollingerBands(prices);
        const ema9 = TechnicalIndicators.calculateEMA(prices, 9);
        const ema21 = TechnicalIndicators.calculateEMA(prices, 21);
        const ema50 = TechnicalIndicators.calculateEMA(prices, 50);
        const trend = TechnicalIndicators.determineTrend(prices);
        const volumeAvg = TechnicalIndicators.calculateVolumeAverage(volumes);
        const currentVolume = volumes[volumes.length - 1];

        // Signal scoring system
        let buyScore = 0;
        let sellScore = 0;

        // RSI Analysis (30/70 levels)
        if (rsi < 30) buyScore += 25;
        else if (rsi < 40) buyScore += 15;
        else if (rsi > 70) sellScore += 25;
        else if (rsi > 60) sellScore += 15;

        // MACD Analysis
        if (macd.histogram > 0 && macd.macd > macd.signal) buyScore += 20;
        else if (macd.histogram < 0 && macd.macd < macd.signal) sellScore += 20;

        // Bollinger Bands Analysis
        if (currentPrice <= bollingerBands.lower) buyScore += 20;
        else if (currentPrice >= bollingerBands.upper) sellScore += 20;

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

        // Determine if signal is strong enough (threshold: 40 to allow signals through)
        // Final confidence check at 45% will filter quality
        const threshold = 40;
        let direction: SignalDirection | null = null;
        let technicalConfidence = 0;

        if (buyScore >= threshold && buyScore > sellScore) {
            direction = signalType === SignalType.FUTURE ? SignalDirection.LONG : SignalDirection.BUY;
            technicalConfidence = Math.min(buyScore, 100);
        } else if (sellScore >= threshold && sellScore > buyScore) {
            direction = signalType === SignalType.FUTURE ? SignalDirection.SHORT : SignalDirection.SELL;
            technicalConfidence = Math.min(sellScore, 100);
        }

        // No signal if not strong enough
        if (!direction) return null;

        // Generate advanced market analysis
        const advancedAnalysis = AdvancedMarketAnalyzer.generateAnalysis(
            pair,
            currentPrice,
            prices,
            volumes
        );

        // Check if this is a counter-trend signal
        const isCounterTrend = this.isCounterTrendSignal(direction, advancedAnalysis.trend);

        // Calculate sentiment score (news + economic events)
        const technicalScore = (direction === SignalDirection.BUY || direction === SignalDirection.LONG) ? buyScore : sellScore;
        const sentimentScore = NewsAnalyzer.calculateSentimentScore(pair, technicalScore);

        // Combine technical and fundamental analysis
        // Technical: 60%, News: 20%, Economic: 20%
        let finalConfidence = (technicalConfidence * 0.6) +
            (Math.max(0, sentimentScore.news + 100) / 2 * 0.2) +
            (Math.max(0, sentimentScore.economic + 100) / 2 * 0.2);

        // Use sentiment only for confirmation, not contradiction
        // Only boost confidence when sentiment aligns with technical signal
        if (sentimentScore.overall > 30 && (direction === SignalDirection.BUY || direction === SignalDirection.LONG)) {
            // Bullish news confirms buy signal - boost confidence
            finalConfidence = Math.min(finalConfidence * 1.15, 100);
        } else if (sentimentScore.overall < -30 && (direction === SignalDirection.SELL || direction === SignalDirection.SHORT)) {
            // Bearish news confirms sell signal - boost confidence
            finalConfidence = Math.min(finalConfidence * 1.15, 100);
        } else if (Math.abs(sentimentScore.overall) > 40 &&
            ((sentimentScore.overall > 0 && (direction === SignalDirection.SELL || direction === SignalDirection.SHORT)) ||
                (sentimentScore.overall < 0 && (direction === SignalDirection.BUY || direction === SignalDirection.LONG)))) {
            // Strong sentiment contradicts technical - slightly reduce confidence but don't invert
            finalConfidence *= 0.85;
        }

        const confidence = Math.round(Math.max(0, Math.min(100, finalConfidence)));

        // Counter-trend signals require higher confidence (75%)
        if (isCounterTrend && confidence < 75) {
            return null; // Reject weak counter-trend signals
        }

        // Reject signals below 45% confidence - balanced for both Crypto and Forex
        // Crypto pairs with real data will still generate high-confidence signals
        // Forex pairs with simulated data will generate more opportunities
        if (confidence < 45) return null;

        // Calculate entry, stop loss, and take profit with improved logic
        const entryPrice = currentPrice;
        let stopLoss: number;
        let takeProfit: number;

        // Calculate ATR for volatility-based targets
        const atr = this.calculateATR(prices);

        // Adjust multipliers based on confidence and sentiment
        // Higher confidence = wider TP, tighter SL
        // Bullish sentiment for BUY or Bearish for SELL = wider TP
        const confidenceMultiplier = confidence / 100;
        const sentimentAdjustment = Math.abs(sentimentScore.overall) / 100;

        if (direction === SignalDirection.BUY || direction === SignalDirection.LONG) {
            // For buy signals
            // Stop loss: tighter for high confidence
            const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
            stopLoss = entryPrice - (atr * slMultiplier);

            // Take profit: wider for high confidence and bullish sentiment
            let tpMultiplier = 2.5 + (confidenceMultiplier * 1.5);
            if (sentimentScore.overall > 30) {
                // Bullish news supports higher TP
                tpMultiplier += sentimentAdjustment * 1.5;
            }
            takeProfit = entryPrice + (atr * tpMultiplier);

            // Adjust based on Bollinger Bands
            if (stopLoss > bollingerBands.lower) {
                stopLoss = bollingerBands.lower * 0.995;
            }
            // Set TP near upper band if very bullish
            if (sentimentScore.overall > 50 && takeProfit < bollingerBands.upper) {
                takeProfit = bollingerBands.upper * 0.98;
            }
        } else {
            // For sell signals
            // Stop loss: tighter for high confidence
            const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
            stopLoss = entryPrice + (atr * slMultiplier);

            // Take profit: wider for high confidence and bearish sentiment
            let tpMultiplier = 2.5 + (confidenceMultiplier * 1.5);
            if (sentimentScore.overall < -30) {
                // Bearish news supports lower TP
                tpMultiplier += sentimentAdjustment * 1.5;
            }
            takeProfit = entryPrice - (atr * tpMultiplier);

            // Adjust based on Bollinger Bands
            if (stopLoss < bollingerBands.upper) {
                stopLoss = bollingerBands.upper * 1.005;
            }
            // Set TP near lower band if very bearish
            if (sentimentScore.overall < -50 && takeProfit > bollingerBands.lower) {
                takeProfit = bollingerBands.lower * 1.02;
            }
        }

        // Calculate Partial Take Profits (TP1, TP2, TP3)
        let takeProfit1: number;
        let takeProfit2: number;
        let takeProfit3: number;

        if (direction === SignalDirection.BUY || direction === SignalDirection.LONG) {
            // For LONG/BUY: TP1 at 10%, TP2 at 50%, TP3 at 100% of the move
            const tpDistance = takeProfit - entryPrice;
            takeProfit1 = entryPrice + (tpDistance * 0.10); // 10% of move (easier to hit)
            takeProfit2 = entryPrice + (tpDistance * 0.50); // 50% of move
            takeProfit3 = takeProfit; // 100% (final TP)
        } else {
            // For SHORT/SELL: TP1 at 10%, TP2 at 50%, TP3 at 100% of the move
            const tpDistance = entryPrice - takeProfit;
            takeProfit1 = entryPrice - (tpDistance * 0.10); // 10% of move (easier to hit)
            takeProfit2 = entryPrice - (tpDistance * 0.50); // 50% of move
            takeProfit3 = takeProfit; // 100% (final TP)
        }

        // Generate signal ID
        const id = `${pair.replace('/', '')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Set expiration (24 hours for spot, 48 hours for futures)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (signalType === SignalType.SPOT ? 24 : 48));

        // Get relevant news and economic events
        const newsEvents = NewsAnalyzer.getNewsSummary(pair);
        const economicEvents = NewsAnalyzer.getEconomicSummary(pair);

        const signal: Signal = {
            id,
            marketType,
            signalType,
            direction,
            status: SignalStatus.ACTIVE,
            pair,
            entryPrice,
            currentPrice,
            stopLoss,
            takeProfit,
            takeProfit1,
            takeProfit2,
            takeProfit3,
            tp1Hit: false,
            tp2Hit: false,
            tp3Hit: false,
            confidence,
            timestamp: new Date(),
            expiresAt,
            profitLoss: 0,
            profitLossPercentage: 0,
            highestPrice: currentPrice,
            lowestPrice: currentPrice,
            newsEvents: newsEvents.length > 0 ? newsEvents : undefined,
            economicEvents: economicEvents.length > 0 ? economicEvents : undefined,
            sentimentScore: Math.round(sentimentScore.overall),
            // Advanced market analysis
            marketTrend: advancedAnalysis.trend,
            riskScore: advancedAnalysis.riskScore,
            marketAnalysis: advancedAnalysis.reasoning,
            liquidityZones: advancedAnalysis.keyLevels.liquidityZones,
            isCounterTrend // Flag counter-trend signals
        };

        return signal;
    }

    /**
     * Calculate ATR (Average True Range) for stop loss/take profit
     * @param prices Array of prices
     * @param period Period for ATR calculation
     * @returns ATR value
     */
    private static calculateATR(prices: number[], period: number = 14): number {
        if (prices.length < period + 1) {
            return prices[prices.length - 1] * 0.02; // 2% fallback
        }

        const trueRanges: number[] = [];

        for (let i = 1; i < prices.length; i++) {
            const high = Math.max(prices[i], prices[i - 1]);
            const low = Math.min(prices[i], prices[i - 1]);
            const tr = high - low;
            trueRanges.push(tr);
        }

        const atr = trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
        return atr;
    }

    /**
     * Update signal with current price and P/L
     * @param signal Signal to update
     * @param currentPrice Current market price
     * @returns Updated signal
     */
    static updateSignal(signal: Signal, currentPrice: number): Signal {
        // Track highest and lowest prices reached
        const highestPrice = Math.max(signal.highestPrice || signal.entryPrice, currentPrice);
        const lowestPrice = Math.min(signal.lowestPrice || signal.entryPrice, currentPrice);

        const profitLoss = (signal.direction === SignalDirection.BUY || signal.direction === SignalDirection.LONG)
            ? currentPrice - signal.entryPrice
            : signal.entryPrice - currentPrice;

        const profitLossPercentage = (profitLoss / signal.entryPrice) * 100;

        // Check partial TP hits
        let tp1Hit = signal.tp1Hit || false;
        let tp2Hit = signal.tp2Hit || false;
        let tp3Hit = signal.tp3Hit || false;

        // Check if stop loss or take profit hit
        let status = signal.status;

        // Only update status if signal is still ACTIVE
        if (status === SignalStatus.ACTIVE) {
            if (signal.direction === SignalDirection.BUY || signal.direction === SignalDirection.LONG) {
                // For LONG/BUY: Check partial TPs
                if (signal.takeProfit1 && highestPrice >= signal.takeProfit1) {
                    tp1Hit = true;
                }
                if (signal.takeProfit2 && highestPrice >= signal.takeProfit2) {
                    tp2Hit = true;
                }
                if (signal.takeProfit3 && highestPrice >= signal.takeProfit3) {
                    tp3Hit = true;
                }

                // Check SL and TP
                if (lowestPrice <= signal.stopLoss) {
                    status = SignalStatus.STOPPED;
                } else if (tp1Hit) {
                    // Complete signal when TP1 is hit (easier to achieve)
                    status = SignalStatus.COMPLETED;
                }
            } else {
                // For SHORT/SELL: Check partial TPs
                if (signal.takeProfit1 && lowestPrice <= signal.takeProfit1) {
                    tp1Hit = true;
                }
                if (signal.takeProfit2 && lowestPrice <= signal.takeProfit2) {
                    tp2Hit = true;
                }
                if (signal.takeProfit3 && lowestPrice <= signal.takeProfit3) {
                    tp3Hit = true;
                }

                // Check SL and TP
                if (highestPrice >= signal.stopLoss) {
                    status = SignalStatus.STOPPED;
                } else if (tp1Hit) {
                    // Complete signal when TP1 is hit (easier to achieve)
                    status = SignalStatus.COMPLETED;
                }
            }

            // Check expiration
            if (signal.expiresAt && new Date() > signal.expiresAt) {
                status = SignalStatus.COMPLETED;
            }
        }

        return {
            ...signal,
            currentPrice,
            highestPrice,
            lowestPrice,
            tp1Hit,
            tp2Hit,
            tp3Hit,
            profitLoss,
            profitLossPercentage,
            status
        };
    }

    /**
     * Generate multiple signals for different pairs
     * @param pairs Array of pairs to analyze
     * @param signalType Type of signals to generate
     * @returns Array of generated signals
     */
    static generateMultipleSignals(
        marketDataList: MarketData[],
        signalType: SignalType
    ): Signal[] {
        const signals: Signal[] = [];

        for (const marketData of marketDataList) {
            const signal = this.generateSignal(marketData, signalType);
            if (signal) {
                signals.push(signal);
            }
        }

        return signals;
    }

    /**
     * Calculate signal accuracy metrics
     * @param signals Array of signals
     * @returns Accuracy metrics
     */
    static calculateAccuracy(signals: Signal[]): {
        totalSignals: number;
        successfulSignals: number;
        failedSignals: number;
        activeSignals: number;
        accuracyRate: number;
        averageProfit: number;
    } {
        const totalSignals = signals.length;
        const activeSignals = signals.filter(s => s.status === SignalStatus.ACTIVE).length;
        const completedSignals = signals.filter(s => s.status === SignalStatus.COMPLETED);
        const stoppedSignals = signals.filter(s => s.status === SignalStatus.STOPPED);

        const successfulSignals = completedSignals.filter(s =>
            (s.profitLossPercentage || 0) > 0
        ).length;

        const failedSignals = stoppedSignals.length + completedSignals.filter(s =>
            (s.profitLossPercentage || 0) <= 0
        ).length;

        const closedSignals = totalSignals - activeSignals;
        const accuracyRate = closedSignals > 0
            ? (successfulSignals / closedSignals) * 100
            : 0;

        const totalProfit = signals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
        const averageProfit = totalSignals > 0 ? totalProfit / totalSignals : 0;

        return {
            totalSignals,
            successfulSignals,
            failedSignals,
            activeSignals,
            accuracyRate,
            averageProfit
        };
    }

    /**
     * Check if signal direction contradicts market trend
     * @param direction Signal direction
     * @param trend Market trend
     * @returns True if counter-trend signal
     */
    private static isCounterTrendSignal(direction: SignalDirection, trend: string): boolean {
        const isBullishSignal = direction === SignalDirection.BUY || direction === SignalDirection.LONG;
        const isBearishSignal = direction === SignalDirection.SELL || direction === SignalDirection.SHORT;

        const isBearishMarket = trend === 'BEARISH' || trend === 'STRONG_BEARISH';
        const isBullishMarket = trend === 'BULLISH' || trend === 'STRONG_BULLISH';

        // Counter-trend: LONG in bearish market OR SHORT in bullish market
        return (isBullishSignal && isBearishMarket) || (isBearishSignal && isBullishMarket);
    }
}
