// Signal Generator - Advanced Trading Signal Generation

import {
    Signal,
    SignalType,
    SignalDirection,
    SignalStatus,
    MarketType,
    MarketData,
    Timeframe,
    MarketCondition,
    TechnicalAlignment
} from './types';
import { TechnicalIndicators } from './indicators';
import { evaluateSignalCore, DEFAULT_RULES, EngineRuleSwitches } from './engineCore';
import { NewsAnalyzer } from './newsAnalyzer';
import { SignalHelpers } from './signalHelpers';
import { PredictionEngine } from '../ml/predictionEngine';
import { MultiTimeframeAnalyzer } from '../timeframe/multiTimeframeAnalyzer';
import { ExchangeAvailability } from './exchangeAvailability';
import {
    calculatePortfolioAllocation,
    calculateHoldTime,
    calculateVolumeQuality,
    getCoinStability,
    generateBeginnerTip
} from './spotEnhancements';


export class SignalGenerator {
    private static predictionEngineInitialized = false;

    // Trading Profile Constants
    // Issuance is decided by the TECHNICAL score alone (see generateSignal).
    // The score's own direction gate is 58 (BUY_THRESHOLD/SELL_THRESHOLD below),
    // the raw score is capped at 100, and in backtesting over ~41 days x 24 pairs
    // the highest score the engine ever produced was 80. The previous 70/72
    // thresholds were applied to a sentiment-blended confidence that needed a
    // technical score of ~83-87 with neutral sentiment - unreachable in practice,
    // which made issuance depend on the (fabricated) news term instead.
    // 58 aligns the profile gate with the engine's own technical gate.
    private static readonly SPOT_PROFILE = {
        minConfidence: 58,        // SPOT: technical score >= 58
        riskLevel: 'MODERATE' as const
    };

    private static readonly FUTURES_PROFILE = {
        minConfidence: 58,        // FUTURES: technical score >= 58
        riskLevel: 'HIGH' as const
    };

