import { NextRequest, NextResponse } from 'next/server';
import { getPushRedis, saveSubscription, removeSubscription } from '@/lib/push/store';

export const dynamic = 'force-dynamic';

/**
 * POST   /api/push/subscribe  { subscription }  -> store a browser subscription
 * DELETE /api/push/subscribe  { endpoint }      -> remove it
 *
 * Subscriptions live in Upstash Redis (hash push:subs, endpoint -> JSON).
 * When the storage env vars are not set on this deployment, both verbs
 * answer 503 { configured: false } - an honest "not set up" state.
 */

interface SubscribeBody {
    subscription?: {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
    };
    endpoint?: string;
}

export async function POST(request: NextRequest) {
    const redis = getPushRedis();
    if (!redis) {
        return NextResponse.json({ configured: false }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as SubscribeBody | null;
    const sub = body?.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    await saveSubscription(redis, {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }
    });

    return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
    const redis = getPushRedis();
    if (!redis) {
        return NextResponse.json({ configured: false }, { status: 503 });
    }

    const body = (await request.json().catch(() => null)) as SubscribeBody | null;
    const endpoint = body?.endpoint || body?.subscription?.endpoint;
    if (!endpoint) {
        return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 });
    }

    await removeSubscription(redis, endpoint);

    return NextResponse.json({ ok: true });
}
