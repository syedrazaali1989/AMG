// News and Sentiment Analysis Engine

import {
    NewsEvent,
    EconomicEvent,
    NewsSentiment,
    NewsCategory,
    NewsImpact,
    SentimentScore
} from './newsTypes';

export class NewsAnalyzer {
    // News Templates
    private static readonly BULLISH_TEMPLATES = [
        { title: 'Institutional Inflows Surge', desc: 'Major funds accumulating {asset} at record pace', category: NewsCategory.ADOPTION },
        { title: 'Regulatory Clarity Achieved', desc: 'New framework provides legal certainty for {asset}', category: NewsCategory.REGULATORY },
        { title: 'Network Upgrade Successful', desc: 'Efficiency improvements drive lower fees and higher throughput', category: NewsCategory.TECHNICAL },
        { title: 'Major Partnership Announced', desc: '{asset} foundation partners with Fortune 500 company', category: NewsCategory.ADOPTION },
        { title: 'ETF Approval Rumors', desc: 'Sources suggest imminent approval of spot ETF', category: NewsCategory.REGULATORY }
    ];

    private static readonly BEARISH_TEMPLATES = [
        { title: 'Regulatory Crackdown Fears', desc: 'Authorities signal tighter controls on crypto trading', category: NewsCategory.REGULATORY },
        { title: 'Exchange Outflow Detected', desc: 'Large movement of {asset} to exchanges suggests selling pressure', category: NewsCategory.MARKET },
        { title: 'Network Congestion Issues', desc: 'High fees and slow transactions plague the network', category: NewsCategory.TECHNICAL },
        { title: 'Macroeconomic Headwinds', desc: 'Global economic uncertainty weighs on risk assets', category: NewsCategory.ECONOMIC },
        { title: 'Security Vulnerability Found', desc: 'Minor exploit discovered in related protocol', category: NewsCategory.TECHNICAL }
    ];

    private static readonly NEUTRAL_TEMPLATES = [
        { title: 'Trading Volume Stabilizes', desc: 'Market activity returns to normal levels after volatility', category: NewsCategory.MARKET },
        { title: 'Developer Activity Report', desc: 'Steady progress on roadmap milestones', category: NewsCategory.TECHNICAL },
        { title: 'Community Governance Vote', desc: 'Proposal for minor parameter adjustments passes', category: NewsCategory.ADOPTION },
        { title: 'Wallet Address Growth', desc: 'Steady increase in new active addresses', category: NewsCategory.ADOPTION }
    ];

    /**
     * Generate dynamic news events based on market sentiment
     */
    static getCurrentNews(pair: string): NewsEvent[] {
        const now = new Date();
        const news: NewsEvent[] = [];
        const asset = pair.split('/')[0]; // e.g., BTC from BTC/USDT

        // Determine overall sentiment for this generation (randomized)
        const rand = Math.random();
        let sentimentType: 'BULLISH' | 'BEARISH' | 'NEUTRAL';

        if (rand > 0.6) sentimentType = 'BULLISH';
        else if (rand < 0.3) sentimentType = 'BEARISH';
        else sentimentType = 'NEUTRAL';

        // Generate 1-2 news items
        const count = 1 + Math.floor(Math.random() * 2);

        for (let i = 0; i < count; i++) {
            let template;
            let sentiment: NewsSentiment;
            let impact: NewsImpact;

            if (sentimentType === 'BULLISH') {
                template = this.BULLISH_TEMPLATES[Math.floor(Math.random() * this.BULLISH_TEMPLATES.length)];
                sentiment = Math.random() > 0.7 ? NewsSentiment.VERY_BULLISH : NewsSentiment.BULLISH;
                impact = Math.random() > 0.8 ? NewsImpact.CRITICAL : NewsImpact.HIGH;
            } else if (sentimentType === 'BEARISH') {
                template = this.BEARISH_TEMPLATES[Math.floor(Math.random() * this.BEARISH_TEMPLATES.length)];
                sentiment = Math.random() > 0.7 ? NewsSentiment.VERY_BEARISH : NewsSentiment.BEARISH;
                impact = Math.random() > 0.8 ? NewsImpact.CRITICAL : NewsImpact.HIGH;
            } else {
                template = this.NEUTRAL_TEMPLATES[Math.floor(Math.random() * this.NEUTRAL_TEMPLATES.length)];
                sentiment = NewsSentiment.NEUTRAL;
                impact = NewsImpact.MEDIUM;
            }

            news.push({
                id: `news-${Date.now()}-${i}`,
                title: template.title.replace('{asset}', asset),
                description: template.desc.replace('{asset}', asset),
                category: template.category,
                sentiment: sentiment,
                impact: impact,
                affectedMarkets: [asset, 'ALL_CRYPTO'],
                timestamp: new Date(now.getTime() - Math.floor(Math.random() * 12) * 60 * 60 * 1000), // Last 12 hours
                source: ['Bloomberg', 'Reuters', 'CoinDesk', 'CoinTelegraph'][Math.floor(Math.random() * 4)],
                confidence: 85 + Math.floor(Math.random() * 15)
            });
        }

        return news;
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
     */
    static calculateSentimentScore(pair: string, technicalScore: number): SentimentScore {
        const news = this.getCurrentNews(pair);
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
    static getNewsSummary(pair: string): string[] {
        // We generate fresh news here for the summary to match the calculation
        // In a real app, this would fetch the SAME news used for calculation
        // For simulation, we'll just regenerate compatible news
        const news = this.getCurrentNews(pair);
        const relevantNews: string[] = [];

        for (const event of news) {
            const sentiment = event.sentiment.replace('_', ' ');
            relevantNews.push(`${event.title} (${sentiment})`);
        }

        return relevantNews;
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
