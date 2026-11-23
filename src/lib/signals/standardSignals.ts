import { MarketDataManager } from './marketData';
import { BinanceAPI } from './binanceAPI';
import { SignalGenerator } from './generator';
import { MarketType, Signal, SignalType } from './types';

/**
 * Server-side generation for the standard crypto engine - the code path
 * behind GET /api/signals, shared with the push-notification watcher so
 * both always evaluate the exact same engine on the exact same data.
 *
 * REAL DATA ONLY: pairs whose live market data cannot be fetched are
 * skipped; if NO pair loads, pairsLoaded is 0 and callers must treat
 * that as "live data unavailable" - signals are NEVER generated from
 * simulated prices.
 */

// Standard scan list (the site's default crypto universe)
export const STANDARD_DEFAULT_PAIRS = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT',
    'ADA/USDT', 'AVAX/USDT', 'DOT/USDT', 'LINK/USDT', 'UNI/USDT', 'NEAR/USDT',
    'SUI/USDT', 'OP/USDT', 'ARB/USDT', 'MATIC/USDT', 'ATOM/USDT', 'FIL/USDT',
    'INJ/USDT', 'RNDR/USDT', 'FET/USDT', 'TIA/USDT', 'PEPE/USDT', 'WLD/USDT'
];

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface StandardSignalsResult {
    signals: Signal[];
    /**
     * pair -> open time (ms) of the last fully closed 1H candle the scan
     * evaluated. The engine re-issues deterministically per closed bar,
     * so this is the stable "issued at" anchor for a signal even though
     * the generator stamps each Signal object with wall-clock time.
     */
    barAnchors: Map<string, number>;
    /** How many pairs returned live market data (0 = live data down). */
    pairsLoaded: number;
    generatedAt: string;
}

function lastClosedHourlyBarOpen(timestamps: Date[]): number {
    const now = Date.now();
    let anchor = 0;
    for (const t of timestamps) {
        const ms = t.getTime();
        if (ms + ONE_HOUR_MS <= now && ms > anchor) anchor = ms;
    }
    if (anchor > 0) return anchor;
    // Fallback: floor the latest timestamp to the hour.
    const last = timestamps.length > 0 ? timestamps[timestamps.length - 1].getTime() : now;
    return Math.floor(last / ONE_HOUR_MS) * ONE_HOUR_MS;
}

export async function generateStandardSignals(
    pairs: string[] = STANDARD_DEFAULT_PAIRS,
    signalType: SignalType = SignalType.FUTURE
): Promise<StandardSignalsResult> {
    // Fetch live market data per pair; pairs that fail are skipped.
    const results = await Promise.allSettled(
        pairs.map(pair => MarketDataManager.generateMarketData(pair, MarketType.CRYPTO, 100))
    );

    const marketDataList = results
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof MarketDataManager.generateMarketData>>>).value);

    const barAnchors = new Map<string, number>();
    for (const md of marketDataList) {
        barAnchors.set(md.pair, lastClosedHourlyBarOpen(md.timestamps));
    }

    if (marketDataList.length === 0) {
        return { signals: [], barAnchors, pairsLoaded: 0, generatedAt: new Date().toISOString() };
    }

    // Enrich each pair with the signal-quality filter context:
    //  - closes4h:   the pair's 4H closes (multi-timeframe filter)
    //  - btcTrend:   market-wide BTC regime vs its 4H EMA200 (fetched once)
    //  - fundingRate: latest futures funding (FUTURE signals only)
    // Any piece that fails to load stays undefined and its filter
    // simply does not block - context failure never invents data and
    // never blocks signal generation.
    const btcTrend = await BinanceAPI.getBtcRegime();
    await Promise.allSettled(
        marketDataList.map(async (md) => {
            md.btcTrend = btcTrend;
            try {
                md.closes4h = await BinanceAPI.get4hCloses(md.pair, 250);
            } catch {
                console.warn(`4H closes unavailable for ${md.pair} (MTF filter neutral)`);
            }
            if (signalType === SignalType.FUTURE) {
                md.fundingRate = await BinanceAPI.getFundingRate(md.pair);
            }
        })
    );

    const signals = await SignalGenerator.generateMultipleSignals(marketDataList, signalType);

    return { signals, barAnchors, pairsLoaded: marketDataList.length, generatedAt: new Date().toISOString() };
}
