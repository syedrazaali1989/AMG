import { NextRequest, NextResponse } from 'next/server';
import { MarketDataManager } from '@/lib/signals/marketData';
import { SignalGenerator } from '@/lib/signals/generator';
import { MarketType, SignalType } from '@/lib/signals/types';

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
 *   type=SPOT|FUTURE         (default FUTURE)
 *   pairs=BTC/USDT,ETH/USDT  (optional, defaults to the standard scan list)
 *
 * If live market data cannot be fetched at all, this returns 502 and the
 * dashboard shows a "live data unavailable" state - signals are NEVER
 * generated from simulated prices.
 */

// Standard scan list (the site's default crypto universe)
const DEFAULT_PAIRS = [
    'BTC/USDT', 'ETH/USDT', 'BNB/USDT', 'SOL/USDT', 'XRP/USDT', 'DOGE/USDT',
    'ADA/USDT', 'AVAX/USDT', 'DOT/USDT', 'LINK/USDT', 'UNI/USDT', 'NEAR/USDT',
    'SUI/USDT', 'OP/USDT', 'ARB/USDT', 'MATIC/USDT', 'ATOM/USDT', 'FIL/USDT',
    'INJ/USDT', 'RNDR/USDT', 'FET/USDT', 'TIA/USDT', 'PEPE/USDT', 'WLD/USDT'
];

// Short server-side cache so concurrent visitors share one generation pass
// (mirrors the /api/binance/prices caching pattern).
const CACHE_DURATION = 60 * 1000; // 60 seconds
const signalCache = new Map<string, { signals: unknown[]; timestamp: number }>();

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const market = (searchParams.get('market') || 'CRYPTO').toUpperCase();
        const typeParam = (searchParams.get('type') || 'FUTURE').toUpperCase();

        if (market !== 'CRYPTO') {
            return NextResponse.json(
                { error: 'Only CRYPTO signals are served: no live data source is available for other markets' },
                { status: 400 }
            );
        }

        const signalType = typeParam === 'SPOT' ? SignalType.SPOT : SignalType.FUTURE;

        const pairsParam = searchParams.get('pairs');
        const pairs = pairsParam
            ? pairsParam.split(',').map(p => p.trim()).filter(Boolean).slice(0, 30)
            : DEFAULT_PAIRS;

        const cacheKey = `${market}|${signalType}|${pairs.join(',')}`;
        const now = Date.now();
        const cached = signalCache.get(cacheKey);
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            return NextResponse.json({
                signals: cached.signals,
                generatedAt: new Date(cached.timestamp).toISOString(),
                cached: true
            });
        }

        // Fetch live market data per pair; pairs that fail are skipped.
        const results = await Promise.allSettled(
            pairs.map(pair => MarketDataManager.generateMarketData(pair, MarketType.CRYPTO, 100))
        );

        const marketDataList = results
            .filter(r => r.status === 'fulfilled')
            .map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof MarketDataManager.generateMarketData>>>).value);

        if (marketDataList.length === 0) {
            // Live data is down: say so, never fall back to simulated prices.
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        const signals = await SignalGenerator.generateMultipleSignals(marketDataList, signalType);

        signalCache.set(cacheKey, { signals: signals as unknown[], timestamp: now });

        return NextResponse.json({
            signals,
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
