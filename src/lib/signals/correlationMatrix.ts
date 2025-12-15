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
     */
    private static readonly BTC_CORRELATIONS: Record<string, CorrelationData> = {
        'ETH': {
            symbol: 'ETH',
            pair: 'ETH/USDT',
            correlation: 0.90, // 90% correlation
            label: 'Ethereum (Layer 1)'
        },
        'SOL': {
            symbol: 'SOL',
            pair: 'SOL/USDT',
            correlation: 0.88, // 88% correlation
            label: 'Solana (Layer 1)'
        },
        'BNB': {
            symbol: 'BNB',
            pair: 'BNB/USDT',
            correlation: 0.85, // 85% correlation
            label: 'Binance Coin (Exchange)'
        },
        'AVAX': {
            symbol: 'AVAX',
            pair: 'AVAX/USDT',
            correlation: 0.87, // 87% correlation
            label: 'Avalanche (Layer 1)'
        },
        'MATIC': {
            symbol: 'MATIC',
            pair: 'MATIC/USDT',
            correlation: 0.86, // 86% correlation
            label: 'Polygon (Layer 2)'
        },
        'ADA': {
            symbol: 'ADA',
            pair: 'ADA/USDT',
            correlation: 0.75, // 75% correlation
            label: 'Cardano (Layer 1)'
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
