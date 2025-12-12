import { NextResponse } from 'next/server';

// Cache prices for 2 seconds to avoid rate limits
let priceCache: { prices: Record<string, number>; timestamp: number } | null = null;
const CACHE_DURATION = 2000; // 2 seconds

export async function GET() {
    try {
        // Check cache
        const now = Date.now();
        if (priceCache && (now - priceCache.timestamp) < CACHE_DURATION) {
            return NextResponse.json({
                prices: priceCache.prices,
                cached: true,
                timestamp: priceCache.timestamp
            });
        }

        // Fetch from Binance (server-side, no CORS)
        const response = await fetch('https://api.binance.com/api/v3/ticker/price');

        if (!response.ok) {
            throw new Error(`Binance API error: ${response.status}`);
        }

        const data = await response.json();

        // Convert to simple object
        const prices: Record<string, number> = {};
        for (const item of data) {
            prices[item.symbol] = parseFloat(item.price);
        }

        // Update cache
        priceCache = {
            prices,
            timestamp: now
        };

        return NextResponse.json({
            prices,
            cached: false,
            timestamp: now
        });
    } catch (error) {
        console.error('Price fetch error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch prices' },
            { status: 500 }
        );
    }
}
