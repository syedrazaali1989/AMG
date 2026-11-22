/**
 * Coin pages - server-side market data + technical snapshot.
 *
 * The coin universe is EXACTLY the Scalping V2 scan universe
 * (SCALPING_V2_PAIRS, 53 USDT pairs): the pairs this site's engines
 * actually trade. Every value comes from live Binance spot data via
 * BinanceAPI (data-api.binance.vision). Nothing is simulated and no
 * "fundamental score" or rating is invented - the snapshot is purely
 * computed indicators over real candles.
 *
 * Freshness rule (same gate the engines use): if the pair's 1H candle
 * series is frozen - e.g. FTM/USDT, whose Binance spot series stopped
 * in Jan 2025 - the data is reported as 'stale' and the page shows an
 * honest notice instead of presenting old prices as live.
 */

import { SCALPING_V2_PAIRS } from './scalpingV2';
import { BinanceAPI } from './binanceAPI';
import { TechnicalIndicators } from './indicators';
import { calculateATR } from './engineCore';

export interface CoinInfo {
    /** Display pair, e.g. 'BTC/USDT' */
    pair: string;
    /** Binance symbol, e.g. 'BTCUSDT' - also the /coin/[pair] route param */
    symbol: string;
    base: string;
    quote: string;
}

export const COIN_PAIRS: CoinInfo[] = SCALPING_V2_PAIRS.map(pair => {
    const [base, quote] = pair.split('/');
    return { pair, symbol: `${base}${quote}`, base, quote };
});

const COIN_BY_SYMBOL = new Map(COIN_PAIRS.map(c => [c.symbol, c]));

/** Resolve a route param ('BTCUSDT', 'btcusdt', 'BTC/USDT') to a coin, or undefined. */
export function findCoin(rawParam: string): CoinInfo | undefined {
    const symbol = decodeURIComponent(rawParam).toUpperCase().replace('/', '');
    return COIN_BY_SYMBOL.get(symbol);
}

export interface CoinTechnicals {
    rsi14: number;
    sma50: number;
    sma200: number;
    ema50: number;
    atr14: number;
    /** Latest close vs SMA 200 */
    priceVsSma200: 'ABOVE' | 'BELOW';
    /** Open time (ms) of the most recent 1H candle used */
    lastCandleTime: number;
}

export interface CoinMarketData {
    info: CoinInfo;
    price: number;
    changePct24h: number;
    high24h: number;
    low24h: number;
    quoteVolume24h: number;
    technicals: CoinTechnicals;
}

export type CoinDataResult =
    | { status: 'ok'; data: CoinMarketData }
    | { status: 'stale' }
    | { status: 'unavailable' };

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function getCoinMarketData(info: CoinInfo): Promise<CoinDataResult> {
    let ticker;
    let candles;
    try {
        [ticker, candles] = await Promise.all([
            BinanceAPI.get24hTicker(info.symbol),
            BinanceAPI.getCandles(info.pair, '1h', 250)
        ]);
    } catch {
        return { status: 'unavailable' };
    }

    if (candles.length < 200 || !BinanceAPI.isCandleSeriesFresh(candles, ONE_HOUR_MS)) {
        return { status: 'stale' };
    }

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const price = parseFloat(ticker.lastPrice);
    const sma200 = TechnicalIndicators.calculateSMA(closes, 200);

    return {
        status: 'ok',
        data: {
            info,
            price,
            changePct24h: parseFloat(ticker.priceChangePercent),
            high24h: parseFloat(ticker.highPrice),
            low24h: parseFloat(ticker.lowPrice),
            quoteVolume24h: parseFloat(ticker.quoteVolume),
            technicals: {
                rsi14: TechnicalIndicators.calculateRSI(closes, 14),
                sma50: TechnicalIndicators.calculateSMA(closes, 50),
                sma200,
                ema50: TechnicalIndicators.calculateEMA(closes, 50),
                atr14: calculateATR(closes, highs, lows, 14),
                priceVsSma200: price >= sma200 ? 'ABOVE' : 'BELOW',
                lastCandleTime: candles[candles.length - 1].timestamp
            }
        }
    };
}

export interface CoinListRow {
    info: CoinInfo;
    price: number;
    changePct24h: number;
    /** True when Binance's 24h window for this pair is frozen (e.g. FTM). */
    stale: boolean;
}

export type CoinListResult =
    | { status: 'ok'; rows: CoinListRow[] }
    | { status: 'unavailable' };

/** All universe pairs with live price + 24h change, from one upstream call. */
export async function getCoinList(): Promise<CoinListResult> {
    let tickers;
    try {
        tickers = await BinanceAPI.getAll24hTickers();
    } catch {
        return { status: 'unavailable' };
    }

    const bySymbol = new Map(tickers.map(t => [t.symbol, t]));
    const now = Date.now();
    const rows: CoinListRow[] = [];

    for (const info of COIN_PAIRS) {
        const t = bySymbol.get(info.symbol);
        if (!t) continue;
        rows.push({
            info,
            price: parseFloat(t.lastPrice),
            changePct24h: parseFloat(t.priceChangePercent),
            // A live pair's 24h window always closes at ~now; a frozen
            // pair's window ended long ago.
            stale: now - t.closeTime > 3 * ONE_HOUR_MS
        });
    }

    if (rows.length === 0) return { status: 'unavailable' };
    return { status: 'ok', rows };
}

/**
 * Price formatter for coin pages: like the site's formatPrice, but keeps
 * enough decimals for sub-cent coins (PEPE, SHIB) instead of rounding
 * them to 0.00.
 */
export function formatCoinPrice(price: number): string {
    if (!Number.isFinite(price)) return '-';
    if (price >= 1000) {
        return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (price >= 1) return price.toFixed(2);
    if (price >= 0.01) return price.toFixed(4);
    return price.toFixed(8);
}
