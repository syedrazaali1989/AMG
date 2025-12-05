// SPOT Signal Enhancement Helper Functions

/**
 * Calculate portfolio allocation recommendation based on confidence
 * @param confidence Signal confidence percentage
 * @returns Portfolio allocation string
 */
export function calculatePortfolioAllocation(confidence: number): string {
    if (confidence >= 86) return "10-15%";
    if (confidence >= 76) return "8-12%";
    if (confidence >= 66) return "5-8%";
    return "3-5%";
}

/**
 * Calculate hold time recommendation based on TP distance
 * @param entryPrice Entry price
 * @param tp3Price TP3 target price
 * @returns Hold time recommendation string
 */
export function calculateHoldTime(entryPrice: number, tp3Price: number): string {
    const tpDistance = Math.abs((tp3Price - entryPrice) / entryPrice) * 100;

    if (tpDistance > 15) return "1-2 weeks";
    if (tpDistance > 10) return "5-10 days";
    if (tpDistance > 5) return "2-5 days";
    return "1-2 days";
}

/**
 * Calculate volume quality score
 * @param currentVolume Current volume
 * @param avgVolume Average volume
 * @returns Object with quality score (1-5) and label
 */
export function calculateVolumeQuality(currentVolume: number, avgVolume: number): { score: number; label: string } {
    const ratio = currentVolume / avgVolume;

    if (ratio > 3) return { score: 5, label: "Excellent" };
    if (ratio > 2) return { score: 4, label: "Very Good" };
    if (ratio > 1.5) return { score: 3, label: "Good" };
    if (ratio > 1) return { score: 2, label: "Fair" };
    return { score: 1, label: "Low" };
}

/**
 * Get coin stability rating based on pair
 * @param pair Trading pair (e.g., "BTC/USDT")
 * @returns Object with stability score (1-5) and label
 */
export function getCoinStability(pair: string): { score: number; label: string } {
    const coin = pair.split('/')[0].toUpperCase();

    // Tier 1: Most Stable (Blue chips)
    if (['BTC', 'ETH'].includes(coin)) {
        return { score: 5, label: "Most Stable" };
    }

    // Tier 2: Stable (Top 10)
    if (['BNB', 'SOL', 'ADA', 'XRP'].includes(coin)) {
        return { score: 4, label: "Stable" };
    }

    // Tier 3: Moderate (Top 50)
    if (['MATIC', 'DOT', 'LINK', 'UNI', 'AVAX', 'LTC', 'ATOM'].includes(coin)) {
        return { score: 3, label: "Moderate" };
    }

    // Tier 4: Volatile (Meme/Small caps)
    if (['DOGE', 'SHIB', 'APE', 'SAND', 'MANA'].includes(coin)) {
        return { score: 2, label: "Volatile" };
    }

    // Tier 5: High Risk (Unknown/New)
    return { score: 1, label: "High Risk" };
}

/**
 * Generate beginner-friendly tip based on signal context
 * @param direction Signal direction
 * @param rsi RSI value
 * @param sentimentScore Sentiment score
 * @returns Beginner tip string
 */
export function generateBeginnerTip(
    direction: string,
    rsi: number,
    sentimentScore: number
): string {
    // For BUY signals
    if (direction === 'BUY' || direction === 'LONG') {
        if (rsi < 30) {
            return "💡 Buying at oversold (RSI<30) levels offers safer reversal entry. Market is likely to bounce back.";
        }
        if (sentimentScore > 50) {
            return "💡 Strong positive news supports this entry. Bullish sentiment often drives price up in SPOT trading.";
        }
        if (rsi >= 30 && rsi < 40) {
            return "💡 Entry near support levels. Set stop loss and be patient - SPOT trades can take time to reach profit.";
        }
        return "💡 This is a buy-and-hold signal. SPOT trading rewards patience - avoid panic selling on small dips.";
    }

    // For SELL signals (shouldn't happen in SPOT but keep for completeness)
    return "💡 Remember: Exit happens automatically when TP is hit. No manual selling needed!";
}
