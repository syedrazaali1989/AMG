import * as webpush from 'web-push';
import { generateStandardSignals } from '@/lib/signals/standardSignals';
import { generateScalpingV2Signals, SCALPING_V2_PAIRS } from '@/lib/signals/scalpingV2';
import { generateGoldSignals } from '@/lib/signals/goldSignals';
import type { Signal } from '@/lib/signals/types';
import {
    getPushRedis,
    getVapidPublicKey,
    getVapidPrivateKey,
    getVapidSubject,
    listSubscriptions,
    removeSubscription
} from './store';

/**
 * New-signal watcher for Web Push notifications.
 *
 * checkAndNotify() evaluates all three engines through the SAME server
 * code paths the API routes use (imports, never HTTP self-calls), diffs
 * the result against the push:notified set in Redis, and sends a push
 * for every genuinely new signal to every stored subscription.
 *
 * Signal identity is stable across evaluation passes:
 *   standard:    engine + pair + side + last closed 1H bar open time
 *                (the generator stamps wall-clock ids, so the bar the
 *                decision ran on is the honest "issued at" anchor)
 *   scalping-v2: engine + pair + side + entry-bar time embedded in the
 *                engine's own deterministic signal id
 *   gold:        engine + pair + side + signal-bar time embedded in
 *                the engine's own deterministic signal id
 *
 * Notified ids are kept for 72h, then pruned. Ids are recorded even
 * when there are zero subscriptions, so a visitor who enables
 * notifications later is not flooded with already-old signals.
 */

const NOTIFIED_KEY = 'push:notified';
const LAST_CHECK_KEY = 'push:lastcheck';
const NOTIFIED_TTL_MS = 72 * 60 * 60 * 1000; // 72h
const OPPORTUNISTIC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

export interface PushCandidate {
    id: string;
    title: string;
    body: string;
    url: string;
}

export interface CheckSummary {
    configured: boolean;
    checked: number;
    newCount: number;
    sent: number;
    removedSubscriptions: number;
}

function formatPrice(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    return String(parseFloat(value.toFixed(8)));
}

function toCandidate(engine: string, url: string, signal: Signal, issuedAnchor: string): PushCandidate {
    const tp1 = signal.takeProfit1 ?? signal.takeProfit;
    return {
        id: `${engine}:${signal.pair}:${signal.direction}:${issuedAnchor}`,
        title: `New Signal: ${signal.pair} ${signal.direction}`,
        body: `Entry ${formatPrice(signal.entryPrice)} · SL ${formatPrice(signal.stopLoss)} · TP1 ${formatPrice(tp1)}`,
        url
    };
}

/** Trailing bar timestamp embedded in the deterministic ids of the v2/gold engines. */
function anchorFromEngineId(signal: Signal): string {
    const match = /-(\d{10,})$/.exec(signal.id);
    return match ? new Date(parseInt(match[1], 10)).toISOString() : signal.id;
}

/**
 * Evaluate all three engines and return the currently active signals as
 * push candidates. Exported for testing/diagnostics. An engine that
 * fails (live data down) contributes nothing - its failure never
 * invents signals and never blocks the other engines.
 */
export async function collectCurrentCandidates(): Promise<PushCandidate[]> {
    const candidates: PushCandidate[] = [];

    const [standard, v2, gold] = await Promise.allSettled([
        generateStandardSignals(),
        generateScalpingV2Signals(SCALPING_V2_PAIRS),
        generateGoldSignals()
    ]);

    if (standard.status === 'fulfilled') {
        for (const signal of standard.value.signals) {
            const anchorMs = standard.value.barAnchors.get(signal.pair);
            const issued = anchorMs ? new Date(anchorMs).toISOString() : new Date(signal.timestamp).toISOString();
            candidates.push(toCandidate('standard', '/dashboard', signal, issued));
        }
    }
    if (v2.status === 'fulfilled') {
        for (const signal of v2.value.signals) {
            candidates.push(toCandidate('scalping-v2', '/scalping-v2', signal, anchorFromEngineId(signal)));
        }
    }
    if (gold.status === 'fulfilled') {
        for (const signal of gold.value.signals) {
            candidates.push(toCandidate('gold', '/gold', signal, anchorFromEngineId(signal)));
        }
    }

    return candidates;
}

export async function checkAndNotify(): Promise<CheckSummary> {
    const empty: CheckSummary = { configured: false, checked: 0, newCount: 0, sent: 0, removedSubscriptions: 0 };

    const redis = getPushRedis();
    const publicKey = getVapidPublicKey();
    const privateKey = getVapidPrivateKey();
    if (!redis || !publicKey || !privateKey) {
        return empty;
    }

    webpush.setVapidDetails(getVapidSubject(), publicKey, privateKey);

    const candidates = await collectCurrentCandidates();
    const now = Date.now();

    // Prune notified ids older than 72h, then load what is still known.
    await redis.zremrangebyscore(NOTIFIED_KEY, 0, now - NOTIFIED_TTL_MS);
    const knownRaw = await redis.zrange(NOTIFIED_KEY, 0, -1);
    const known = new Set((knownRaw as unknown[]).map(String));

    const fresh = candidates.filter(c => !known.has(c.id));
    let sent = 0;
    let removedSubscriptions = 0;

    if (fresh.length > 0) {
        const subs = await listSubscriptions(redis);
        const deadEndpoints = new Set<string>();

        for (const candidate of fresh) {
            const payload = JSON.stringify({
                title: candidate.title,
                body: candidate.body,
                url: candidate.url
            });
            for (const sub of subs) {
                if (deadEndpoints.has(sub.endpoint)) continue;
                try {
                    await webpush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
                        payload
                    );
                    sent++;
                } catch (error) {
                    const statusCode = (error as { statusCode?: number })?.statusCode;
                    if (statusCode === 404 || statusCode === 410) {
                        // Subscription is gone for good - drop it.
                        deadEndpoints.add(sub.endpoint);
                    }
                    // Any other failure (network, push-service 5xx) is
                    // transient: keep the subscription, move on.
                }
            }
        }

        for (const endpoint of deadEndpoints) {
            await removeSubscription(redis, endpoint);
            removedSubscriptions++;
        }

        // Record every fresh id as notified - even with zero subscribers,
        // so enabling notifications later does not replay old signals.
        for (const candidate of fresh) {
            await redis.zadd(NOTIFIED_KEY, { score: now, member: candidate.id });
        }
    }

    return {
        configured: true,
        checked: candidates.length,
        newCount: fresh.length,
        sent,
        removedSubscriptions
    };
}

/**
 * Opportunistic trigger for hot API routes: runs checkAndNotify() at
 * most once per 3 minutes (Redis timestamp throttle). Fire-and-forget
 * by design - every step is guarded, and any failure is swallowed so
 * the calling route can never be broken or slowed by it.
 */
export async function maybeCheckAndNotify(): Promise<void> {
    try {
        const redis = getPushRedis();
        if (!redis || !getVapidPublicKey() || !getVapidPrivateKey()) return;

        const now = Date.now();
        const last = await redis.get<number>(LAST_CHECK_KEY);
        if (typeof last === 'number' && now - last < OPPORTUNISTIC_INTERVAL_MS) return;

        await redis.set(LAST_CHECK_KEY, now);
        await checkAndNotify();
    } catch {
        // Intentionally silent: notifications must never break signals.
    }
}
