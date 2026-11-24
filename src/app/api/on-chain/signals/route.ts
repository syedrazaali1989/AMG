import { NextResponse } from 'next/server';
import { OnChainSignalGenerator } from '@/lib/signals/onChainGenerator';
import { syncOnChainHistory } from '@/lib/history/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/on-chain/signals
 *
 * Server-side generation for the On-Chain page. The pipeline that used to
 * run in each visitor's browser now runs here, so every visitor sees the
 * same signals for the same on-chain state:
 *
 *   1. Real large BTC transfers (>= $500K) from the most recent
 *      confirmed Bitcoin blocks, via Blockchain.info.
 *   2. Exchange inflow/outflow score from those transfers (a transfer is
 *      labelled inflow/outflow only when a known exchange wallet address
 *      is involved; everything else is reported as "unknown").
 *   3. Technical score (RSI/MACD) from live Binance 1h prices.
 *   4. A BTC signal is issued only when |combined score| >= 10; altcoin
 *      signals are then derived from it by historical BTC correlation
 *      and labelled as correlated.
 *
 * The response also carries the transaction feed and the scoring
 * diagnostics so a "no signal" outcome is auditable. If a live source is
 * unavailable this returns 502 - transactions and signals are NEVER
 * generated from simulated data.
 */

const CACHE_DURATION = 60 * 1000; // 60 seconds
let cache: { payload: unknown; timestamp: number } | null = null;

export async function GET() {
    try {
        const now = Date.now();
        if (cache && now - cache.timestamp < CACHE_DURATION) {
            return NextResponse.json({ ...(cache.payload as object), cached: true });
        }

        let report;
        try {
            report = await OnChainSignalGenerator.generateOnChainReport();
        } catch (error) {
            // Live data is down: say so, never fall back to simulated data.
            console.error('On-chain data source unavailable:', error);
            return NextResponse.json(
                { error: 'Live on-chain data unavailable' },
                { status: 502 }
            );
        }

        const payload = {
            signals: report.signals,
            transactions: report.transactions,
            diagnostics: report.diagnostics,
            generatedAt: new Date(now).toISOString(),
            cached: false
        };
        cache = { payload, timestamp: now };

        // Server-side history: record this generation's signals
        // (first-seen levels are canonical) and resolve stale on-chain
        // actives against real klines. Fire-and-forget and fully
        // guarded - it can never break or delay this response.
        void syncOnChainHistory(report.signals).catch(() => undefined);

        return NextResponse.json(payload);
    } catch (error) {
        console.error('On-chain signal generation error:', error);
        return NextResponse.json(
            { error: 'Live on-chain data unavailable' },
            { status: 502 }
        );
    }
}
