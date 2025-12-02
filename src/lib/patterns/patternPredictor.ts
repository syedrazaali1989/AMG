// Pattern-Based Prediction Logic
// Uses historical pattern success rates to predict next candle movement

import { CandlestickPattern, NextCandlePrediction } from '../signals/types';
import { CandlestickPatternDetector } from './candlestickPatterns';

export class PatternPredictor {
    /**
     * Generate next candle prediction based on detected patterns
     * @param patterns Detected candlestick patterns
     * @param currentPrice Current market price
     * @param avgRange Average price range (for target calculation)
     * @returns Next candle prediction
     */
    static predictNextCandle(
        patterns: CandlestickPattern[],
        currentPrice: number,
        avgRange: number
    ): NextCandlePrediction | null {
        if (patterns.length === 0) return null;

        // Calculate weighted probabilities from all patterns
        let bullishScore = 0;
        let bearishScore = 0;
        let totalWeight = 0;

        const predictionSources: string[] = [];

        for (const pattern of patterns) {
            const weight = (pattern.strength / 100) * (pattern.reliability / 100);
            totalWeight += weight;

            if (pattern.sentiment === 'BULLISH') {
                bullishScore += weight;
                predictionSources.push(`${pattern.name} (Bullish ${pattern.reliability}%)`);
            } else if (pattern.sentiment === 'BEARISH') {
                bearishScore += weight;
                predictionSources.push(`${pattern.name} (Bearish ${pattern.reliability}%)`);
            }
        }

        // Normalize to percentages
        const bullishProbability = totalWeight > 0 ? Math.round((bullishScore / totalWeight) * 100) : 50;
        const bearishProbability = totalWeight > 0 ? Math.round((bearishScore / totalWeight) * 100) : 50;
        const neutralProbability = Math.max(0, 100 - bullishProbability - bearishProbability);

        // Calculate expected price targets
        const strongestPattern = this.getStrongestPattern(patterns);
        const expectedMove = avgRange * 0.5; // Expect 50% of average range movement

        let expectedHigh = currentPrice;
        let expectedLow = currentPrice;
        let expectedClose = currentPrice;

        if (strongestPattern) {
            if (strongestPattern.sentiment === 'BULLISH') {
                expectedHigh = currentPrice + expectedMove;
                expectedLow = currentPrice - (expectedMove * 0.3);
                expectedClose = strongestPattern.priceTarget || (currentPrice + expectedMove * 0.7);
            } else if (strongestPattern.sentiment === 'BEARISH') {
                expectedHigh = currentPrice + (expectedMove * 0.3);
                expectedLow = currentPrice - expectedMove;
                expectedClose = strongestPattern.priceTarget || (currentPrice - expectedMove * 0.7);
            }
        }

        // Determine confidence level
        const dominantProb = Math.max(bullishProbability, bearishProbability, neutralProbability);
        let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
        if (dominantProb >= 70) confidenceLevel = 'HIGH';
        else if (dominantProb >= 55) confidenceLevel = 'MEDIUM';
        else confidenceLevel = 'LOW';

        // Check for volatility expansion (multiple strong patterns)
        const volatilityExpansion = patterns.filter(p => p.strength > 70).length >= 2;

        // Check for breakout likelihood
        const reversalPatterns = patterns.filter(p => p.expectedOutcome === 'REVERSAL');
        const breakoutLikely = reversalPatterns.length > 0 && dominantProb > 65;
        const breakoutDirection = bullishProbability > bearishProbability ? 'UP' as const : 'DOWN' as const;

        return {
            bullishProbability,
            bearishProbability,
            neutralProbability,
            expectedHigh,
            expectedLow,
            expectedClose,
            volatilityExpansion,
            breakoutLikely,
            breakoutDirection: breakoutLikely ? breakoutDirection : undefined,
            confidenceLevel,
            predictionSources
        };
    }

    /**
     * Get the strongest pattern from detected patterns
     */
    private static getStrongestPattern(patterns: CandlestickPattern[]): CandlestickPattern | null {
        if (patterns.length === 0) return null;

        return patterns.reduce((strongest, current) => {
            const currentScore = current.strength * current.reliability;
            const strongestScore = strongest.strength * strongest.reliability;
            return currentScore > strongestScore ? current : strongest;
        });
    }

    /**
     * Combine pattern prediction with technical indicators
     * @param patternPrediction Pattern-based prediction
     * @param technicalBias Technical indicator bias ('BULLISH' | 'BEARISH' | 'NEUTRAL')
     * @param technicalConfidence Confidence from technicals (0-100)
     * @returns Enhanced prediction
     */
    static combineWithTechnicals(
        patternPrediction: NextCandlePrediction,
        technicalBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        technicalConfidence: number
    ): NextCandlePrediction {
        // Weight: 60% patterns, 40% technicals
        const patternWeight = 0.6;
        const technicalWeight = 0.4;

        let technicalBullish = 0;
        let technicalBearish = 0;

        if (technicalBias === 'BULLISH') {
            technicalBullish = technicalConfidence;
        } else if (technicalBias === 'BEARISH') {
            technicalBearish = technicalConfidence;
        } else {
            technicalBullish = 50;
            technicalBearish = 50;
        }

        // Combine probabilities
        const bullishProbability = Math.round(
            (patternPrediction.bullishProbability * patternWeight) +
            (technicalBullish * technicalWeight)
        );

        const bearishProbability = Math.round(
            (patternPrediction.bearishProbability * patternWeight) +
            (technicalBearish * technicalWeight)
        );

        const neutralProbability = Math.max(0, 100 - bullishProbability - bearishProbability);

        // Add technical source to prediction sources
        const predictionSources = [
            ...patternPrediction.predictionSources,
            `Technical Analysis (${technicalBias} ${technicalConfidence}%)`
        ];

        // Recalculate confidence level
        const dominantProb = Math.max(bullishProbability, bearishProbability);
        let confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
        if (dominantProb >= 70) confidenceLevel = 'HIGH';
        else if (dominantProb >= 55) confidenceLevel = 'MEDIUM';
        else confidenceLevel = 'LOW';

        return {
            ...patternPrediction,
            bullishProbability,
            bearishProbability,
            neutralProbability,
            confidenceLevel,
            predictionSources,
            breakoutDirection: bullishProbability > bearishProbability ? 'UP' : 'DOWN'
        };
    }

    /**
     * Calculate pattern-based support/resistance levels
     */
    static calculatePatternLevels(
        patterns: CandlestickPattern[],
        currentPrice: number
    ): { support: number[]; resistance: number[] } {
        const support: number[] = [];
        const resistance: number[] = [];

        for (const pattern of patterns) {
            if (pattern.priceTarget) {
                if (pattern.sentiment === 'BULLISH' && pattern.priceTarget > currentPrice) {
                    resistance.push(pattern.priceTarget);
                } else if (pattern.sentiment === 'BEARISH' && pattern.priceTarget < currentPrice) {
                    support.push(pattern.priceTarget);
                }
            }
        }

        return {
            support: support.sort((a, b) => b - a), // Descending
            resistance: resistance.sort((a, b) => a - b) // Ascending
        };
    }
}
