import { NextRequest, NextResponse } from 'next/server';
import { checkAndNotify } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';

/**
 * GET /api/push/watch
 *
 * Protected trigger for the new-signal watcher (see lib/push/notify).
 * Intended callers:
 *   - Vercel Cron (vercel.json) - sends "Authorization: Bearer <CRON_SECRET>"
 *     automatically when the CRON_SECRET env var exists.
 *   - Any external pinger - sends header "x-watch-secret: <WATCH_SECRET>".
 *
 * If neither secret is configured, the endpoint answers 503 (not
 * configured). A wrong secret answers 401. When push itself is not
 * configured (no storage / VAPID env), checkAndNotify reports
 * configured:false and this route answers 503 with that summary.
 */
export async function GET(request: NextRequest) {
    const watchSecret = process.env.WATCH_SECRET;
    const cronSecret = process.env.CRON_SECRET;

    if (!watchSecret && !cronSecret) {
        return NextResponse.json(
            { configured: false, error: 'Watch endpoint not configured (set WATCH_SECRET)' },
            { status: 503 }
        );
    }

    const headerSecret = request.headers.get('x-watch-secret');
    const authorization = request.headers.get('authorization');
    const authorized =
        (watchSecret !== undefined && headerSecret === watchSecret) ||
        (watchSecret !== undefined && authorization === `Bearer ${watchSecret}`) ||
        (cronSecret !== undefined && authorization === `Bearer ${cronSecret}`);

    if (!authorized) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const summary = await checkAndNotify();
    return NextResponse.json(summary, { status: summary.configured ? 200 : 503 });
}
