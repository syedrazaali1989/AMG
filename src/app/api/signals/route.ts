import { NextRequest, NextResponse } from 'next/server';
import { generateStandardSignals, STANDARD_DEFAULT_PAIRS } from '@/lib/signals/standardSignals';
import { SignalType } from '@/lib/signals/types';
import { maybeCheckAndNotify } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';

/**
 * GET /api/signals
 *
 * Server-side signal generation. The SAME engine that used to run in each
 * visitor's browser now runs here, against live Binance data, so every
 * visitor sees the same signals for the same market state.
 *
 * Query params:
 *   market=CRYPTO            (only CRYPTO is served; forex has no live source)
 *   pairs=BTC/USDT,ETH/USDT  (optional, defaults to the standard scan list)
 *
 * Futures only: there is no type parameter and no SPOT path. The site
 * serves futures signals exclusively.
 *
 * If live market data cannot be fetched at all, this returns 502 and the
 * dashboard shows a "live data unavailable" state - signals are NEVER
 * generated from simulated prices.
 *
 * Side effect: a successful response opportunistically triggers the
 * push-notification watcher (throttled, fire-and-forget, fully guarded -
 * it can never break or delay this response).
 */

// Short server-side cache so concurrent visitors share one generation pass
// (mirrors the /api/binance/prices caching pattern).
const CACHE_DURATION = 60 * 1000; // 60 seconds
const signalCache = new Map<string, { signals: unknown[]; timestamp: number }>();

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const market = (searchParams.get('market') || 'CRYPTO').toUpperCase();

        if (market !== 'CRYPTO') {
            return NextResponse.json(
                { error: 'Only CRYPTO signals are served: no live data source is available for other markets' },
                { status: 400 }
            );
        }

        // Futures only - the site serves no spot signals.
        const signalType = SignalType.FUTURE;

        const pairsParam = searchParams.get('pairs');
        const pairs = pairsParam
            ? pairsParam.split(',').map(p => p.trim()).filter(Boolean).slice(0, 30)
            : STANDARD_DEFAULT_PAIRS;

        const cacheKey = `${market}|${pairs.join(',')}`;
        const now = Date.now();
        const cached = signalCache.get(cacheKey);
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            void maybeCheckAndNotify();
            return NextResponse.json({
                signals: cached.signals,
                generatedAt: new Date(cached.timestamp).toISOString(),
                cached: true
            });
        }

        const result = await generateStandardSignals(pairs, signalType);

        if (result.pairsLoaded === 0) {
            // Live data is down: say so, never fall back to simulated prices.
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        signalCache.set(cacheKey, { signals: result.signals as unknown[], timestamp: now });

        void maybeCheckAndNotify();
        return NextResponse.json({
            signals: result.signals,
            generatedAt: new Date(now).toISOString(),
            cached: false
        });
    } catch (error) {
        console.error('Signal generation error:', error);
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }
}
