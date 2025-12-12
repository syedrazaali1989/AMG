// MEXC API Integration for Real-Time Crypto Prices

export interface MexcTickerPrice {
    symbol: string;
    price: string;
}

export class MexcAPI {
    private static readonly BASE_URL = 'https://api.mexc.com/api/v3';

    /**
     * Get current price for a single symbol
     */
    static async getCurrentPrice(symbol: string): Promise<number> {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker/price?symbol=${symbol}`);

            if (!response.ok) {
                throw new Error(`MEXC API error: ${response.status}`);
            }

            const data: MexcTickerPrice = await response.json();
            return parseFloat(data.price);
        } catch (error) {
            // CORS error is expected when calling MEXC from browser
            // App automatically falls back to Binance prices or simulated data
            if (process.env.NODE_ENV === 'development') {
                console.info(`📊 MEXC API unavailable for ${symbol} (browser CORS restriction) - using fallback data`);
            }
            throw error; // Re-throw for fallback mechanism
        }
    }

    /**
     * Get current prices for multiple symbols
     */
    static async getMultiplePrices(symbols: string[]): Promise<Map<string, number>> {
        try {
            const response = await fetch(`${this.BASE_URL}/ticker/price`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });

            if (!response.ok) {
                console.warn(`MEXC API returned ${response.status}, using fallback`);
                throw new Error(`MEXC API error: ${response.status}`);
            }

            const data: MexcTickerPrice[] = await response.json();
            const priceMap = new Map<string, number>();

            // Filter for requested symbols
            for (const ticker of data) {
                if (symbols.includes(ticker.symbol)) {
                    priceMap.set(ticker.symbol, parseFloat(ticker.price));
                }
            }

            return priceMap;
        } catch (error) {
            console.warn('MEXC API unavailable, returning empty map for fallback handling');
            // Return empty map so the calling code can handle the fallback
            return new Map<string, number>();
        }
    }

    /**
     * Convert our pair format to MEXC symbol format
     * BTC/USDT -> BTCUSDT
     */
    static pairToMexcSymbol(pair: string): string {
        return pair.replace('/', '');
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
}
