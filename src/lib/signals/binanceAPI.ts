// Binance API Integration for Real-Time Crypto Prices

import { TechnicalIndicators } from './indicators';

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
    // Spot REST base. Deliberately data-api.binance.vision, NOT
    // api.binance.com: api.binance.com geo-blocks (HTTP 451) requests from
    // the US IPs that Vercel serverless functions run on, which made every
    // server-side price/kline fetch fail in production (the old client-side
    // code worked only because the visitor's own browser fetched prices).
    // data-api.binance.vision is Binance's official public market-data
    // domain and serves the same spot prices/klines without that block.
    private static readonly BASE_URL = 'https://data-api.binance.vision/api/v3';
    private static readonly FUTURES_BASE_URL = 'https://fapi.binance.com/fapi/v1';

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
            // Binance is unreachable (network/CORS/geo). There is NO simulated
            // fallback: callers must treat this as "live data unavailable".
            if (process.env.NODE_ENV === 'development') {
                console.info(`📊 Binance API unavailable for ${symbol}`);
            }
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
        highs: number[];
        lows: number[];
        volumes: number[];
        timestamps: Date[];
    }> {
        try {
            const symbol = this.pairToBinanceSymbol(pair);

            // Get historical klines (100 hours of data)
            const klines = await this.getKlines(symbol, '1h', 100);

            const prices: number[] = [];
            const highs: number[] = [];
            const lows: number[] = [];
            const volumes: number[] = [];
            const timestamps: Date[] = [];

            for (const kline of klines) {
                const closePrice = parseFloat(String(kline[4])); // Close price
                const highPrice = parseFloat(String(kline[2])); // High price
                const lowPrice = parseFloat(String(kline[3])); // Low price
                const volume = parseFloat(String(kline[5])); // Volume
                const timestamp = new Date(kline[0]); // Open time

                prices.push(closePrice);
                highs.push(highPrice);
                lows.push(lowPrice);
                volumes.push(volume);
                timestamps.push(timestamp);
            }

            const currentPrice = prices[prices.length - 1];

            return {
                currentPrice,
                prices,
                highs,
                lows,
                volumes,
                timestamps
            };
        } catch (error) {
            // No fallback: propagate so callers can show "live data unavailable"
            throw error;
        }
    }

    /**
     * Get scalping market data with real prices (5-minute candles)
     * Optimized for short-term scalping signals
     */
    static async getScalpingMarketData(pair: string): Promise<{
        currentPrice: number;
        prices: number[];
        volumes: number[];
        highs: number[];
        lows: number[];
        timestamps: Date[];
    }> {
        try {
            const symbol = this.pairToBinanceSymbol(pair);

            // Get 5-minute klines (48 candles = 4 hours of data for scalping)
            const klines = await this.getKlines(symbol, '5m', 48);

            const prices: number[] = [];
            const volumes: number[] = [];
            const highs: number[] = [];
            const lows: number[] = [];
            const timestamps: Date[] = [];

            for (const kline of klines) {
                const closePrice = parseFloat(String(kline[4])); // Close price
                const volume = parseFloat(String(kline[5])); // Volume
                const highPrice = parseFloat(String(kline[2])); // High price
                const lowPrice = parseFloat(String(kline[3])); // Low price
                const timestamp = new Date(kline[0]); // Open time

                prices.push(closePrice);
                volumes.push(volume);
                highs.push(highPrice);
                lows.push(lowPrice);
                timestamps.push(timestamp);
            }

            const currentPrice = prices[prices.length - 1];

            return {
                currentPrice,
                prices,
                volumes,
                highs,
                lows,
                timestamps
            };
        } catch (error) {
            // Silently fall back - scalpingMarketData.ts handles this gracefully
            throw error;
        }
    }

    /**
     * Get 4H candle closes for a pair (oldest first). Used by the
     * multi-timeframe confirmation filter: 250 closes cover the EMA200
     * warmup on the 4H timeframe. The last entry is the in-progress 4H
     * candle (its close tracks the latest price).
     */
    static async get4hCloses(pair: string, limit: number = 250): Promise<number[]> {
        const symbol = this.pairToBinanceSymbol(pair);
        const klines = await this.getKlines(symbol, '4h', limit);
        return klines.map(kline => parseFloat(String(kline[4])));
    }

    /**
     * Market-wide BTC regime for the regime filter: 'UP' when the latest
     * BTCUSDT price is above its 4H EMA200, 'DOWN' when below, 'NEUTRAL'
     * when there is not enough data. Returns undefined when live data is
     * unavailable (the filter then does not block).
     */
    static async getBtcRegime(): Promise<'UP' | 'DOWN' | 'NEUTRAL' | undefined> {
        try {
            const closes = await this.get4hCloses('BTC/USDT', 250);
            if (closes.length < 200) return 'NEUTRAL';
            const ema200 = TechnicalIndicators.calculateEMA(closes, 200);
            const price = closes[closes.length - 1];
            return price > ema200 ? 'UP' : 'DOWN';
        } catch (error) {
            console.warn('BTC regime unavailable (filter neutral):', error);
            return undefined;
        }
    }

    /**
     * Latest futures funding rate for a pair as a decimal fraction
     * (0.0005 = 0.05%), from the Binance futures premiumIndex endpoint.
     * There is no data-api.binance.vision equivalent for futures, and the
     * endpoint may be unreachable (e.g. geo-blocked server IPs): any
     * failure returns undefined, which the funding filter treats as
     * neutral - it never blocks on missing data.
     */
    static async getFundingRate(pair: string): Promise<number | undefined> {
        try {
            const symbol = this.pairToBinanceSymbol(pair);
            const response = await fetch(
                `${this.FUTURES_BASE_URL}/premiumIndex?symbol=${symbol}`
            );
            if (!response.ok) {
                throw new Error(`Binance futures API error: ${response.status}`);
            }
            const data = await response.json();
            const rate = parseFloat(data.lastFundingRate);
            return isNaN(rate) ? undefined : rate;
        } catch (error) {
            console.warn(`Funding rate unavailable for ${pair} (filter neutral):`, error);
            return undefined;
        }
    }
}
