// Google News API Integration
// Uses the GNews API. There is NO simulated-news fallback: when no API key
// is configured or the API fails, fetchNews returns an empty list and
// sentiment is treated as neutral by callers.

export interface NewsArticle {
    id: string;
    title: string;
    description: string;
    url: string;
    source: string;
    publishedAt: Date;
    keywords: string[];
    sentiment: number; // -1 to +1 scale
    urgency: 'BREAKING' | 'REGULAR' | 'OLD';
    credibility: number; // 0-100 score based on source
}

export interface NewsSearchParams {
    keywords: string[];
    fromDate?: Date;
    maxResults?: number;
    language?: string;
}

export class GoogleNewsAPI {
    private static readonly GNEWS_API_KEY = process.env.NEXT_PUBLIC_GNEWS_API_KEY || '';
    private static readonly GNEWS_BASE_URL = 'https://gnews.io/api/v4';
    private static readonly CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

    private static newsCache: Map<string, { articles: NewsArticle[]; timestamp: number }> = new Map();

    // Source credibility scores (higher = more credible)
    private static readonly SOURCE_CREDIBILITY: { [key: string]: number } = {
        'Bloomberg': 95,
        'Reuters': 95,
        'Financial Times': 90,
        'Wall Street Journal': 90,
        'The Economist': 85,
        'CNBC': 80,
        'CNN Business': 75,
        'MarketWatch': 75,
        'Yahoo Finance': 70,
        'CoinDesk': 85,
        'CoinTelegraph': 75,
        'Decrypt': 70,
        'The Block': 80,
        'Forbes': 75,
        'Business Insider': 70,
    };

    // Keywords for different market categories
    static readonly KEYWORD_CATEGORIES = {
        MONETARY_POLICY: ['Federal Reserve', 'interest rates', 'Fed meeting', 'FOMC', 'central bank', 'monetary policy'],
        INFLATION: ['inflation report', 'CPI data', 'PPI', 'consumer prices', 'inflation rate'],
        ECONOMIC_DATA: ['GDP data', 'unemployment', 'jobs report', 'non-farm payrolls', 'economic growth'],
        GEOPOLITICAL: ['geopolitical tensions', 'trade war', 'sanctions', 'conflict', 'diplomatic crisis'],
        CRYPTO_SPECIFIC: ['Bitcoin regulation', 'cryptocurrency adoption', 'blockchain', 'crypto ETF', 'DeFi'],
        FOREX_SPECIFIC: ['currency rates', 'forex intervention', 'dollar strength', 'euro zone'],
        COMMODITIES: ['oil prices', 'crude oil', 'gold prices', 'precious metals'],
        EARNINGS: ['earnings season', 'corporate earnings', 'quarterly results'],
    };

    /**
     * Fetch news from the GNews API.
     * Returns an empty array when no API key is configured or the request
     * fails — fabricated/simulated articles are never substituted.
     */
    static async fetchNews(params: NewsSearchParams): Promise<NewsArticle[]> {
        const cacheKey = this.getCacheKey(params);

        // Check cache first
        const cached = this.newsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
            return cached.articles;
        }

        // Real API only, and only when a key is configured
        if (this.GNEWS_API_KEY) {
            try {
                const articles = await this.fetchFromGNews(params);
                this.newsCache.set(cacheKey, { articles, timestamp: Date.now() });
                return articles;
            } catch (error) {
                console.warn('GNews API failed; treating news sentiment as neutral:', error);
            }
        }

        // No real news available -> empty (neutral sentiment upstream)
        this.newsCache.set(cacheKey, { articles: [], timestamp: Date.now() });
        return [];
    }

    /**
     * Fetch from real GNews API
     */
    private static async fetchFromGNews(params: NewsSearchParams): Promise<NewsArticle[]> {
        const query = params.keywords.join(' OR ');
        const url = `${this.GNEWS_BASE_URL}/search?q=${encodeURIComponent(query)}&lang=${params.language || 'en'}&max=${params.maxResults || 10}&apikey=${this.GNEWS_API_KEY}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`GNews API error: ${response.status}`);
        }

        const data = await response.json();
        return data.articles.map((article: any) => this.parseGNewsArticle(article, params.keywords));
    }

    /**
     * Parse GNews API response
     */
    private static parseGNewsArticle(article: any, keywords: string[]): NewsArticle {
        const publishedAt = new Date(article.publishedAt);
        const urgency = this.determineUrgency(publishedAt);
        const sentiment = this.analyzeSentiment(article.title, article.description);
        const credibility = this.getSourceCredibility(article.source.name);

        return {
            id: `gnews-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            title: article.title,
            description: article.description || '',
            url: article.url,
            source: article.source.name,
            publishedAt,
            keywords,
            sentiment,
            urgency,
            credibility,
        };
    }


    /**
     * Analyze sentiment from text (simple keyword-based)
     * Returns -1 to +1
     */
    private static analyzeSentiment(title: string, description: string): number {
        const text = (title + ' ' + description).toLowerCase();

        const bullishWords = ['rally', 'surge', 'beat', 'optimism', 'growth', 'gains', 'boost', 'positive', 'strong', 'record', 'soar', 'jump', 'rise'];
        const bearishWords = ['crash', 'tumble', 'miss', 'concerns', 'decline', 'fall', 'negative', 'weak', 'plunge', 'drop', 'slump', 'fear'];

        let score = 0;
        bullishWords.forEach(word => {
            if (text.includes(word)) score += 0.15;
        });
        bearishWords.forEach(word => {
            if (text.includes(word)) score -= 0.15;
        });

        return Math.max(-1, Math.min(1, score));
    }

    /**
     * Determine urgency based on publication time
     */
    private static determineUrgency(publishedAt: Date): 'BREAKING' | 'REGULAR' | 'OLD' {
        const hoursAgo = (Date.now() - publishedAt.getTime()) / (1000 * 60 * 60);

        if (hoursAgo < 2) return 'BREAKING';
        if (hoursAgo < 24) return 'REGULAR';
        return 'OLD';
    }

    /**
     * Get source credibility score
     */
    private static getSourceCredibility(sourceName: string): number {
        return this.SOURCE_CREDIBILITY[sourceName] || 60; // Default moderate credibility
    }

    /**
     * Calculate aggregate sentiment for multiple articles
     * Returns -5 to +5 scale
     */
    static calculateAggregateSentiment(articles: NewsArticle[]): number {
        if (articles.length === 0) return 0;

        let weightedSum = 0;
        let totalWeight = 0;

        articles.forEach(article => {
            // Weight by credibility and recency
            const urgencyWeight = article.urgency === 'BREAKING' ? 1.5 : article.urgency === 'REGULAR' ? 1.0 : 0.5;
            const credibilityWeight = article.credibility / 100;
            const weight = urgencyWeight * credibilityWeight;

            weightedSum += article.sentiment * weight;
            totalWeight += weight;
        });

        const avgSentiment = totalWeight > 0 ? weightedSum / totalWeight : 0;

        // Scale from -1/+1 to -5/+5
        return avgSentiment * 5;
    }

    /**
     * Generate cache key for news search
     */
    private static getCacheKey(params: NewsSearchParams): string {
        return params.keywords.sort().join('|');
    }

    /**
     * Clear cache (useful for testing)
     */
    static clearCache(): void {
        this.newsCache.clear();
    }
}
