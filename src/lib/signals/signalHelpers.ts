// Signal Generation Helper Functions
// Market condition determination and rationale generation

import { SignalDirection, MarketCondition, TechnicalAlignment } from './types';
import { NewsEvent } from './newsTypes';

export class SignalHelpers {
    /**
     * Determine market condition based on news, volume, and trend
     */
    static determineMarketCondition(
        newsImpactScore: number,
        currentVolume: number,
        volumeAverage: number,
        marketTrend: string
    ): MarketCondition {
        // High volume with strong news = News driven
        if (Math.abs(newsImpactScore) >= 3 && currentVolume > volumeAverage * 1.5) {
            return MarketCondition.NEWS_DRIVEN;
        }

        // High volume without strong news = High volatility
        if (currentVolume > volumeAverage * 2) {
            return MarketCondition.HIGH_VOLATILITY;
        }

        // Strong trend = Trending
        if (marketTrend === 'STRONG_BULLISH' || marketTrend === 'STRONG_BEARISH') {
            return MarketCondition.TRENDING;
        }

        // Low volume with neutral trend = Ranging
        if (currentVolume < volumeAverage * 0.8 && marketTrend === 'NEUTRAL') {
            return MarketCondition.RANGING;
        }

        // Default to trending if moderate trend exists
        if (marketTrend === 'BULLISH' || marketTrend === 'BEARISH') {
            return MarketCondition.TRENDING;
        }

        return MarketCondition.RANGING;
    }

    /**
     * Generate 3-bullet rationale combining news, technicals, and volume
     */
    static generateRationale(
        newsCatalyst: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH',
        recentNews: NewsEvent[],
        rsi: number,
        macd: { macd: number; signal: number; histogram: number },
        currentVolume: number,
        volumeAverage: number,
        direction: SignalDirection,
        technicalAlignment: TechnicalAlignment
    ): string[] {
        const rationale: string[] = [];

        // 1. News Catalyst
        if (newsCatalyst !== 'NEUTRAL' && recentNews.length > 0) {
            const topNews = recentNews[0];
            const catalystText = newsCatalyst.replace('_', ' ').toLowerCase();
            rationale.push(`News Catalyst: "${topNews.title}" (${catalystText} sentiment from ${topNews.source})`);
        } else {
            rationale.push(`Market condition: ${newsCatalyst.toLowerCase().replace('_', ' ')} with minimal recent news impact`);
        }

        // 2. Technical Confirmation
        const isBullish = direction === SignalDirection.BUY || direction === SignalDirection.LONG;
        const macdStatus = macd.macd > macd.signal ? 'bullish' : 'bearish';
        const rsiStatus = rsi > 65 ? 'overbought' : rsi < 35 ? 'oversold' : 'neutral';
        const alignmentText = technicalAlignment.toLowerCase();

        rationale.push(
            `Technical: RSI at ${rsi.toFixed(1)} (${rsiStatus}), MACD ${macdStatus} crossover - ${alignmentText} ${isBullish ? 'buy' : 'sell'} signal`
        );

        // 3. Volume/Momentum Analysis
        const volumePercent = Math.round((currentVolume / volumeAverage) * 100);
        const volumeText = volumePercent > 130 ? 'strong buying pressure' : volumePercent > 100 ? 'above-average' : 'moderate';

        rationale.push(
            `Volume: ${volumePercent}% of average - ${volumeText} supporting the move`
        );

        return rationale;
    }
}
