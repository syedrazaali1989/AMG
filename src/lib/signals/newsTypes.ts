// News and Sentiment Analysis Types

export enum NewsSentiment {
    VERY_BULLISH = 'VERY_BULLISH',
    BULLISH = 'BULLISH',
    NEUTRAL = 'NEUTRAL',
    BEARISH = 'BEARISH',
    VERY_BEARISH = 'VERY_BEARISH'
}

export enum NewsCategory {
    REGULATORY = 'REGULATORY',           // Government regulations, bans, approvals
    ECONOMIC = 'ECONOMIC',               // Employment data, GDP, inflation
    GEOPOLITICAL = 'GEOPOLITICAL',       // US-China relations, wars, sanctions
    ADOPTION = 'ADOPTION',               // Institutional adoption, partnerships
    TECHNICAL = 'TECHNICAL',             // Network upgrades, hard forks
    MARKET = 'MARKET'                    // Exchange listings, delistings
}

export enum NewsImpact {
    CRITICAL = 'CRITICAL',    // Market-moving events (50+ points)
    HIGH = 'HIGH',            // Significant impact (30-50 points)
    MEDIUM = 'MEDIUM',        // Moderate impact (15-30 points)
    LOW = 'LOW'               // Minor impact (5-15 points)
}

export interface NewsEvent {
    id: string;
    title: string;
    description: string;
    category: NewsCategory;
    sentiment: NewsSentiment;
    impact: NewsImpact;
    affectedMarkets: string[];  // ['BTC', 'ETH', 'ALL_CRYPTO', 'ALL_FOREX']
    timestamp: Date;
    source: string;
    confidence: number;         // 0-100
}

export interface EconomicEvent {
    id: string;
    name: string;
    country: string;            // 'US', 'China', 'EU', etc.
    expectedValue?: number;
    actualValue?: number;
    previousValue?: number;
    impact: NewsImpact;
    sentiment: NewsSentiment;
    affectedPairs: string[];    // ['EUR/USD', 'BTC/USDT', etc.]
    timestamp: Date;
}

export interface SentimentScore {
    overall: number;            // -100 to +100
    news: number;               // News sentiment contribution
    economic: number;           // Economic data contribution
    social: number;             // Social media sentiment (future)
    technical: number;          // Technical analysis contribution
    timestamp: Date;
}
