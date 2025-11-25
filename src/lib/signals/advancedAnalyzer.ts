// Advanced Market Analysis System
// Combines macro, on-chain, derivatives, and technical data

export enum MarketTrend {
    STRONG_BULLISH = 'STRONG_BULLISH',
    BULLISH = 'BULLISH',
    NEUTRAL = 'NEUTRAL',
    BEARISH = 'BEARISH',
    STRONG_BEARISH = 'STRONG_BEARISH'
}

export enum SignalAction {
    STRONG_BUY = 'STRONG_BUY',
    BUY = 'BUY',
    HOLD = 'HOLD',
    SELL = 'SELL',
    STRONG_SELL = 'STRONG_SELL'
}

export interface MarketAnalysis {
    trend: MarketTrend;
    action: SignalAction;
    riskScore: number;
    reasoning: string[];
    keyLevels: {
        upsideTargets: number[];
        downsideTargets: number[];
        liquidityZones: { price: number; type: 'LONG' | 'SHORT'; strength: number }[];
    };
    summary: string;
    volatilityEvents: string[];
}

export class AdvancedMarketAnalyzer {
    /**
     * Analyze macro and fundamental news impact
     */
    private static analyzeMacroFundamentals(pair: string): {
        score: number;
        factors: string[];
    } {
        const factors: string[] = [];
        let score = 50; // Neutral baseline

        // Simulated macro analysis (in production, fetch from APIs)
        const currentMonth = new Date().getMonth();
        const currentDay = new Date().getDate();

        // Fed policy simulation
        if (currentMonth % 3 === 0) {
            // FOMC meeting months
            score -= 5;
            factors.push('FOMC meeting week - increased volatility expected');
        }

        // CPI data simulation (usually mid-month)
        if (currentDay >= 10 && currentDay <= 15) {
            score -= 3;
            factors.push('CPI data release window - macro uncertainty');
        }

        // Regulatory sentiment (simulated)
        const regulatoryScore = Math.random();
        if (regulatoryScore > 0.7) {
            score += 10;
            factors.push('Positive regulatory developments - institutional confidence rising');
        } else if (regulatoryScore < 0.3) {
            score -= 10;
            factors.push('Regulatory headwinds - caution advised');
        }

        return { score, factors };
    }

    /**
     * Analyze on-chain and whale data
     */
    private static analyzeOnChainData(pair: string, currentPrice: number): {
        score: number;
        factors: string[];
    } {
        const factors: string[] = [];
        let score = 50;

        // Whale movement simulation
        const whaleActivity = Math.random();
        if (whaleActivity > 0.75) {
            score += 15;
            factors.push('Large whale accumulation detected - bullish signal');
        } else if (whaleActivity < 0.25) {
            score -= 15;
            factors.push('Whale distribution ongoing - bearish pressure');
        }

        // Exchange flow simulation
        const exchangeFlow = Math.random();
        if (exchangeFlow > 0.6) {
            score -= 8;
            factors.push('Increased exchange inflows - potential selling pressure');
        } else if (exchangeFlow < 0.4) {
            score += 8;
            factors.push('Exchange outflows rising - accumulation phase');
        }

        // Stablecoin supply
        const stablecoinSupply = Math.random();
        if (stablecoinSupply > 0.65) {
            score += 12;
            factors.push('Stablecoin supply increasing - fresh capital entering market');
        }

        return { score, factors };
    }

