import { NextRequest, NextResponse } from 'next/server';
import { ScalpingSignalGenerator } from '@/lib/signals/scalpingGenerator';
import { MarketDataManager } from '@/lib/signals/marketData';
import { SignalType, MarketType, type Signal } from '@/lib/signals/types';
import { syncScalpingHistory } from '@/lib/history/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scalping/signals
 *
 * Server-side generation for the old /scalping page (5m candles,
 * 15-60 minute targets). The engine that used to run in each visitor's
 * browser - with a random 30-pair shuffle, so every visitor saw
 * different signals and there was no shared record - now runs here
 * against live Binance data, so every visitor sees the same signals
 * for the same market state.
 *
 * Futures only, crypto only:
 *   - The engine is called with SignalType.FUTURE always. There is no
 *     type parameter and no SPOT path anywhere on the site.
 *   - Only CRYPTO is served. FOREX scalping had no live 5m data source
 *     (the Exness feed is simulated prices), so it is not served at
 *     all: a market other than CRYPTO gets a 400, never fake signals.
 *
 * Universe: the top 30 pairs of MarketDataManager.getCryptoPairs()
 * (top market cap, deterministic - the old page scanned a random 30
 * each time). MATIC/USDT is mapped to POL/USDT (Binance renamed the
 * token; the old MATIC spot series is dead), mirroring the
 * scalping-v2 fix.
 *
 * Expiry: the generator sets none, so the route stamps +4h (the
 * short-horizon family convention, same as scalping-v2). Without an
 * expiry a 15-minute setup could sit "active" in history for 48h and
 * block re-issues of the same pair+direction.
 *
 * If live market data cannot be fetched for every pair, this returns
 * 502 - signals are NEVER generated from simulated prices.
 */

const CACHE_DURATION = 60 * 1000; // 60 seconds
const cache = new Map<string, { payload: unknown; timestamp: number }>();

const SCALPING_UNIVERSE_SIZE = 30;
const SCALPING_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

/** MATIC was renamed to POL on Binance; the old MATIC spot series is dead. */
function toLivePair(pair: string): string {
    return pair === 'MATIC/USDT' ? 'POL/USDT' : pair;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const market = (searchParams.get('market') || 'CRYPTO').toUpperCase();

        if (market !== 'CRYPTO') {
            return NextResponse.json(
                { error: 'Only CRYPTO scalping signals are served: forex scalping has no live 5-minute data source' },
                { status: 400 }
            );
        }

        const cacheKey = 'CRYPTO';
        const now = Date.now();
        const cached = cache.get(cacheKey);
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            return NextResponse.json({ ...(cached.payload as object), cached: true });
        }

        const pairs = MarketDataManager.getCryptoPairs()
            .slice(0, SCALPING_UNIVERSE_SIZE)
            .map(pair => ({ pair: toLivePair(pair), marketType: MarketType.CRYPTO }));

        // One generator call per pair, run in parallel: the generator
        // scans sequentially, and 30 sequential Binance calls would risk
        // the serverless timeout. The engine, parameters and scoring are
        // identical - only the call shape changes. A failed pair is
        // skipped; if every pair fails the scan throws (honest 502).
        const settled = await Promise.allSettled(
            pairs.map(({ pair, marketType }) =>
                ScalpingSignalGenerator.generateScalpingSignals(
                    [{ pair, marketType }],
                    SignalType.FUTURE,
                    { strict: true }
                )
            )
        );

        const signals: Signal[] = [];
        let failedPairs = 0;
        for (const result of settled) {
            if (result.status === 'fulfilled') {
                signals.push(...result.value.signals);
            } else {
                failedPairs++;
            }
        }

        if (failedPairs === pairs.length) {
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        signals.sort((a, b) => b.confidence - a.confidence);
        const expiresAt = new Date(now + SCALPING_EXPIRY_MS);
        for (const signal of signals) {
            signal.expiresAt = expiresAt;
        }

        const payload = {
            signals,
            pairsScanned: pairs.length - failedPairs,
            generatedAt: new Date(now).toISOString(),
            cached: false
        };
        cache.set(cacheKey, { payload, timestamp: now });

        // Record for the server-side history (fire-and-forget, guarded -
        // it can never break or delay this response).
        void syncScalpingHistory(signals).catch(() => undefined);

        return NextResponse.json(payload);
    } catch (error) {
        console.error('Scalping signal generation error:', error);
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }
}
