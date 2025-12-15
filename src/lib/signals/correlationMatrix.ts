// Bitcoin Correlation Matrix
// Defines which altcoins follow Bitcoin's movements

export interface CorrelationData {
    symbol: string;
    pair: string;
    correlation: number; // 0.0 to 1.0
    label: string;
}

export class CorrelationMatrix {
    /**
     * Correlation strength between BTC and major altcoins
     * Based on historical market data (2023-2024)
     * EXPANDED POOL - 15+ coins for random selection
     */
    private static readonly BTC_CORRELATIONS: Record<string, CorrelationData> = {
        // Very High Correlation (85%+)
        'ETH': {
            symbol: 'ETH',
            pair: 'ETH/USDT',
            correlation: 0.90,
            label: 'Ethereum (Layer 1)'
        },
        'AVAX': {
            symbol: 'AVAX',
            pair: 'AVAX/USDT',
            correlation: 0.87,
            label: 'Avalanche (Layer 1)'
        },
        'SOL': {
            symbol: 'SOL',
            pair: 'SOL/USDT',
            correlation: 0.88,
            label: 'Solana (Layer 1)'
        },
        'MATIC': {
            symbol: 'MATIC',
            pair: 'MATIC/USDT',
            correlation: 0.86,
            label: 'Polygon (Layer 2)'
        },
        'BNB': {
            symbol: 'BNB',
            pair: 'BNB/USDT',
            correlation: 0.85,
            label: 'Binance Coin (Exchange)'
        },

        // High Correlation (75-85%)
        'DOT': {
            symbol: 'DOT',
            pair: 'DOT/USDT',
            correlation: 0.82,
            label: 'Polkadot (Layer 0)'
        },
        'LINK': {
            symbol: 'LINK',
            pair: 'LINK/USDT',
            correlation: 0.81,
            label: 'Chainlink (Oracle)'
        },
        'UNI': {
            symbol: 'UNI',
            pair: 'UNI/USDT',
            correlation: 0.79,
            label: 'Uniswap (DEX)'
        },
        'ATOM': {
            symbol: 'ATOM',
            pair: 'ATOM/USDT',
            correlation: 0.78,
            label: 'Cosmos (Interoperability)'
        },
        'LTC': {
            symbol: 'LTC',
            pair: 'LTC/USDT',
            correlation: 0.83,
            label: 'Litecoin (Payment)'
        },
        'ADA': {
            symbol: 'ADA',
            pair: 'ADA/USDT',
            correlation: 0.75,
            label: 'Cardano (Layer 1)'
        },
        'XRP': {
            symbol: 'XRP',
            pair: 'XRP/USDT',
            correlation: 0.76,
            label: 'Ripple (Payment)'
        },
        'DOGE': {
            symbol: 'DOGE',
            pair: 'DOGE/USDT',
            correlation: 0.77,
            label: 'Dogecoin (Meme)'
        },
        'SHIB': {
            symbol: 'SHIB',
            pair: 'SHIB/USDT',
            correlation: 0.74,
            label: 'Shiba Inu (Meme)'
        },
        'APT': {
            symbol: 'APT',
            pair: 'APT/USDT',
            correlation: 0.80,
            label: 'Aptos (Layer 1)'
        }
    };

    /**
     * Get all coins that correlate with Bitcoin
     * @param minCorrelation Minimum correlation threshold (default: 0.75)
     */
    static getCorrelatedCoins(minCorrelation: number = 0.75): CorrelationData[] {
        return Object.values(this.BTC_CORRELATIONS)
            .filter(coin => coin.correlation >= minCorrelation)
            .sort((a, b) => b.correlation - a.correlation); // Highest first
    }

    /**
     * Get random correlated coins for variety
     * @param count Number of random coins to select
     * @param minCorrelation Minimum correlation threshold
     */
    static getRandomCorrelatedCoins(count: number = 6, minCorrelation: number = 0.74): CorrelationData[] {
        const allCoins = Object.values(this.BTC_CORRELATIONS)
            .filter(coin => coin.correlation >= minCorrelation);

        // Shuffle array
        const shuffled = allCoins.sort(() => Math.random() - 0.5);

        // Return random selection
        return shuffled.slice(0, Math.min(count, shuffled.length));
    }

    /**
     * Get correlation for specific coin
     */
    static getCorrelation(symbol: string): CorrelationData | null {
        return this.BTC_CORRELATIONS[symbol] || null;
    }

    /**
     * Check if coin is correlated with BTC
     */
    static isCorrelated(symbol: string, minCorrelation: number = 0.75): boolean {
        const data = this.BTC_CORRELATIONS[symbol];
        return data ? data.correlation >= minCorrelation : false;
    }

    /**
     * Get correlation strength label
     */
    static getStrengthLabel(correlation: number): string {
        if (correlation >= 0.85) return 'Very High';
        if (correlation >= 0.75) return 'High';
        if (correlation >= 0.60) return 'Moderate';
        return 'Low';
    }

    /**
     * Get all pairs for correlated trading
     */
    static getCorrelatedPairs(): string[] {
        return Object.values(this.BTC_CORRELATIONS).map(coin => coin.pair);
    }
}