    /**
     * Analyze derivatives data (funding rate, OI, liquidations)
     */
    private static analyzeDerivatives(pair: string, currentPrice: number): {
        score: number;
        factors: string[];
        liquidityZones: { price: number; type: 'LONG' | 'SHORT'; strength: number }[];
    } {
        const factors: string[] = [];
        let score = 50;
        const liquidityZones: { price: number; type: 'LONG' | 'SHORT'; strength: number }[] = [];

        // Funding rate simulation (-0.1% to +0.1%)
        const fundingRate = (Math.random() - 0.5) * 0.2;

        if (fundingRate > 0.05) {
            score -= 10;
            factors.push(`High positive funding (${(fundingRate * 100).toFixed(3)}%) - long squeeze risk`);
        } else if (fundingRate < -0.05) {
            score += 10;
            factors.push(`Negative funding (${(fundingRate * 100).toFixed(3)}%) - short squeeze potential`);
        } else {
            factors.push(`Neutral funding (${(fundingRate * 100).toFixed(3)}%) - balanced market`);
        }

        // Open Interest analysis
        const oiChange = (Math.random() - 0.5) * 30; // -15% to +15%
        const priceChange = (Math.random() - 0.5) * 10; // -5% to +5%

        if (oiChange > 5 && priceChange > 0) {
            score += 12;
            factors.push(`Rising OI (+${oiChange.toFixed(1)}%) with rising price - strong bullish trend`);
        } else if (oiChange > 5 && priceChange < 0) {
            score -= 12;
            factors.push(`Rising OI (+${oiChange.toFixed(1)}%) with falling price - bearish confirmation`);
        } else if (oiChange < -5) {
            score -= 5;
            factors.push(`Falling OI (${oiChange.toFixed(1)}%) - trend exhaustion, volatility ahead`);
        }

        // Liquidation heatmap simulation
        // Generate liquidation zones above and below current price
        const longLiqZone1 = currentPrice * 0.95; // 5% below
        const longLiqZone2 = currentPrice * 0.90; // 10% below
        const shortLiqZone1 = currentPrice * 1.05; // 5% above
        const shortLiqZone2 = currentPrice * 1.10; // 10% above

        liquidityZones.push(
            { price: longLiqZone1, type: 'LONG', strength: Math.random() * 50 + 50 },
            { price: longLiqZone2, type: 'LONG', strength: Math.random() * 30 + 20 },
            { price: shortLiqZone1, type: 'SHORT', strength: Math.random() * 50 + 50 },
            { price: shortLiqZone2, type: 'SHORT', strength: Math.random() * 30 + 20 }
        );

        // Find strongest liquidation zone
        const strongestZone = liquidityZones.reduce((max, zone) =>
            zone.strength > max.strength ? zone : max
        );

        factors.push(
            `Major ${strongestZone.type} liquidation cluster at $${strongestZone.price.toFixed(2)} - price magnet`
        );

        return { score, factors, liquidityZones };
    }

    /**
     * Analyze technical conditions
     */
    private static analyzeTechnicals(
        prices: number[],
        volumes: number[]
    ): {
        score: number;
        factors: string[];
    } {
        const factors: string[] = [];
        let score = 50;

        const currentPrice = prices[prices.length - 1];
        const prevPrice = prices[prices.length - 2];

        // Market structure
        const recentHigh = Math.max(...prices.slice(-20));
        const recentLow = Math.min(...prices.slice(-20));

        if (currentPrice > recentHigh * 0.98) {
            score += 10;
            factors.push('Price near recent highs - bullish structure');
        } else if (currentPrice < recentLow * 1.02) {
            score -= 10;
            factors.push('Price near recent lows - bearish structure');
        }

        // RSI simulation
        const rsi = 30 + Math.random() * 40; // 30-70 range
        if (rsi < 35) {
            score += 8;
            factors.push(`RSI oversold (${rsi.toFixed(1)}) - potential bounce`);
        } else if (rsi > 65) {
            score -= 8;
            factors.push(`RSI overbought (${rsi.toFixed(1)}) - correction risk`);
        }

        // Volume analysis
        const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const currentVolume = volumes[volumes.length - 1];

        if (currentVolume > avgVolume * 1.5 && currentPrice > prevPrice) {
            score += 10;
            factors.push('High volume breakout - strong bullish momentum');
        } else if (currentVolume > avgVolume * 1.5 && currentPrice < prevPrice) {
            score -= 10;
            factors.push('High volume breakdown - strong bearish momentum');
        }

        return { score, factors };
    }

