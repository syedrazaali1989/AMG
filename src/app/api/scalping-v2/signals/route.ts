import { NextRequest, NextResponse } from 'next/server';
import { generateScalpingV2Signals, SCALPING_V2_PAIRS } from '@/lib/signals/scalpingV2';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scalping-v2/signals
 *
 * Server-side generation for the Scalping V2 (ICT / Smart Money) page.
 * The engine that used to run in each visitor's browser on the amg-eight
 * deployment now runs here, against live Binance data, so every visitor
 * sees the same signals for the same market state.
 *
 * Query params:
 *   pairs=BTC/USDT,ETH/USDT  (optional, defaults to the 54-pair universe)
 *
 * The response includes the gate funnel (how many pairs were loaded,
 * rejected as stale, filtered at each engine stage) so the scan is
 * auditable. If NO pair could be loaded with fresh data, this returns
 * 502 - signals are NEVER generated from simulated candles.
 */

const CACHE_DURATION = 60 * 1000; // 60 seconds
const cache = new Map<string, { payload: unknown; timestamp: number }>();

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const pairsParam = searchParams.get('pairs');
        const pairs = pairsParam
            ? pairsParam.split(',').map(p => p.trim()).filter(Boolean).slice(0, 60)
            : SCALPING_V2_PAIRS;

        const cacheKey = pairs.join(',');
        const now = Date.now();
        const cached = cache.get(cacheKey);
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            return NextResponse.json({ ...(cached.payload as object), cached: true });
        }

        let result;
        try {
            result = await generateScalpingV2Signals(pairs);
        } catch {
            // Live data is down: say so, never fall back to simulated data.
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        const payload = {
            signals: result.signals,
            funnel: result.funnel,
            generatedAt: result.generatedAt,
            cached: false
        };
        cache.set(cacheKey, { payload, timestamp: now });

        return NextResponse.json(payload);
    } catch (error) {
        console.error('Scalping V2 signal generation error:', error);
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }
}
