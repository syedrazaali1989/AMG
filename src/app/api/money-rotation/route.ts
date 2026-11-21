import { NextResponse } from 'next/server';
import { computeMoneyRotation } from '@/lib/signals/moneyRotation';

export const dynamic = 'force-dynamic';

/**
 * GET /api/money-rotation
 *
 * Money rotation across the scan universe, computed server-side from
 * live Binance data: each pair's quote-volume share (last 24h vs the
 * 24h before) and relative strength vs BTC (1h/4h/24h), combined into a
 * published rotation score. Returns the rotation table only - trade
 * signals derived from this table were backtested on 90 days of data,
 * did not perform, and are disabled (2026-11-21).
 *
 * If the BTC benchmark or most of the universe cannot be loaded, this
 * returns 502 - rotation is NEVER computed from simulated data.
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
            result = await computeMoneyRotation();
        } catch {
            return NextResponse.json(
                { error: 'Live market data unavailable' },
                { status: 502 }
            );
        }

        const payload = { ...result, cached: false };
        cache = { payload, timestamp: now };

        return NextResponse.json(payload);
    } catch (error) {
        console.error('Money rotation error:', error);
        return NextResponse.json(
            { error: 'Live market data unavailable' },
            { status: 502 }
        );
    }
}
