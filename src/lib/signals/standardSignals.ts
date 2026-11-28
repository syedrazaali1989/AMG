import { MarketDataManager } from './marketData';
import { BinanceAPI } from './binanceAPI';
import { SignalGenerator } from './generator';
import { MarketType, Signal, SignalType } from './types';
import type { TickKlineCache } from './klineCache';

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

/**
 * Open time (ms) of the last fully closed bar of `barMs` in a candle
 * series. Shared by the push watcher anchors: the standard engine uses
 * it for 1H bars, the scalping engine for 5m bars, the on-chain engine
 * for its 1H decision bar. A bar counts as closed once its full span
 * has elapsed (open + barMs <= now); the latest timestamp is floored
 * only as a fallback when no bar in the series is fully closed yet.
 */
export function lastClosedBarOpen(timestamps: Date[], barMs: number): number {
    const now = Date.now();
    let anchor = 0;
    for (const t of timestamps) {
        const ms = t.getTime();
        if (ms + barMs <= now && ms > anchor) anchor = ms;
    }
    if (anchor > 0) return anchor;
    // Fallback: floor the latest timestamp to the bar grid.
    const last = timestamps.length > 0 ? timestamps[timestamps.length - 1].getTime() : now;
    return Math.floor(last / barMs) * barMs;
}

function lastClosedHourlyBarOpen(timestamps: Date[]): number {
    return lastClosedBarOpen(timestamps, ONE_HOUR_MS);
}

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

export async function generateStandardSignals(
    pairs: string[] = STANDARD_DEFAULT_PAIRS,
    signalType: SignalType = SignalType.FUTURE,
    cache?: TickKlineCache
): Promise<StandardSignalsResult> {
    // Fetch live market data per pair; pairs that fail are skipped.
    const results = await Promise.allSettled(
        pairs.map(pair => MarketDataManager.generateMarketData(pair, MarketType.CRYPTO, 100, cache))
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
    //  - fundingRate: latest futures funding (FUTURE signals only) — ONE
    //    bulk premiumIndex call for the whole tick, not one call per pair:
    //    the per-pair calls 451-fail one by one from Vercel IPs, and the
    //    bulk call returns the same per-symbol values whenever the
    //    endpoint is reachable (see BinanceAPI.getFundingRates).
    // Any piece that fails to load stays undefined and its filter
    // simply does not block - context failure never invents data and
    // never blocks signal generation.
    const btcTrend = await BinanceAPI.getBtcRegime(cache);
    const fundingPromise = signalType === SignalType.FUTURE
        ? BinanceAPI.getFundingRates()
        : Promise.resolve(new Map<string, number>());
    await Promise.allSettled(
        marketDataList.map(async (md) => {
            md.btcTrend = btcTrend;
            try {
                md.closes4h = await BinanceAPI.get4hCloses(md.pair, 250, cache);
            } catch {
                console.warn(`4H closes unavailable for ${md.pair} (MTF filter neutral)`);
            }
            if (signalType === SignalType.FUTURE) {
                md.fundingRate = (await fundingPromise).get(BinanceAPI.pairToBinanceSymbol(md.pair));
            }
        })
    );

    const signals = await SignalGenerator.generateMultipleSignals(marketDataList, signalType);

    return { signals, barAnchors, pairsLoaded: marketDataList.length, generatedAt: new Date().toISOString() };
}
