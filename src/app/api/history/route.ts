import { NextResponse } from 'next/server';
import { getHistoryRedis, listResolved, countActive } from '@/lib/history/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/history
 *
 * Public read of the server-side signal history: every standard and
 * on-chain signal the engines issued, with its outcome, recorded on the
 * server (Upstash Redis) instead of the visitor's browser localStorage.
 *
 * Response: { configured, signals, activeCount, generatedAt }
 *  - signals: resolved records, newest first (max 100). Each record is
 *    the full signal snapshot with the stable history id, `engine`,
 *    `issuedAt`, `resolvedAt`/`completedAt`, and outcome status
 *    COMPLETED (full TP3) / STOPPED (SL) / EXPIRED. No secrets, no
 *    subscriber data, no push keys - public signal data only.
 *  - activeCount: signals still open.
 * When storage is not configured the route answers an honest empty
 * state (configured:false) instead of an error - the completed pages
 * then fall back to their local entries alone.
 */
export async function GET() {
    try {
        const redis = getHistoryRedis();
        if (!redis) {
            return NextResponse.json({
                configured: false,
                signals: [],
                activeCount: 0,
                generatedAt: new Date().toISOString()
            });
        }

        const [records, activeCount] = await Promise.all([
            listResolved(redis, 100),
            countActive(redis)
        ]);

        const signals = records.map(rec => ({
            ...rec.signal,
            id: rec.id,
            sourceId: rec.sourceId,
            engine: rec.engine,
            issuedAt: rec.issuedAt,
            resolvedAt: rec.resolvedAt,
            completedAt: rec.completedAt ?? rec.resolvedAt
        }));

        return NextResponse.json({
            configured: true,
            signals,
            activeCount,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('History read error:', error);
        return NextResponse.json({
            configured: false,
            signals: [],
            activeCount: 0,
            error: 'History unavailable',
            generatedAt: new Date().toISOString()
        });
    }
}
