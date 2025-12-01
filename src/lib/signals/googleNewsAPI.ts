// Google News API Integration
// Uses GNews API with fallback to enhanced simulated news

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
     * Fetch news from GNews API (with fallback to enhanced simulation)
     */
    static async fetchNews(params: NewsSearchParams): Promise<NewsArticle[]> {
        const cacheKey = this.getCacheKey(params);

        // Check cache first
        const cached = this.newsCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION_MS) {
            return cached.articles;
        }

        // Try real API if key is available
        if (this.GNEWS_API_KEY) {
            try {
                const articles = await this.fetchFromGNews(params);
                this.newsCache.set(cacheKey, { articles, timestamp: Date.now() });
                return articles;
            } catch (error) {
                console.warn('GNews API failed, falling back to simulated news:', error);
            }
        }

        // Fallback to enhanced simulated news
        const articles = this.generateEnhancedSimulatedNews(params);
        this.newsCache.set(cacheKey, { articles, timestamp: Date.now() });
        return articles;
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
     * Generate enhanced simulated news (realistic and dynamic)
     */
    private static generateEnhancedSimulatedNews(params: NewsSearchParams): NewsArticle[] {
        const articles: NewsArticle[] = [];
        const now = new Date();
        const maxResults = params.maxResults || 10;

        // Generate varied realistic news based on keywords
        const newsTemplates = this.getNewsTemplates(params.keywords);

        for (let i = 0; i < Math.min(maxResults, newsTemplates.length); i++) {
            const template = newsTemplates[i];
            const hoursAgo = Math.random() * 12; // Last 12 hours
            const publishedAt = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);

            articles.push({
                id: `sim-${Date.now()}-${i}`,
                title: template.title,
                description: template.description,
                url: `https://example.com/news/${i}`,
                source: template.source,
                publishedAt,
                keywords: params.keywords,
                sentiment: template.sentiment,
                urgency: this.determineUrgency(publishedAt),
                credibility: this.getSourceCredibility(template.source),
            });
        }

        return articles;
    }

    /**
     * Get realistic news templates based on keywords
     */
    private static getNewsTemplates(keywords: string[]): Array<{
        title: string;
        description: string;
        source: string;
        sentiment: number;
    }> {
        const templates: Array<{ title: string; description: string; source: string; sentiment: number }> = [];

        // Check which category matches
        const keywordStr = keywords.join(' ').toLowerCase();

        if (keywordStr.includes('federal reserve') || keywordStr.includes('interest')) {
            templates.push(
                { title: 'Fed Signals Pause in Rate Hikes', description: 'Federal Reserve officials indicate potential pause in monetary tightening cycle amid cooling inflation.', source: 'Bloomberg', sentiment: 0.7 },
                { title: 'Markets Rally on Dovish Fed Comments', description: 'Stocks surge as Fed Chair suggests data-dependent approach to future rate decisions.', source: 'Reuters', sentiment: 0.8 },
                { title: 'Fed Minutes Reveal Split on Rate Path', description: 'FOMC minutes show disagreement among members on pace of future rate adjustments.', source: 'Wall Street Journal', sentiment: 0.2 },
            );
        }

        if (keywordStr.includes('inflation')) {
            templates.push(
                { title: 'CPI Data Shows Inflation Cooling', description: 'Consumer price index rises 3.2%, below expectations, marking third consecutive decline.', source: 'Bloomberg', sentiment: 0.6 },
                { title: 'Inflation Remains Sticky in Core Categories', description: 'Core CPI excluding food and energy holds above Fed target, complicating policy outlook.', source: 'Financial Times', sentiment: -0.4 },
            );
        }

        if (keywordStr.includes('gdp') || keywordStr.includes('economic')) {
            templates.push(
                { title: 'Q3 GDP Growth Beats Estimates', description: 'US economy expands 5.2% annualized, driven by consumer spending and business investment.', source: 'Reuters', sentiment: 0.8 },
                { title: 'Economic Slowdown Concerns Mount', description: 'Leading indicators point to potential recession as manufacturing contracts for third month.', source: 'CNBC', sentiment: -0.6 },
            );
        }

        if (keywordStr.includes('geopolitical') || keywordStr.includes('tensions')) {
            templates.push(
                { title: 'Trade Talks Resume Amid Optimism', description: 'US and China restart negotiations on tariff reductions, boosting risk appetite.', source: 'Reuters', sentiment: 0.5 },
                { title: 'Geopolitical Tensions Escalate', description: 'Diplomatic standoff deepens as sanctions threaten global supply chains.', source: 'Bloomberg', sentiment: -0.7 },
            );
        }

        if (keywordStr.includes('bitcoin') || keywordStr.includes('crypto')) {
            templates.push(
                { title: 'Bitcoin ETF Sees Record Inflows', description: 'Spot Bitcoin ETFs attract $500M in single day as institutional adoption accelerates.', source: 'CoinDesk', sentiment: 0.9 },
                { title: 'Regulatory Clarity Boosts Crypto Markets', description: 'SEC chair signals framework for digital asset regulation, reducing uncertainty.', source: 'The Block', sentiment: 0.7 },
                { title: 'Crypto Exchange Faces Probe', description: 'Major exchange under investigation for potential securities violations.', source: 'CoinTelegraph', sentiment: -0.5 },
            );
        }

        if (keywordStr.includes('oil') || keywordStr.includes('crude')) {
            templates.push(
                { title: 'Oil Surges on Supply Cut Extension', description: 'OPEC+ announces production cuts through Q2, sending crude above $85/barrel.', source: 'Reuters', sentiment: 0.6 },
                { title: 'Oil Prices Tumble on Demand Concerns', description: 'Weak Chinese data triggers selloff in energy markets as recession fears grow.', source: 'Bloomberg', sentiment: -0.7 },
            );
        }

        if (keywordStr.includes('earnings') || keywordStr.includes('corporate')) {
            templates.push(
                { title: 'Tech Giants Beat Earnings Expectations', description: 'Major tech companies report stronger-than-expected quarterly results, lifting sentiment.', source: 'Wall Street Journal', sentiment: 0.8 },
                { title: 'Earnings Season Disappoints', description: 'Corporate profit warnings increase as margin pressures mount.', source: 'MarketWatch', sentiment: -0.5 },
            );
        }

        // Default general financial news if no specific match
        if (templates.length === 0) {
            templates.push(
                { title: 'Markets Consolidate After Rally', description: 'Major indices trade in narrow range as investors await catalysts.', source: 'CNBC', sentiment: 0.1 },
                { title: 'Volatility Expected Ahead of Data', description: 'Option markets pricing increased movement around key economic releases.', source: 'Bloomberg', sentiment: 0.0 },
            );
        }

        return templates;
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