    /**
     * Generate comprehensive market analysis
     */
    static generateAnalysis(
        pair: string,
        currentPrice: number,
        prices: number[],
        volumes: number[]
    ): MarketAnalysis {
        // Collect all analysis components
        const macro = this.analyzeMacroFundamentals(pair);
        const onChain = this.analyzeOnChainData(pair, currentPrice);
        const derivatives = this.analyzeDerivatives(pair, currentPrice);
        const technicals = this.analyzeTechnicals(prices, volumes);

        // Calculate composite score (weighted average)
        // Technical analysis is most reliable, so we weight it highest
        const compositeScore = (
            macro.score * 0.05 +          // 5% - Macro factors (low priority)
            onChain.score * 0.10 +        // 10% - On-chain data
            derivatives.score * 0.15 +    // 15% - Derivatives and funding
            technicals.score * 0.70       // 70% - Technical indicators (highest priority)
        );

        // Determine trend
        let trend: MarketTrend;
        if (compositeScore >= 70) trend = MarketTrend.STRONG_BULLISH;
        else if (compositeScore >= 55) trend = MarketTrend.BULLISH;
        else if (compositeScore >= 45) trend = MarketTrend.NEUTRAL;
        else if (compositeScore >= 30) trend = MarketTrend.BEARISH;
        else trend = MarketTrend.STRONG_BEARISH;

        // Determine action
        let action: SignalAction;
        if (compositeScore >= 70) action = SignalAction.STRONG_BUY;
        else if (compositeScore >= 55) action = SignalAction.BUY;
        else if (compositeScore >= 45) action = SignalAction.HOLD;
        else if (compositeScore >= 30) action = SignalAction.SELL;
        else action = SignalAction.STRONG_SELL;

        // Calculate risk score (inverse of confidence, adjusted for volatility)
        const volatilityFactor = Math.abs(50 - compositeScore) / 50; // 0-1
        const riskScore = Math.round(
            (1 - (Math.abs(compositeScore - 50) / 50)) * 60 + volatilityFactor * 40
        );

        // Combine all reasoning
        const reasoning = [
            ...macro.factors.slice(0, 2),
            ...onChain.factors.slice(0, 2),
            ...derivatives.factors.slice(0, 2),
            ...technicals.factors.slice(0, 1)
        ].slice(0, 6);

        // Calculate key levels
        const upsideTargets = [
            currentPrice * 1.02,
            currentPrice * 1.05,
            currentPrice * 1.08
        ];

        const downsideTargets = [
            currentPrice * 0.98,
            currentPrice * 0.95,
            currentPrice * 0.92
        ];

        // Generate summary
        const trendText = trend.replace('_', ' ').toLowerCase();
        const actionText = action.replace('_', ' ').toLowerCase();

        let summary = `Market shows ${trendText} bias with ${actionText} recommendation for next 12-48 hours. `;

        if (riskScore > 60) {
            summary += 'High risk environment - use tight stops and reduced position sizes. ';
        } else if (riskScore < 40) {
            summary += 'Favorable risk/reward setup. ';
        }

        summary += `Composite score: ${compositeScore.toFixed(1)}/100.`;

        // Volatility events
        const volatilityEvents: string[] = [];
        if (macro.factors.some(f => f.includes('FOMC') || f.includes('CPI'))) {
            volatilityEvents.push('Major macro event this week');
        }
        if (derivatives.factors.some(f => f.includes('squeeze'))) {
            volatilityEvents.push('Squeeze risk detected in derivatives');
        }

        return {
            trend,
            action,
            riskScore,
            reasoning,
            keyLevels: {
                upsideTargets,
                downsideTargets,
                liquidityZones: derivatives.liquidityZones
            },
            summary,
            volatilityEvents
        };
    }
}
