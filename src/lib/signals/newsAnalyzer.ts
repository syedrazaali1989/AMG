// News and Sentiment Analysis Engine
// Enhanced with Google News API integration and advanced sentiment scoring

import {
    NewsEvent,
    EconomicEvent,
    NewsSentiment,
    NewsCategory,
    NewsImpact,
    SentimentScore
} from './newsTypes';
import { GoogleNewsAPI, NewsArticle } from './googleNewsAPI';

export class NewsAnalyzer {
    // Cache for fetched news articles
    private static newsArticlesCache: Map<string, { articles: NewsArticle[]; timestamp: number }> = new Map();
    private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Cache for news impact assessment (used during signal generation)
    private static newsImpactCache: Map<string, { impact: any; timestamp: number }> = new Map();
    private static readonly IMPACT_CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

    /**
     * Get relevant news keywords for a trading pair
     */
    private static getRelevantKeywords(pair: string): string[] {
        const [base, quote] = pair.split('/');
        const keywords: string[] = [];

        // Crypto-specific keywords
        if (pair.includes('USDT') || pair.includes('BTC') || pair.includes('ETH')) {
            keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.CRYPTO_SPECIFIC);
            if (base === 'BTC') keywords.push('Bitcoin');
            if (base === 'ETH') keywords.push('Ethereum');
        }

