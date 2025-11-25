// Binance API Integration for Real-Time Crypto Prices

export interface BinanceTickerPrice {
    symbol: string;
    price: string;
}

export interface BinanceTicker24h {
    symbol: string;
    priceChange: string;
    priceChangePercent: string;
    weightedAvgPrice: string;
    prevClosePrice: string;
    lastPrice: string;
    lastQty: string;
    bidPrice: string;
    askPrice: string;
    openPrice: string;
    highPrice: string;
    lowPrice: string;
    volume: string;
    quoteVolume: string;
    openTime: number;
    closeTime: number;
    count: number;
}

export class BinanceAPI {
    private static readonly BASE_URL = 'https://api.binance.com/api/v3';

    /**
     * Get current price for a single symbol
     */
    static async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker/price?symbol=${symbol}`);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status}`);
            }

            const data: BinanceTickerPrice = await response.json();
            return parseFloat(data.price);
        } catch (error) {
            console.error(`Error fetching price for ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * Get current prices for multiple symbols
     */
    static async getMultiplePrices(symbols: string[]): Promise<Map<string, number>> {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker/price`);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status}`);
            }

            const data: BinanceTickerPrice[] = await response.json();
            const priceMap = new Map<string, number>();

            // Filter for requested symbols
            for (const ticker of data) {
                if (symbols.includes(ticker.symbol)) {
                    priceMap.set(ticker.symbol, parseFloat(ticker.price));
                }
            }

            return priceMap;
        } catch (error) {
            console.error('Error fetching multiple prices:', error);
            throw error;
        }
    }

    /**
     * Get 24h ticker data for a symbol (includes volume, high, low, etc.)
     */
    static async get24hTicker(symbol: string): Promise<BinanceTicker24h> {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker/24hr?symbol=${symbol}`);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status}`);
            }

            const data: BinanceTicker24h = await response.json();
            return data;
        } catch (error) {
            console.error(`Error fetching 24h ticker for ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * Get historical klines/candlestick data
     */
    static async getKlines(
        symbol: string,
        interval: string = '1h',
        limit: number = 100
    ): Promise<number[][]> {
        try {
            const response = await fetch(
                `${this.BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
            );

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`Error fetching klines for ${symbol}:`, error);
            throw error;
        }
    }

    /**
     * Convert our pair format to Binance symbol format
     * BTC/USDT -> BTCUSDT
     */
    static pairToBinanceSymbol(pair: string): string {
        return pair.replace('/', '');
    }

    /**
     * Convert Binance symbol to our pair format
     * BTCUSDT -> BTC/USDT
     */
    static binanceSymbolToPair(symbol: string): string {
        // Assume all symbols end with USDT for crypto
        if (symbol.endsWith('USDT')) {
            const base = symbol.slice(0, -4);
            return `${base}/USDT`;
        }
        return symbol;
    }

    /**
     * Get real-time prices for all our crypto pairs
     */
    static async getAllCryptoPrices(): Promise<Map<string, number>> {
        const cryptoPairs = [
            'BTCUSDT',
            'ETHUSDT',
            'BNBUSDT',
            'XRPUSDT',
            'ADAUSDT',
            'SOLUSDT',
            'DOTUSDT',
            'MATICUSDT',
            'AVAXUSDT',
            'LINKUSDT'
        ];

        return await this.getMultiplePrices(cryptoPairs);
    }

    /**
     * Get market data with real prices and historical data
     */
    static async getMarketDataWithRealPrices(pair: string): Promise<{
        currentPrice: number;
        prices: number[];
        volumes: number[];
        timestamps: Date[];
    }> {
        try {
            const symbol = this.pairToBinanceSymbol(pair);

            // Get historical klines (100 hours of data)
            const klines = await this.getKlines(symbol, '1h', 100);

            const prices: number[] = [];
            const volumes: number[] = [];
            const timestamps: Date[] = [];

            for (const kline of klines) {
                const closePrice = parseFloat(String(kline[4])); // Close price
                const volume = parseFloat(String(kline[5])); // Volume
                const timestamp = new Date(kline[0]); // Open time

                prices.push(closePrice);
                volumes.push(volume);
                timestamps.push(timestamp);
            }

            const currentPrice = prices[prices.length - 1];

            return {
                currentPrice,
                prices,
                volumes,
                timestamps
            };
        } catch (error) {
            console.error(`Error getting market data for ${pair}:`, error);
            throw error;
        }
    }
}