    /**
     * Initialize prediction engine (call once on app start)
     */
    static async initializePrediction(): Promise<void> {
        if (!this.predictionEngineInitialized) {
            await PredictionEngine.initialize();
            this.predictionEngineInitialized = true;
            console.log('✅ Predictive AI Engine Ready');
        }
    }
    /**
     * Generate trading signal with news + technical confirmation
     * Enhanced with real-time news analysis
     * @param marketData Market data for analysis
     * @param signalType Type of signal (SPOT/FUTURE)
     * @param timeframe Candlestick timeframe for the signal
     * @returns Generated signal or null
     */
    static async generateSignal(
        marketData: MarketData,
        signalType: SignalType,
        timeframe: Timeframe = Timeframe.ONE_HOUR,
        rules: EngineRuleSwitches = DEFAULT_RULES
    ): Promise<Signal | null> {
        const { prices, volumes, pair, marketType, currentPrice } = marketData;

        // COMPREHENSIVE PRICE VALIDATION
        // Filter out invalid prices that would show as 0.0000 or cause errors
        if (!currentPrice || isNaN(currentPrice) || !isFinite(currentPrice) || currentPrice <= 0) {
            console.log(`⚠️ Skipping ${pair} - invalid price (${currentPrice})`);
            return null;
        }

        // Reject extremely low-priced coins (< $0.0001)
        // These display as 0.0000 and create confusing signals
        if (currentPrice < 0.0001) {
            console.log(`⚠️ Skipping ${pair} - price too low (${currentPrice})`);
            return null;
        }

        // ============================================================
        // DECISION CORE (shared engine, src/lib/signals/engineCore.ts)
        // Scoring, direction gates, quality filters and entry/SL/TP
        // levels are computed by the pure synchronous core - the same
        // code the backtest harness exercises. Everything after this
        // point in generateSignal is display-only enrichment (news, ML
        // predictions, rationale) and cannot change the decision.
        // ============================================================
        const core = evaluateSignalCore(marketData, signalType, rules);
        if (!core) return null;

        const {
            direction,
            confidence,
            rsi,
            macd,
            volumeAvg,
            currentVolume,
            entryPrice,
            stopLoss,
            takeProfit,
            takeProfit1,
            takeProfit2,
            takeProfit3,
            advancedAnalysis,
            isCounterTrend
        } = core;

        // Raw technical score (capped at 100) for the prediction engine
        // input, exactly as computed before the core extraction.
        const technicalConfidence = Math.min(
            (direction === SignalDirection.BUY || direction === SignalDirection.LONG) ? core.buyScore : core.sellScore,
            100
        );

        // === NEWS (DISPLAY ONLY) ===
        // News impact and sentiment are still collected for display on the
        // signal card, but they NO LONGER influence confidence, issuance, or
        // TP/SL levels in any way. When no real news source is configured the
        // values are neutral (score 0) - simulated news was removed.
        const newsImpact = await NewsAnalyzer.getNewsImpactAssessment(pair);
        const newsImpactScore = newsImpact.score; // -5 to +5

        const technicalScore = (direction === SignalDirection.BUY || direction === SignalDirection.LONG) ? core.buyScore : core.sellScore;
        const sentimentScore = await NewsAnalyzer.calculateSentimentScore(pair, technicalScore);

        // ============================================
        // PREDICTIVE AI INTEGRATION
        // ============================================

        // Determine technical bias for prediction engine
        const technicalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL' =
            (direction === SignalDirection.BUY || direction === SignalDirection.LONG) ? 'BULLISH' :
                (direction === SignalDirection.SELL || direction === SignalDirection.SHORT) ? 'BEARISH' : 'NEUTRAL';

        // Generate comprehensive predictions (ML + Patterns + Multi-Timeframe)
        let mlPrediction = undefined;
        let detectedPatterns = undefined;
        let nextCandlePrediction = undefined;
        let predictionConsensus = undefined;
        let timeframeAlignment = undefined;

        try {
            // Initialize prediction engine if not already done
            await this.initializePrediction();

            // Generate predictions using unified engine
            const predictions = await PredictionEngine.generatePrediction({
                prices,
                volumes,
                rsi,
                macd: macd.macd,
                currentPrice,
                timeframe,
                technicalBias,
                technicalConfidence
            });

            if (predictions) {
                mlPrediction = predictions.mlPrediction;
                detectedPatterns = predictions.detectedPatterns;
                nextCandlePrediction = predictions.nextCandlePrediction;
                predictionConsensus = predictions.predictionConsensus;
            }

            // Multi-timeframe analysis
            timeframeAlignment = await MultiTimeframeAnalyzer.analyzeTimeframes(
                pair,
                marketType,
                prices
            );

            // Optional: Boost confidence if predictions align strongly
            if (predictionConsensus && predictionConsensus.agreement >= 80) {
                // High agreement between all sources - boost confidence slightly
                const alignmentBonus = (predictionConsensus.agreement - 80) * 0.1; // Max 2% boost
                // Only boost if consensus matches our signal direction
                if (
                    (predictionConsensus.overallDirection === 'BULLISH' && technicalBias === 'BULLISH') ||
                    (predictionConsensus.overallDirection === 'BEARISH' && technicalBias === 'BEARISH')
                ) {
                    // Note: confidence is purely technical, this is informational only
                    console.log(`✅ Prediction consensus confirms ${technicalBias} signal (${predictionConsensus.agreement}% agreement)`);
                }
            }

            // Log predictions for monitoring
            if (mlPrediction && mlPrediction.confidence > 60) {
                console.log(`🤖 ML Prediction: ${mlPrediction.direction} (${mlPrediction.confidence}% confidence)`);
            }
            if (detectedPatterns && detectedPatterns.length > 0) {
                console.log(`📐 Detected Patterns: ${detectedPatterns.map(p => p.name).join(', ')}`);
            }

        } catch (error) {
            console.error('Prediction engine error:', error);
            // Continue without predictions if there's an error
        }

        // Generate signal ID
        const id = `${pair.replace('/', '')}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Set expiration (24 hours for spot, 48 hours for futures)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (signalType === SignalType.SPOT ? 24 : 48));

        // Get relevant news and economic events
        const newsEvents = await NewsAnalyzer.getNewsSummary(pair);
        const economicEvents = NewsAnalyzer.getEconomicSummary(pair);

        // Determine market condition
        const marketCondition = SignalHelpers.determineMarketCondition(
            newsImpactScore,
            currentVolume,
            volumeAvg,
            advancedAnalysis.trend
        );

        // Generate 3-bullet rationale
        const rationalePoints = SignalHelpers.generateRationale(
            newsImpact.catalyst,
            newsImpact.recentNews,
            rsi,
            macd,
            currentVolume,
            volumeAvg,
            direction,
            TechnicalAlignment.STRONG // Will be calculated properly in next update
        );

        // Calculate volume vs average
        const volumeVsAverage = Math.round((currentVolume / volumeAvg) * 100);

        // Set validUntil based on market condition
        const validUntil = new Date();
        const validityHours = marketCondition === MarketCondition.NEWS_DRIVEN ? 2 :
            marketCondition === MarketCondition.HIGH_VOLATILITY ? 4 : 12;
        validUntil.setHours(validUntil.getHours() + validityHours);

        // Determine which exchanges support this pair
        const availableExchanges = ExchangeAvailability.getAvailableExchanges(pair, marketType);

        const signal: Signal = {
            id,
            marketType,
            signalType,
            direction,
            status: SignalStatus.ACTIVE,
            pair,
            entryPrice,
            currentPrice,
            availableExchanges, // Include exchange availability
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
            isCounterTrend, // Flag counter-trend signals
            // Timeframe information
            timeframe,
            nextCandleTime: this.calculateNextCandleTime(timeframe),
            // Enhanced news integration
            marketCondition,
            newsImpactScore,
            technicalAlignment: TechnicalAlignment.STRONG, // Placeholder - will be properly calculated
            validUntil,
            rationalePoints,
            volumeVsAverage,
            // Technical indicator values for display
            rsi,
            macdValue: macd.macd,
            macdSignal: macd.signal,

            // SPOT Signal Enhancements (only for SPOT signals)
            ...(signalType === SignalType.SPOT ? {
                riskLevel: this.SPOT_PROFILE.riskLevel,
                portfolioAllocation: calculatePortfolioAllocation(confidence),
                holdTimeRecommendation: calculateHoldTime(entryPrice, takeProfit3),
                volumeQuality: calculateVolumeQuality(currentVolume, volumeAvg).score,
                volumeQualityLabel: calculateVolumeQuality(currentVolume, volumeAvg).label,
                coinStability: getCoinStability(pair).score,
                coinStabilityLabel: getCoinStability(pair).label,
                beginnerTip: generateBeginnerTip(
                    direction === SignalDirection.BUY ? 'BUY' : 'SELL',
                    rsi,
                    sentimentScore.overall
                )
            } : {}),

            // Predictive AI Fields
            mlPrediction,
            detectedPatterns,
            timeframeAlignment,
            nextCandlePrediction,
            predictionConsensus
        };

        return signal;
    }

    /**
     * Calculate current RSI from price array (for real-time updates)
     * @param prices Array of prices
     * @returns Current RSI value
     */
    static calculateCurrentRSI(prices: number[]): number | null {
        if (prices.length < 14) return null;
        return TechnicalIndicators.calculateRSI(prices);
    }

    /**
     * Update signal with current price and P/L
     * @param signal Signal to update
     * @param currentPrice Current market price
     * @returns Updated signal
     */
    /**
     * Update signal with current price and P/L.
     *
     * HONEST OUTCOME RULES:
     * - TP1/TP2/TP3 are partial milestones only; they never close a signal.
     * - A signal is COMPLETED (a win) only when the FULL take profit is
     *   reached before the stop loss; realised P/L is taken at the TP price.
     * - If the stop loss is reached first the signal is STOPPED and realised
     *   P/L is taken at the SL price.
     * - If neither is reached by expiry the signal is EXPIRED (never a win,
     *   never "completed"); realised P/L is taken at the last price.
     * While ACTIVE, profitLoss remains a live mark at the current price.
     */
    static updateSignal(signal: Signal, currentPrice: number): Signal {
        const isLong = signal.direction === SignalDirection.BUY || signal.direction === SignalDirection.LONG;

        // Track highest and lowest prices reached
        const highestPrice = Math.max(signal.highestPrice || signal.entryPrice, currentPrice);
        const lowestPrice = Math.min(signal.lowestPrice || signal.entryPrice, currentPrice);

        // Check partial TP hits (milestones only)
        let tp1Hit = signal.tp1Hit || false;
        let tp2Hit = signal.tp2Hit || false;
        let tp3Hit = signal.tp3Hit || false;
        let tp1HitTime = signal.tp1HitTime;
        let tp2HitTime = signal.tp2HitTime;
        let tp3HitTime = signal.tp3HitTime;

        let status = signal.status;
        let exitPrice = signal.exitPrice;

        // Only update status if signal is still ACTIVE
        if (status === SignalStatus.ACTIVE) {
            if (isLong) {
                if (signal.takeProfit1 && highestPrice >= signal.takeProfit1 && !tp1Hit) {
                    tp1Hit = true;
                    tp1HitTime = new Date();
                }
                if (signal.takeProfit2 && highestPrice >= signal.takeProfit2 && !tp2Hit) {
                    tp2Hit = true;
                    tp2HitTime = new Date();
                }
                if (signal.takeProfit3 && highestPrice >= signal.takeProfit3 && !tp3Hit) {
                    tp3Hit = true;
                    tp3HitTime = new Date();
                }

                // Stop loss is checked first: if both were touched inside the
                // same update window the conservative (losing) outcome is kept.
                if (lowestPrice <= signal.stopLoss) {
                    status = SignalStatus.STOPPED;
                    exitPrice = signal.stopLoss;
                } else if (highestPrice >= signal.takeProfit) {
                    status = SignalStatus.COMPLETED;
                    exitPrice = signal.takeProfit;
                }
            } else {
                if (signal.takeProfit1 && lowestPrice <= signal.takeProfit1 && !tp1Hit) {
                    tp1Hit = true;
                    tp1HitTime = new Date();
                }
                if (signal.takeProfit2 && lowestPrice <= signal.takeProfit2 && !tp2Hit) {
                    tp2Hit = true;
                    tp2HitTime = new Date();
                }
                if (signal.takeProfit3 && lowestPrice <= signal.takeProfit3 && !tp3Hit) {
                    tp3Hit = true;
                    tp3HitTime = new Date();
                }

                if (highestPrice >= signal.stopLoss) {
                    status = SignalStatus.STOPPED;
                    exitPrice = signal.stopLoss;
                } else if (lowestPrice <= signal.takeProfit) {
                    status = SignalStatus.COMPLETED;
                    exitPrice = signal.takeProfit;
                }
            }

            // Expiry without TP or SL: EXPIRED, exited at the last price.
            if (status === SignalStatus.ACTIVE && signal.expiresAt && new Date() > signal.expiresAt) {
                status = SignalStatus.EXPIRED;
                exitPrice = currentPrice;
            }
        }

        // Realised P/L at the exit price once closed; live mark while active.
        const effectivePrice = status === SignalStatus.ACTIVE ? currentPrice : (exitPrice ?? currentPrice);
        const profitLoss = isLong
            ? effectivePrice - signal.entryPrice
            : signal.entryPrice - effectivePrice;
        const profitLossPercentage = (profitLoss / signal.entryPrice) * 100;

        return {
            ...signal,
            currentPrice,
            highestPrice,
            lowestPrice,
            tp1Hit,
            tp2Hit,
            tp3Hit,
            tp1HitTime,
            tp2HitTime,
            tp3HitTime,
            exitPrice,
            profitLoss,
            profitLossPercentage,
            status
            // currentRsi is preserved from signal (updated externally by price monitoring)
        };
    }

    /**
     * Generate multiple signals for different pairs
     * Enhanced with parallel processing for faster loading
     * @param pairs Array of pairs to analyze
     * @param signalType Type of signals to generate
     * @param timeframe Candlestick timeframe for the signals
     * @returns Array of generated signals
     */
    static async generateMultipleSignals(
        marketDataList: MarketData[],
        signalType: SignalType,
        timeframe: Timeframe = Timeframe.ONE_HOUR,
        rules: EngineRuleSwitches = DEFAULT_RULES
    ): Promise<Signal[]> {
        // Use Promise.allSettled for parallel processing
        // This allows all signals to generate simultaneously instead of one-by-one
        const results = await Promise.allSettled(
            marketDataList.map(marketData =>
                this.generateSignal(marketData, signalType, timeframe, rules)
            )
        );

        // Filter successful results and extract signals
        const signals: Signal[] = [];
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                signals.push(result.value);
            } else if (result.status === 'rejected') {
                // Log errors but don't block other signals
                console.error('Signal generation failed for pair:', result.reason);
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
        const expiredSignals = signals.filter(s => s.status === SignalStatus.EXPIRED);

        // Honest accounting: a "success" is only a COMPLETED signal, which by
        // construction means the FULL take profit was reached before the stop.
        // EXPIRED signals are neither wins nor losses and are excluded from
        // the accuracy rate.
        const successfulSignals = completedSignals.length;
        const failedSignals = stoppedSignals.length;

        const resolvedSignals = successfulSignals + failedSignals;
        const accuracyRate = resolvedSignals > 0
            ? (successfulSignals / resolvedSignals) * 100
            : 0;

        // Average profit uses realised P/L of closed signals only
        // (COMPLETED at TP, STOPPED at SL, EXPIRED at last price).
        const closedSignals = [...completedSignals, ...stoppedSignals, ...expiredSignals];
        const totalProfit = closedSignals.reduce((sum, s) => sum + (s.profitLossPercentage || 0), 0);
        const averageProfit = closedSignals.length > 0 ? totalProfit / closedSignals.length : 0;

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
     * Calculate when the next candle will close based on timeframe
     * @param timeframe Selected timeframe
     * @returns Date when next candle closes
     */
    private static calculateNextCandleTime(timeframe: Timeframe): Date {
        const now = new Date();
        const nextCandle = new Date(now);

        switch (timeframe) {
            case Timeframe.ONE_MINUTE:
                nextCandle.setMinutes(now.getMinutes() + 1, 0, 0);
                break;
            case Timeframe.FIVE_MINUTES:
                const nextFive = Math.ceil(now.getMinutes() / 5) * 5;
                nextCandle.setMinutes(nextFive, 0, 0);
                break;
            case Timeframe.FIFTEEN_MINUTES:
                const nextFifteen = Math.ceil(now.getMinutes() / 15) * 15;
                nextCandle.setMinutes(nextFifteen, 0, 0);
                break;
            case Timeframe.ONE_HOUR:
                nextCandle.setHours(now.getHours() + 1, 0, 0, 0);
                break;
            case Timeframe.FOUR_HOURS:
                const nextFourHour = Math.ceil(now.getHours() / 4) * 4;
                nextCandle.setHours(nextFourHour, 0, 0, 0);
                break;
            case Timeframe.ONE_DAY:
                nextCandle.setDate(now.getDate() + 1);
                nextCandle.setHours(0, 0, 0, 0);
                break;
        }

        return nextCandle;
    }
}
