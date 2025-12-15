// Whale Alert API Integration
// Tracks large cryptocurrency transactions (whale movements)

export interface WhaleTransaction {
    blockchain: string;
    symbol: string;
    amount: number;
    amount_usd: number;
    from: {
        address: string;
        owner_type: string;
        owner: string;
    };
    to: {
        address: string;
        owner_type: string;
        owner: string;
    };
    timestamp: number;
    transaction_type: string;
    hash: string;
}

export interface WhaleAlert {
    transactions: WhaleTransaction[];
    count: number;
}

export class WhaleAlertAPI {
    private static readonly API_KEY = process.env.NEXT_PUBLIC_WHALE_ALERT_KEY || 'demo';
    private static readonly BASE_URL = 'https://api.whale-alert.io/v1';

    /**
     * Get large transactions (whale movements)
     * @param minValue Minimum transaction value in USD (default: 1000000 = $1M)
     * @param limit Number of transactions to fetch (default: 50)
     */
    static async getTransactions(minValue: number = 1000000, limit: number = 50): Promise<WhaleAlert> {
        // Use simulated data by default (real API has CORS issues in browser)
        // To use real API: add NEXT_PUBLIC_WHALE_ALERT_KEY to .env and enable below code

        console.log('🐋 Using simulated whale data (demo mode)');
        return this.getSimulatedData();

        /* Uncomment to use real Whale Alert API:
        try {
            const startTime = Math.floor(Date.now() / 1000) - 3600; // Last 1 hour
            const url = `${this.BASE_URL}/transactions?api_key=${this.API_KEY}&min_value=${minValue}&start=${startTime}&limit=${limit}`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                console.warn('Whale Alert API failed, using simulated data');
                return this.getSimulatedData();
            }

            const data = await response.json();
            return {
                transactions: data.transactions || [],
                count: data.count || 0
            };
        } catch (error) {
            console.error('Whale Alert API error:', error);
            return this.getSimulatedData();
        }
        */
    }

    /**
     * Simulated whale data for demo/fallback
     */
    private static getSimulatedData(): WhaleAlert {
        const cryptos = ['bitcoin', 'ethereum', 'tether', 'usdc', 'bnb'];
        const symbols = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB'];
        const exchanges = ['binance', 'coinbase', 'kraken', 'bitfinex', 'okex'];

        const transactions: WhaleTransaction[] = [];
        const now = Math.floor(Date.now() / 1000);

        // Generate 5-10 simulated whale transactions
        const count = 5 + Math.floor(Math.random() * 6);

        for (let i = 0; i < count; i++) {
            const cryptoIdx = Math.floor(Math.random() * cryptos.length);
            const isToExchange = Math.random() > 0.5;
            const amount = 100 + Math.random() * 5000; // 100-5000 coins
            const usdValue = amount * (cryptoIdx === 0 ? 50000 : cryptoIdx === 1 ? 3800 : 1);

            transactions.push({
                blockchain: cryptos[cryptoIdx],
                symbol: symbols[cryptoIdx],
                amount: amount,
                amount_usd: usdValue,
                from: {
                    address: this.generateAddress(),
                    owner_type: isToExchange ? 'unknown' : 'exchange',
                    owner: isToExchange ? '' : exchanges[Math.floor(Math.random() * exchanges.length)]
                },
                to: {
                    address: this.generateAddress(),
                    owner_type: isToExchange ? 'exchange' : 'unknown',
                    owner: isToExchange ? exchanges[Math.floor(Math.random() * exchanges.length)] : ''
                },
                timestamp: now - (i * 300), // Spread over last hour
                transaction_type: 'transfer',
                hash: this.generateHash()
            });
        }

        return {
            transactions: transactions.sort((a, b) => b.timestamp - a.timestamp),
            count: transactions.length
        };
    }

    /**
     * Analyze transaction sentiment
     */
    static analyzeSentiment(transaction: WhaleTransaction): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
        // To Exchange = Bearish (likely selling)
        if (transaction.to.owner_type === 'exchange') {
            return 'BEARISH';
        }

        // From Exchange = Bullish (withdrawal for holding)
        if (transaction.from.owner_type === 'exchange') {
            return 'BULLISH';
        }

        // Unknown to Unknown = Neutral
        return 'NEUTRAL';
    }

    /**
     * Get exchange flow for specific crypto
     */
    static getExchangeFlow(transactions: WhaleTransaction[], symbol: string): {
        inflow: number;
        outflow: number;
        net: number;
        sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    } {
        let inflow = 0;
        let outflow = 0;

        transactions
            .filter(tx => tx.symbol === symbol)
            .forEach(tx => {
                if (tx.to.owner_type === 'exchange') {
                    inflow += tx.amount_usd;
                } else if (tx.from.owner_type === 'exchange') {
                    outflow += tx.amount_usd;
                }
            });

        const net = outflow - inflow;
        const sentiment = net > 0 ? 'BULLISH' : net < 0 ? 'BEARISH' : 'NEUTRAL';

        return { inflow, outflow, net, sentiment };
    }

    private static generateAddress(): string {
        return '0x' + Array(40).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    }

    private static generateHash(): string {
        return '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    }
}