        // Forex-specific keywords
        if (pair.includes('USD') || pair.includes('EUR') || pair.includes('GBP')) {
            keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.MONETARY_POLICY);
            keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.FOREX_SPECIFIC);
        }

        // Common macro keywords for all assets
        keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.INFLATION);
        keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.ECONOMIC_DATA);
        keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.GEOPOLITICAL);

        // Commodities
        if (pair.includes('XAU') || pair.includes('XAG')) {
            keywords.push(...GoogleNewsAPI.KEYWORD_CATEGORIES.COMMODITIES);
        }
        if (pair.includes('CL') || pair.includes('OIL')) {
            keywords.push('oil prices', 'crude oil', 'OPEC');
        }

        // Remove duplicates
        return [...new Set(keywords)];
    }

    /**
     * Fetch real-time news for a trading pair
     * Uses Google News API with intelligent caching
     */
    static async getCurrentNews(pair: string): Promise<NewsEvent[]> {
        const cacheKey = pair;
        const cached = this.newsArticlesCache.get(cacheKey);

        // Return cached if fresh
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
            return this.convertArticlesToNewsEvents(cached.articles, pair);
        }

        // Fetch fresh news
        const keywords = this.getRelevantKeywords(pair);
        const articles = await GoogleNewsAPI.fetchNews({
            keywords,
            maxResults: 10,
        });

        // Cache the results
        this.newsArticlesCache.set(cacheKey, { articles, timestamp: Date.now() });

        return this.convertArticlesToNewsEvents(articles, pair);
    }

    /**
     * Convert NewsArticles to NewsEvents
     */
    private static convertArticlesToNewsEvents(articles: NewsArticle[], pair: string): NewsEvent[] {
        const asset = pair.split('/')[0];

        return articles.map(article => {
            const sentiment = this.convertSentimentToEnum(article.sentiment);
            const impact = this.determineImpactLevel(article.urgency, article.credibility);
            const category = this.categorizeNews(article.keywords);

            return {
                id: article.id,
                title: article.title,
                description: article.description,
                category,
                sentiment,
                impact,
                affectedMarkets: this.getAffectedMarkets(pair, article.keywords),
                timestamp: article.publishedAt,
                source: article.source,
                confidence: article.credibility,
            };
        });
    }

    /**
     * Convert numerical sentiment to enum
     */
    private static convertSentimentToEnum(sentiment: number): NewsSentiment {
        if (sentiment >= 0.6) return NewsSentiment.VERY_BULLISH;
        if (sentiment >= 0.2) return NewsSentiment.BULLISH;
        if (sentiment <= -0.6) return NewsSentiment.VERY_BEARISH;
        if (sentiment <= -0.2) return NewsSentiment.BEARISH;
        return NewsSentiment.NEUTRAL;
    }

    /**
     * Determine impact level based on urgency and credibility
     */
    private static determineImpactLevel(urgency: string, credibility: number): NewsImpact {
        if (urgency === 'BREAKING' && credibility >= 85) return NewsImpact.CRITICAL;
        if (urgency === 'BREAKING' || credibility >= 80) return NewsImpact.HIGH;
        if (urgency === 'REGULAR') return NewsImpact.MEDIUM;
        return NewsImpact.LOW;
    }

    /**
     * Categorize news based on keywords
     */
    private static categorizeNews(keywords: string[]): NewsCategory {
        const keywordStr = keywords.join(' ').toLowerCase();

        if (keywordStr.includes('regulation') || keywordStr.includes('sec')) return NewsCategory.REGULATORY;
        if (keywordStr.includes('adoption') || keywordStr.includes('etf')) return NewsCategory.ADOPTION;
        if (keywordStr.includes('gdp') || keywordStr.includes('inflation')) return NewsCategory.ECONOMIC;
        if (keywordStr.includes('blockchain') || keywordStr.includes('upgrade')) return NewsCategory.TECHNICAL;

        return NewsCategory.MARKET;
    }

    /**
     * Get affected markets from keywords
     */
    private static getAffectedMarkets(pair: string, keywords: string[]): string[] {
        const [base] = pair.split('/');
        const affected = [base];

        const keywordStr = keywords.join(' ').toLowerCase();

        if (keywordStr.includes('crypto') || keywordStr.includes('bitcoin')) {
            affected.push('ALL_CRYPTO');
        }
        if (keywordStr.includes('forex') || keywordStr.includes('dollar') || keywordStr.includes('fed')) {
            affected.push('ALL_FOREX');
        }

        return affected;
    }

    /**
     * Get economic events (Simulated dynamic)
     */
    static getEconomicEvents(): EconomicEvent[] {
        const now = new Date();
        // Randomize actual values slightly to create variety
        const cpiActual = 3.0 + (Math.random() - 0.5) * 0.2;
        const nfpActual = 250000 + (Math.random() - 0.5) * 50000;

        return [
            {
                id: 'econ-1',
                name: 'US Non-Farm Payrolls',
                country: 'US',
                expectedValue: 200000,
                actualValue: Math.round(nfpActual),
                previousValue: 220000,
                impact: NewsImpact.CRITICAL,
                sentiment: nfpActual > 220000 ? NewsSentiment.BULLISH : NewsSentiment.BEARISH,
                affectedPairs: ['EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USDT'],
                timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000)
            },
            {
                id: 'econ-3',
                name: 'US Inflation Rate (CPI)',
                country: 'US',
                expectedValue: 3.2,
                actualValue: parseFloat(cpiActual.toFixed(1)),
                previousValue: 3.4,
                impact: NewsImpact.CRITICAL,
                sentiment: cpiActual < 3.2 ? NewsSentiment.VERY_BULLISH : NewsSentiment.BEARISH,
                affectedPairs: ['ALL_FOREX', 'ALL_CRYPTO'],
                timestamp: new Date(now.getTime() - 48 * 60 * 60 * 1000)
            }
        ];
    }

    /**
     * Calculate sentiment score for a specific pair
     * Enhanced with real-time news and -5 to +5 aggregate scoring
     */
    static async calculateSentimentScore(pair: string, technicalScore: number): Promise<SentimentScore> {
        const news = await this.getCurrentNews(pair);
        const economicEvents = this.getEconomicEvents();

        let newsScore = 0;
        let economicScore = 0;
        let newsCount = 0;
        let economicCount = 0;

        // Analyze news impact
        for (const event of news) {
            const sentimentValue = this.getSentimentValue(event.sentiment);
            const impactMultiplier = this.getImpactMultiplier(event.impact);
            const confidence = event.confidence / 100;

            newsScore += sentimentValue * impactMultiplier * confidence;
            newsCount++;
        }

        // Analyze economic events
        for (const event of economicEvents) {
            if (this.affectsPair(event.affectedPairs, pair)) {
                const sentimentValue = this.getSentimentValue(event.sentiment);
                const impactMultiplier = this.getImpactMultiplier(event.impact);

                economicScore += sentimentValue * impactMultiplier;
                economicCount++;
            }
        }

        // Average the scores
        newsScore = newsCount > 0 ? newsScore / newsCount : 0;
        economicScore = economicCount > 0 ? economicScore / economicCount : 0;

        // Combine all scores
        const overall = (newsScore * 0.4) + (economicScore * 0.2) + (technicalScore * 0.4);

        return {
            overall: Math.max(-100, Math.min(100, overall)),
            news: newsScore,
            economic: economicScore,
            social: 0,
            technical: technicalScore,
            timestamp: new Date()
        };
    }

    /**
     * Get aggregate news impact assessment (-5 to +5 scale)
     * For last 2 hours of news
     */
    static async getNewsImpactAssessment(pair: string): Promise<{
        score: number; // -5 to +5
        catalyst: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
        recentNews: NewsEvent[];
    }> {
        // Check cache first
        const cached = this.newsImpactCache.get(pair);
        if (cached && Date.now() - cached.timestamp < this.IMPACT_CACHE_DURATION) {
            return cached.impact;
        }

        const allNews = await this.getCurrentNews(pair);

        // Filter for last 2 hours
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const recentNews = allNews.filter(news => news.timestamp >= twoHoursAgo);

        if (recentNews.length === 0) {
            return {
                score: 0,
                catalyst: 'NEUTRAL',
                recentNews: []
            };
        }

        // Convert to NewsArticles for aggregate calculation
        const articles: NewsArticle[] = recentNews.map(news => ({
            id: news.id,
            title: news.title,
            description: news.description,
            url: '',
            source: news.source,
            publishedAt: news.timestamp,
            keywords: [],
            sentiment: this.convertEnumToSentiment(news.sentiment),
            urgency: this.getUrgencyFromTimestamp(news.timestamp),
            credibility: news.confidence
        }));

        const aggregateScore = GoogleNewsAPI.calculateAggregateSentiment(articles);

        // Determine catalyst type
        let catalyst: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
        if (aggregateScore >= 3) catalyst = 'STRONG_BULLISH';
        else if (aggregateScore >= 1) catalyst = 'BULLISH';
        else if (aggregateScore <= -3) catalyst = 'STRONG_BEARISH';
        else if (aggregateScore <= -1) catalyst = 'BEARISH';
        else catalyst = 'NEUTRAL';

        const result = {
            score: aggregateScore,
            catalyst,
            recentNews
        };

        // Cache the result
        this.newsImpactCache.set(pair, { impact: result, timestamp: Date.now() });

        return result;
    }

    /**
     * Convert sentiment enum to numerical value
     */
    private static convertEnumToSentiment(sentiment: NewsSentiment): number {
        const map = {
            [NewsSentiment.VERY_BULLISH]: 0.8,
            [NewsSentiment.BULLISH]: 0.4,
            [NewsSentiment.NEUTRAL]: 0,
            [NewsSentiment.BEARISH]: -0.4,
            [NewsSentiment.VERY_BEARISH]: -0.8
        };
        return map[sentiment];
    }

    /**
     * Determine urgency from timestamp
     */
    private static getUrgencyFromTimestamp(timestamp: Date): 'BREAKING' | 'REGULAR' | 'OLD' {
        const hoursAgo = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60);
        if (hoursAgo < 2) return 'BREAKING';
        if (hoursAgo < 24) return 'REGULAR';
        return 'OLD';
    }

    /**
     * Check if news affects a specific pair
     */
    private static affectsPair(affectedMarkets: string[], pair: string): boolean {
        // Check for ALL_CRYPTO or ALL_FOREX
        if (affectedMarkets.includes('ALL_CRYPTO') && pair.includes('USDT')) return true;
        if (affectedMarkets.includes('ALL_FOREX') && pair.includes('/') && !pair.includes('USDT')) return true;

        // Check for specific coin/currency
        for (const market of affectedMarkets) {
            if (pair.includes(market)) return true;
        }

        return false;
    }

    /**
     * Convert sentiment to numerical value
     */
    private static getSentimentValue(sentiment: NewsSentiment): number {
        const sentimentMap = {
            [NewsSentiment.VERY_BULLISH]: 80,
            [NewsSentiment.BULLISH]: 40,
            [NewsSentiment.NEUTRAL]: 0,
            [NewsSentiment.BEARISH]: -40,
            [NewsSentiment.VERY_BEARISH]: -80
        };
        return sentimentMap[sentiment];
    }

    /**
     * Get impact multiplier
     */
    private static getImpactMultiplier(impact: NewsImpact): number {
        const impactMap = {
            [NewsImpact.CRITICAL]: 1.5,
            [NewsImpact.HIGH]: 1.2,
            [NewsImpact.MEDIUM]: 1.0,
            [NewsImpact.LOW]: 0.7
        };
        return impactMap[impact];
    }

    /**
     * Get news summary for a pair
     */
    static async getNewsSummary(pair: string): Promise<string[]> {
        const news = await this.getCurrentNews(pair);
        const relevantNews: string[] = [];

        for (const event of news) {
            const sentiment = event.sentiment.replace('_', ' ');
            const urgency = this.getUrgencyFromTimestamp(event.timestamp);
            const urgencyIcon = urgency === 'BREAKING' ? '⚡' : urgency === 'REGULAR' ? '📰' : '📅';
            relevantNews.push(`${urgencyIcon} ${event.title} (${sentiment})`);
        }

        return relevantNews.slice(0, 5); // Return top 5
    }

    /**
     * Get economic events summary for a pair
     */
    static getEconomicSummary(pair: string): string[] {
        const events = this.getEconomicEvents();
        const relevantEvents: string[] = [];

        for (const event of events) {
            if (this.affectsPair(event.affectedPairs, pair)) {
                const direction = event.actualValue && event.expectedValue
                    ? (event.actualValue > event.expectedValue ? '📈 Better' : '📉 Worse')
                    : '';
                relevantEvents.push(`${event.name}: ${direction} than expected`);
            }
        }

        return relevantEvents;
    }
}
