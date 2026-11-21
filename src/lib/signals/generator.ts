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
import { NewsAnalyzer } from './newsAnalyzer';
import { AdvancedMarketAnalyzer, MarketAnalysis } from './advancedAnalyzer';
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
        timeframe: Timeframe = Timeframe.ONE_HOUR
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

        // HYBRID STRATEGY: Calculate Momentum & ROC
        const momentum = this.calculateMomentum(prices, 10);
        const roc = this.calculateROC(prices, 10);

        // Signal scoring system (HYBRID APPROACH)
        let buyScore = 0;
        let sellScore = 0;

        // === MEAN REVERSION SIGNALS (Reversal Trading) ===

        // RSI Analysis with Momentum Confirmation
        if (rsi < 30 && momentum > -1.5) {
            // Oversold + momentum slowing = SAFE reversal entry
            buyScore += 25;
        } else if (rsi < 40 && momentum > 0) {
            // Slightly oversold + momentum turning positive
            buyScore += 15;
        } else if (rsi > 70) {
            // Overbought = potential reversal SHORT
            sellScore += 25;
        } else if (rsi > 60 && momentum < 0) {
            // Slightly overbought + momentum turning negative
            sellScore += 15;
        }

        // === MOMENTUM TRADING SIGNALS (Trend Following) ===

        // Strong Downtrend Detection
        if (momentum < -2 && roc < -3) {
            // Strong bearish momentum = Follow with SHORT
            sellScore += 25;
        } else if (momentum < -1 && roc < -2) {
            // Moderate bearish momentum
            sellScore += 15;
        }

        // Strong Uptrend Detection
        if (momentum > 2 && roc > 3) {
            // Strong bullish momentum = Follow with LONG
            buyScore += 25;
        } else if (momentum > 1 && roc > 2) {
            // Moderate bullish momentum
            buyScore += 15;
        }

        // MACD Analysis (works for both strategies)
        if (macd.histogram > 0 && macd.macd > macd.signal) buyScore += 20;
        else if (macd.histogram < 0 && macd.macd < macd.signal) sellScore += 20;

        // Bollinger Bands Analysis
        if (currentPrice <= bollingerBands.lower && momentum > -1) {
            // At lower band + momentum not accelerating down = SAFE reversal
            buyScore += 20;
        } else if (currentPrice >= bollingerBands.upper) {
            // At upper band = potential SHORT
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
        // If strong downward momentum, DON'T give reversal LONG signals
        if (momentum < -2.5 && roc < -4) {
            // Falling knife detected - remove reversal buy signals
            if (rsi < 40) {
                buyScore = Math.max(0, buyScore - 30); // Reduce buy score significantly
            }
        }

        // If strong upward momentum, DON'T give reversal SHORT signals (SYMMETRIC CHECK)
        if (momentum > 2.5 && roc > 4) {
            // Rising rocket detected - remove reversal sell signals
            if (rsi > 60) {
                sellScore = Math.max(0, sellScore - 30); // Reduce sell score significantly
            }
        }

        // Determine if signal is strong enough
        // Balanced thresholds for quality signals (10-15 per generation)
        // Moderate increase for better accuracy without over-filtering
        const BUY_THRESHOLD = 58;   // Balanced: not too strict, not too loose
        const SELL_THRESHOLD = 58;  // Equal treatment for both directions
        let direction: SignalDirection | null = null;
        let technicalConfidence = 0;

        // PULLBACK CONFIRMATION: Check if price has pulled back from recent high
        // This prevents buying at local tops
        const recentHighs = prices.slice(-10); // Last 10 candles
        const recentHigh = Math.max(...recentHighs);
        const pullbackPercent = ((recentHigh - currentPrice) / recentHigh) * 100;

        // For LONG/BUY: require 0.5-1.5% pullback from recent high
        const hasPullback = pullbackPercent >= 0.5 && pullbackPercent <= 1.5;

        if (buyScore >= BUY_THRESHOLD && buyScore > sellScore) {
            // LONG/BUY signals require pullback confirmation
            if (hasPullback) {
                direction = signalType === SignalType.FUTURE ? SignalDirection.LONG : SignalDirection.BUY;
                technicalConfidence = Math.min(buyScore, 100);
            } else {
                // Skip signal - price at or near local top
                return null;
            }
        } else if (sellScore >= SELL_THRESHOLD && sellScore > buyScore) {
            // SPOT: Skip SELL signals (only BUY makes sense in spot trading)
            if (signalType === SignalType.SPOT) {
                return null; // No SELL signals for SPOT
            }
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

        // === NEWS (DISPLAY ONLY) ===
        // News impact and sentiment are still collected for display on the
        // signal card, but they NO LONGER influence confidence, issuance, or
        // TP/SL levels in any way. When no real news source is configured the
        // values are neutral (score 0) - simulated news was removed.
        const newsImpact = await NewsAnalyzer.getNewsImpactAssessment(pair);
        const newsImpactScore = newsImpact.score; // -5 to +5

        const technicalScore = (direction === SignalDirection.BUY || direction === SignalDirection.LONG) ? buyScore : sellScore;
        const sentimentScore = await NewsAnalyzer.calculateSentimentScore(pair, technicalScore);

        // Confidence IS the technical confidence (raw score capped at 100).
        // Issuance below is therefore decided by technicals alone.
        const confidence = Math.round(Math.max(0, Math.min(100, technicalConfidence)));

        // Counter-trend signals require a stronger technical score.
        // (Was 80 on the old sentiment-blended scale; on the pure technical
        // scale the observed maximum is ~80, so 70 keeps a real premium over
        // the 58 base gate without being a de-facto ban.)
        if (isCounterTrend && confidence < 70) {
            return null; // Reject weak counter-trend signals (higher risk)
        }

        // Profile-based confidence threshold (technical score only)
        const profile = signalType === SignalType.SPOT ? this.SPOT_PROFILE : this.FUTURES_PROFILE;
        if (confidence < profile.minConfidence) {
            return null; // Signal doesn't meet quality threshold for this type
        }

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

        // Calculate entry, stop loss, and take profit with improved logic
        const entryPrice = currentPrice;
        let stopLoss: number;
        let takeProfit: number;

        // Calculate ATR (true range) for volatility-based targets
        const atr = this.calculateATR(prices, marketData.highs, marketData.lows);

        // Multipliers depend on confidence only - sentiment never moves levels.
        // Higher confidence = wider TP, tighter SL
        const confidenceMultiplier = confidence / 100;

        if (direction === SignalDirection.BUY || direction === SignalDirection.LONG) {
            // For buy signals
            // Stop loss: tighter for high confidence
            const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
            stopLoss = entryPrice - (atr * slMultiplier);

            // Take profit target
            const tpMultiplier = 3.5 + (confidenceMultiplier * 2.5);
            takeProfit = entryPrice + (atr * tpMultiplier);

            // Adjust stop based on Bollinger Bands
            if (stopLoss > bollingerBands.lower) {
                stopLoss = bollingerBands.lower * 0.995;
            }
        } else {
            // For sell signals
            // Stop loss: tighter for high confidence
            const slMultiplier = 1.5 - (confidenceMultiplier * 0.3);
            stopLoss = entryPrice + (atr * slMultiplier);

            // Take profit target
            const tpMultiplier = 3.5 + (confidenceMultiplier * 2.5);
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

        if (direction === SignalDirection.BUY || direction === SignalDirection.LONG) {
            // For LONG/BUY: TP1 at 25%, TP2 at 65%, TP3 at 85% of the move (OPTIMIZED)
            let tpDistance = takeProfit - entryPrice;

            // Ensure minimum distance (at least 0.5% of entry price)
            const minDistance = entryPrice * 0.005; // 0.5% minimum
            if (tpDistance < minDistance) {
                tpDistance = minDistance;
                takeProfit = entryPrice + tpDistance; // Adjust main TP as well
            }

            takeProfit1 = entryPrice + (tpDistance * 0.25); // 25% of move (realistic first target)
            takeProfit2 = entryPrice + (tpDistance * 0.65); // 65% of move (solid profit)
            takeProfit3 = entryPrice + (tpDistance * 0.85); // 85% (achievable final target)
        } else {
            // For SHORT/SELL: TP1 at 25%, TP2 at 65%, TP3 at 85% of the move (OPTIMIZED)
            let tpDistance = entryPrice - takeProfit;

            // Ensure minimum distance (at least 0.5% of entry price)
            const minDistance = entryPrice * 0.005; // 0.5% minimum
            if (tpDistance < minDistance) {
                tpDistance = minDistance;
                takeProfit = entryPrice - tpDistance; // Adjust main TP as well
            }

            takeProfit1 = entryPrice - (tpDistance * 0.25); // 25% of move (realistic first target)
            takeProfit2 = entryPrice - (tpDistance * 0.65); // 65% of move (solid profit)
            takeProfit3 = entryPrice - (tpDistance * 0.85); // 85% (achievable final target)

        }

        // Final validation: Ensure all prices are valid before creating signal
        const pricesToValidate = [entryPrice, stopLoss, takeProfit, takeProfit1, takeProfit2, takeProfit3];
        const hasInvalidPrice = pricesToValidate.some(p => !p || isNaN(p) || !isFinite(p) || p <= 0);

        if (hasInvalidPrice) {
            console.error(`⚠️ Skipping ${pair} - invalid TP/SL prices detected`);
            return null;
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
     * Calculate ATR (Average True Range) for stop loss/take profit.
     *
     * Uses the TRUE RANGE of each candle:
     *   TR = max(high - low, |high - prevClose|, |low - prevClose|)
     * The previous implementation used only |close - prevClose|, which
     * ignores intra-candle ranges and produced noise-tight stops.
     * When candle highs/lows are unavailable (e.g. forex feed), it falls
     * back to the close-to-close change.
     * @param prices Array of closing prices
     * @param highs Optional array of candle highs (same order as prices)
     * @param lows Optional array of candle lows (same order as prices)
     * @param period Period for ATR calculation
     * @returns ATR value
     */
    private static calculateATR(
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
     * Calculate Momentum (rate of price change)
     * @param prices Array of prices
     * @param period Period for momentum calculation
     * @returns Momentum value (-5 to +5 scale)
     */
    private static calculateMomentum(prices: number[], period: number = 10): number {
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
     * Calculate current RSI from price array (for real-time updates)
     * @param prices Array of prices
     * @returns Current RSI value
     */
    static calculateCurrentRSI(prices: number[]): number | null {
        if (prices.length < 14) return null;
        return TechnicalIndicators.calculateRSI(prices);
    }

    /**
     * Calculate Rate of Change (ROC)
     * @param prices Array of prices
     * @param period Period for ROC calculation
     * @returns ROC percentage (-100 to +100)
     */
    private static calculateROC(prices: number[], period: number = 10): number {
        if (prices.length < period + 1) return 0;

        const currentPrice = prices[prices.length - 1];
        const oldPrice = prices[prices.length - period - 1];

        return ((currentPrice - oldPrice) / oldPrice) * 100;
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
        timeframe: Timeframe = Timeframe.ONE_HOUR
    ): Promise<Signal[]> {
        // Use Promise.allSettled for parallel processing
        // This allows all signals to generate simultaneously instead of one-by-one
        const results = await Promise.allSettled(
            marketDataList.map(marketData =>
                this.generateSignal(marketData, signalType, timeframe)
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
