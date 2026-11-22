import { NextResponse } from 'next/server';
import { generateGoldSignals } from '@/lib/signals/goldSignals';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gold/signals
 *
 * Server-side generation for the Gold page. The dedicated gold
 * engine (goldEngineCore, configuration G6 plus the F+B issuance
 * rules - London / New York session gate, 72h expiry) runs here
 * against live PAXG/USDT data from Binance spot, so every visitor
 * sees the same signal for the same market state. PAXG is tokenised gold
 * (1 PAXG = 1 troy ounce); Binance spot lists no direct XAU pair,
 * and no simulated price source is ever used.
 *
 * The engine evaluates ONE instrument, so the response carries zero
 * or one signal, plus the live PAXG price the evaluation ran on.
 * If live data cannot be fetched (or is stale), this returns 502 -
 * signals are NEVER generated from simulated prices.
 */

const CACHE_DURATION = 60 * 1000; // 60 seconds
let cache: { payload: unknown; timestamp: number } | null = null;

export async function GET() {
    try {
        const now = Date.now();
        if (cache && now - cache.timestamp < CACHE_DURATION) {
            return NextResponse.json({ ...(cache.payload as object), cached: true });
        }

        let result;
        try {
            result = await generateGoldSignals();
        } catch {
            // Live data is down: say so, never fall back to simulated data.
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        const payload = {
            signals: result.signals,
            price: result.price,
            issued: result.issued,
            generatedAt: result.generatedAt,
            cached: false
        };
        cache = { payload, timestamp: now };

        return NextResponse.json(payload);
    } catch (error) {
        console.error('Gold signal generation error:', error);
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }
}
