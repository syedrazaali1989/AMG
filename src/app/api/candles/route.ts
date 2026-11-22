import { NextRequest, NextResponse } from 'next/server';
import { BinanceAPI } from '@/lib/signals/binanceAPI';

export const dynamic = 'force-dynamic';

/**
 * GET /api/candles
 *
 * Recent OHLC candles for one pair, fetched server-side from Binance's
 * public market-data domain (data-api.binance.vision, via BinanceAPI -
 * the same source every other route in this codebase uses). Used by the
 * signal-card charts on the dashboard.
 *
 * Query params:
 *   pair=BTC/USDT   (required, "BASE/QUOTE" format)
 *   interval=1h     (one of 1m, 5m, 15m, 1h, 4h, 1d; default 1h)
 *   limit=100       (10-500, default 100)
 *
 * If live candle data cannot be fetched, this returns 502 and the card
 * shows a plain "chart unavailable" note - candles are NEVER simulated.
 */

const ALLOWED_INTERVALS = new Set(['1m', '5m', '15m', '1h', '4h', '1d']);
const PAIR_PATTERN = /^[A-Za-z0-9]{2,15}\/[A-Za-z0-9]{2,15}$/;

// Short server-side cache so a page full of signal cards (and concurrent
// visitors) share one upstream fetch per pair (mirrors /api/signals).
const CACHE_DURATION = 60 * 1000; // 60 seconds

interface CandlePoint {
    time: number; // Unix seconds (lightweight-charts UTCTimestamp)
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

const candleCache = new Map<string, { candles: CandlePoint[]; timestamp: number }>();

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const pair = (searchParams.get('pair') || '').toUpperCase();
        const interval = (searchParams.get('interval') || '1h').toLowerCase();
        const limitParam = parseInt(searchParams.get('limit') || '100', 10);
        const limit = Number.isFinite(limitParam)
            ? Math.min(500, Math.max(10, limitParam))
            : 100;

        if (!PAIR_PATTERN.test(pair)) {
            return NextResponse.json(
                { error: 'A valid pair (e.g. BTC/USDT) is required' },
                { status: 400 }
            );
        }
        if (!ALLOWED_INTERVALS.has(interval)) {
            return NextResponse.json(
                { error: `Unsupported interval: ${interval}` },
                { status: 400 }
            );
        }

        const cacheKey = `${pair}|${interval}|${limit}`;
        const now = Date.now();
        const cached = candleCache.get(cacheKey);
        if (cached && now - cached.timestamp < CACHE_DURATION) {
            return NextResponse.json({
                pair,
                interval,
                candles: cached.candles,
                cached: true
            });
        }

        // Throws when live data is unavailable - there is no fallback.
        const raw = await BinanceAPI.getCandles(pair, interval, limit);
        const candles: CandlePoint[] = raw.map(c => ({
            time: Math.floor(c.timestamp / 1000),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume
        }));

        if (candles.length === 0) {
            return NextResponse.json(
                { error: 'Live candle data unavailable' },
                { status: 502 }
            );
        }

        candleCache.set(cacheKey, { candles, timestamp: now });

        return NextResponse.json({
            pair,
            interval,
            candles,
            cached: false
        });
    } catch (error) {
        console.error('Candle fetch error:', error);
        return NextResponse.json(
            { error: 'Live candle data unavailable' },
            { status: 502 }
        );
    }
}
