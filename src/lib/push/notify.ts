import * as webpush from 'web-push';
import { generateStandardSignals } from '@/lib/signals/standardSignals';
import { generateScalpingV2Signals, SCALPING_V2_PAIRS } from '@/lib/signals/scalpingV2';
import { generateGoldSignals } from '@/lib/signals/goldSignals';
import { ScalpingSignalGenerator } from '@/lib/signals/scalpingGenerator';
import { OnChainSignalGenerator } from '@/lib/signals/onChainGenerator';
import { MarketDataManager } from '@/lib/signals/marketData';
import { TickKlineCache } from '@/lib/signals/klineCache';
import type { Signal } from '@/lib/signals/types';
import { SignalType, MarketType } from '@/lib/signals/types';
import {
    getPushRedis,
    getVapidPublicKey,
    getVapidPrivateKey,
    getVapidSubject,
    listSubscriptions,
    removeSubscription
} from './store';
import { resolveHistory, recordStandardSignals, type HistorySyncSummary } from '@/lib/history/sync';
import { countActive, getHistoryRedis } from '@/lib/history/store';
import type { ResolveSummary } from '@/lib/history/resolve';

/**
 * New-signal watcher for Web Push notifications.
 *
 * checkAndNotify() evaluates all five engines through the SAME server
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
 *   scalping:    engine + pair + side + FIRST-SEEN 5m bar. The
 *                generator re-fires a persistent setup on every new 5m
 *                bar, so the per-evaluation anchor alone would notify
 *                up to 48 times per 4h window; the watcher records the
 *                bar a setup FIRST appeared on (push:firstseen, TTL =
 *                the signal's 4h expiry) and the id uses that bar.
 *   onchain:     engine + pair + side + FIRST-SEEN 1H bar (same
 *                mechanism, TTL = the 48h expiry). The BTC leg is the
 *                standard core verbatim, so it is dropped when the
 *                Standard engine already covers the same pair + side +
 *                bar in the same pass — it never double-notifies.
 *
 * Notified ids are kept for 72h, then pruned. Ids are recorded even
 * when there are zero subscriptions, so a visitor who enables
 * notifications later is not flooded with already-old signals.
 */

const NOTIFIED_KEY = 'push:notified';
const LAST_CHECK_KEY = 'push:lastcheck';
const NOTIFIED_TTL_MS = 72 * 60 * 60 * 1000; // 72h
const OPPORTUNISTIC_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes
/** First-seen anchors: push:firstseen:<engine>:<pair>:<direction> -> bar ISO. */
const FIRSTSEEN_PREFIX = 'push:firstseen:';
/** First-seen TTLs match the signal expiry of each engine. */
const SCALPING_FIRSTSEEN_TTL_SEC = 4 * 60 * 60; // 4h
const ONCHAIN_FIRSTSEEN_TTL_SEC = 48 * 60 * 60; // 48h

/** Human-readable engine label for notification titles, e.g. "Standard Signal: BTC/USDT SHORT". */
const ENGINE_LABELS: Record<string, string> = {
    standard: 'Standard',
    'scalping-v2': 'Scalping V2',
    gold: 'Gold',
    scalping: 'Scalping',
    onchain: 'On-Chain'
};

/**
 * Notification icon/badge. Absolute production URL: a push payload
 * must carry an absolute URL (a relative path does not resolve in a
 * notification). The same logo is the PWA manifest app icon
 * (src/app/icons/, restored 2026-11-26 on the owner's order).
 * There is still no favicon.
 */
const NOTIFICATION_ICON_URL = 'https://amgtrading.vercel.app/logo.png';

export interface PushCandidate {
    id: string;
    title: string;
    body: string;
    url: string;
    /** Logo shown on the notification (and as the small badge icon). */
    icon: string;
    badge: string;
    /** Standard-engine signals carry their source signal + bar anchor for history. */
    signal?: Signal;
    anchorMs?: number;
    /**
     * Engines whose setups re-fire every bar (scalping 5m, on-chain 1H)
     * set this to the first-seen TTL in seconds. checkAndNotify()
     * rewrites such a candidate's id to its FIRST-SEEN bar before the
     * notified-set diff, so a persistent setup notifies exactly once
     * per expiry window. Engines without it keep per-bar ids (their
     * existing behaviour, unchanged).
     */
    firstSeenTtlSec?: number;
}

export interface CheckSummary {
    configured: boolean;
    checked: number;
    newCount: number;
    sent: number;
    removedSubscriptions: number;
    /** Server-side signal-history sync for this pass (standard + on-chain). */
    history?: HistorySyncSummary;
}

function formatPrice(value: number): string {
    if (!Number.isFinite(value)) return String(value);
    return String(parseFloat(value.toFixed(8)));
}

function toCandidate(engine: string, url: string, signal: Signal, issuedAnchor: string, anchorMs?: number): PushCandidate {
    const tp1 = signal.takeProfit1 ?? signal.takeProfit;
    return {
        id: `${engine}:${signal.pair}:${signal.direction}:${issuedAnchor}`,
        title: `${ENGINE_LABELS[engine] ?? engine} Signal: ${signal.pair} ${signal.direction}`,
        body: `Entry ${formatPrice(signal.entryPrice)} · SL ${formatPrice(signal.stopLoss)} · TP1 ${formatPrice(tp1)}`,
        url,
        icon: NOTIFICATION_ICON_URL,
        badge: NOTIFICATION_ICON_URL,
        signal,
        anchorMs
    };
}

/** Trailing bar timestamp embedded in the deterministic ids of the v2/gold engines. */
function anchorFromEngineId(signal: Signal): string {
    const match = /-(\d{10,})$/.exec(signal.id);
    return match ? new Date(parseInt(match[1], 10)).toISOString() : signal.id;
}

/** Scalping universe — identical to GET /api/scalping/signals: the top
 *  30 pairs of MarketDataManager.getCryptoPairs(), MATIC/USDT mapped to
 *  POL/USDT (the MATIC spot series is frozen). */
function scalpingUniverse(): Array<{ pair: string; marketType: MarketType }> {
    return MarketDataManager.getCryptoPairs()
        .slice(0, 30)
        .map(pair => ({ pair: pair === 'MATIC/USDT' ? 'POL/USDT' : pair, marketType: MarketType.CRYPTO }));
}

/**
 * Watcher-only Scalping V2 universe rotation (trim for the 5-engine
 * ship — TIMING CHANGE, read before touching).
 *
 * The 53-pair V2 scan is the tick's long pole: 106 kline fetches (5m +
 * 1m per pair), and it alone measured 16.4s on this VM's slow Binance
 * path — over Vercel's ~10s Hobby limit by itself. The watcher scans
 * ONE HALF of the universe per 5-min tick, alternating on the
 * wall-clock 5-min bucket, so each pair is scanned every 10 minutes
 * and the full universe is covered over 2 ticks.
 *
 * Effect on detection: a new V2 setup is detected 0–10 min after it
 * appears (average ~5 min) instead of 0–5 min (average ~2.5 min).
 * V2 signals live 4 hours, so a few minutes' delay is immaterial to
 * the trade, and no setup that persists across two ticks can be
 * missed at all — only a setup that appears AND vanishes inside a
 * single 10-min window is invisible to the watcher. V2 signal ids are
 * deterministic per bar, so rotation cannot double-notify.
 *
 * The /api/scalping-v2/signals route is NOT rotated: visitors always
 * see the full 53-pair scan. Only the watcher (this file) rotates.
 */
function scalpingV2WatchPairs(): string[] {
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000)) % 2;
    return SCALPING_V2_PAIRS.filter((_, i) => i % 2 === bucket);
}

/**
 * Evaluate all five engines and return the currently active signals as
 * push candidates. Exported for testing/diagnostics. An engine that
 * fails (live data down) contributes nothing - its failure never
 * invents signals and never blocks the other engines.
 *
 * Identity notes (see the module doc comment):
 * - standard / scalping-v2 / gold: per-bar ids, behaviour unchanged.
 * - scalping / onchain: candidates carry their CURRENT decision-bar
 *   anchor here; checkAndNotify() rewrites their ids to the FIRST-SEEN
 *   bar before the notified-set diff (see resolveFirstSeenAnchors).
 * - on-chain BTC dedup: the on-chain BTC leg is the standard core
 *   verbatim, so when the Standard engine already covers the same
 *   pair + side + decision bar in this pass, the on-chain BTC
 *   candidate is dropped. Correlated alt legs are distinct trades
 *   (own entries/levels) and are kept.
 */
export async function collectCurrentCandidates(): Promise<PushCandidate[]> {
    const candidates: PushCandidate[] = [];

    // ONE shared kline cache for the whole tick (see klineCache.ts):
    // the five engines fetch heavily overlapping candle series (BTC 1H
    // and 4H in Standard and On-Chain, the correlated alts' 1H series
    // in both, the 5m series in Scalping V2 and old Scalping). Without
    // it the tick fires ~200 Binance requests; with it each unique
    // (symbol, interval) series is fetched once. The cache is created
    // fresh per tick and passed explicitly — no module-level state, so
    // no cross-tick staleness. Route callers pass no cache.
    const klines = new TickKlineCache();

    const [standard, v2, gold, scalping, onchain] = await Promise.allSettled([
        generateStandardSignals(undefined, SignalType.FUTURE, klines),
        // Watcher-only V2 rotation (see scalpingV2WatchPairs below):
        // half the 53-pair universe per 5-min tick, full coverage over
        // 2 ticks. The /api/scalping-v2/signals route is NOT rotated.
        generateScalpingV2Signals(scalpingV2WatchPairs(), klines),
        generateGoldSignals(klines),
        (async () => {
            // One generator call per pair, run in parallel — same shape
            // as GET /api/scalping/signals (the generator itself scans
            // sequentially; 30 sequential Binance calls would risk the
            // serverless timeout).
            const settled = await Promise.allSettled(
                scalpingUniverse().map(({ pair, marketType }) =>
                    ScalpingSignalGenerator.generateScalpingSignals(
                        [{ pair, marketType }],
                        SignalType.FUTURE,
                        { strict: true },
                        klines
                    )
                )
            );
            const signals: Signal[] = [];
            const barAnchors = new Map<string, number>();
            for (const result of settled) {
                if (result.status === 'fulfilled') {
                    signals.push(...result.value.signals);
                    for (const [pair, anchor] of result.value.barAnchors) {
                        barAnchors.set(pair, anchor);
                    }
                }
            }
            return { signals, barAnchors };
        })(),
        OnChainSignalGenerator.generateOnChainReport(klines)
    ]);

    if (standard.status === 'fulfilled') {
        for (const signal of standard.value.signals) {
            const anchorMs = standard.value.barAnchors.get(signal.pair);
            const issued = anchorMs ? new Date(anchorMs).toISOString() : new Date(signal.timestamp).toISOString();
            candidates.push(toCandidate('standard', '/dashboard', signal, issued, anchorMs));
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
    if (scalping.status === 'fulfilled') {
        for (const signal of scalping.value.signals) {
            const anchorMs = scalping.value.barAnchors.get(signal.pair);
            if (anchorMs === undefined) continue; // cannot anchor -> never notify, never spam
            const issued = new Date(anchorMs).toISOString();
            const candidate = toCandidate('scalping', '/scalping', signal, issued, anchorMs);
            candidate.firstSeenTtlSec = SCALPING_FIRSTSEEN_TTL_SEC;
            candidates.push(candidate);
        }
    }
    if (onchain.status === 'fulfilled') {
        const report = onchain.value;
        if (report.barAnchorMs !== null) {
            const issued = new Date(report.barAnchorMs).toISOString();
            // Standard coverage for the BTC dedup: pair + side + bar.
            const standardKeys = new Set(
                candidates
                    .filter(c => c.id.startsWith('standard:'))
                    .map(c => c.id.slice('standard:'.length))
            );
            for (const signal of report.signals) {
                if (
                    signal.pair === 'BTC/USDT' &&
                    standardKeys.has(`${signal.pair}:${signal.direction}:${issued}`)
                ) {
                    // Same BTC trade the Standard engine already covers
                    // this bar — suppress the duplicate notification.
                    continue;
                }
                const candidate = toCandidate('onchain', '/on-chain', signal, issued, report.barAnchorMs);
                candidate.firstSeenTtlSec = ONCHAIN_FIRSTSEEN_TTL_SEC;
                candidates.push(candidate);
            }
        }
    }

    return candidates;
}

/**
 * First-seen anchor resolution for engines whose setups re-fire every
 * bar (scalping 5m, on-chain 1H). A candidate's id is built from its
 * CURRENT decision bar by collectCurrentCandidates(); this rewrites it
 * to the bar the setup FIRST appeared on, stored in Redis under
 * push:firstseen:<engine>:<pair>:<direction> with a TTL equal to the
 * signal's expiry. Consequences:
 *  - a persistent setup keeps one id across evaluations -> notifies
 *    exactly once (the push:notified set dedups it);
 *  - a setup that vanishes and reappears within the TTL keeps its old
 *    anchor -> no re-notify (a transient data gap cannot spam);
 *  - a setup that reappears after the TTL (its old signal expired)
 *    gets a fresh anchor -> notifies again as a new issuance.
 * A Redis failure here falls back to the current-bar id (one extra
 * notification at most) — it never breaks the tick.
 */
async function resolveFirstSeenAnchors(
    redis: import('@upstash/redis').Redis,
    candidates: PushCandidate[]
): Promise<void> {
    for (const candidate of candidates) {
        if (candidate.firstSeenTtlSec === undefined) continue;
        if (!candidate.signal || candidate.anchorMs === undefined) continue;
        const engine = candidate.id.split(':')[0];
        const key = `${FIRSTSEEN_PREFIX}${engine}:${candidate.signal.pair}:${candidate.signal.direction}`;
        const currentIso = new Date(candidate.anchorMs).toISOString();
        try {
            const stored = await redis.get<string>(key);
            if (typeof stored === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(stored)) {
                candidate.id = `${engine}:${candidate.signal.pair}:${candidate.signal.direction}:${stored}`;
                candidate.anchorMs = Date.parse(stored);
            } else {
                await redis.set(key, currentIso, { ex: candidate.firstSeenTtlSec });
            }
        } catch {
            // Keep the current-bar id; the notified-set diff still applies.
        }
    }
}

export async function checkAndNotify(): Promise<CheckSummary> {
    const empty: CheckSummary = { configured: false, checked: 0, newCount: 0, sent: 0, removedSubscriptions: 0 };

    const redis = getPushRedis();
    if (!redis) {
        return empty;
    }

    // Server-side signal history. ORDER MATTERS (see resolveHistory):
    // resolve stale actives FIRST, while the Binance IP is still fresh,
    // THEN evaluate the engines (whose ~80-request burst trips the
    // 418 rate-limit), THEN record the current standard signals
    // (Redis only, no market-data fetch). History needs Redis only, NOT
    // VAPID keys: it keeps working even when push itself is not
    // configured. Fully guarded - a history failure never breaks the
    // notification check below.
    let resolveSummary: ResolveSummary | null = null;
    try {
        resolveSummary = await resolveHistory();
    } catch {
        resolveSummary = null;
    }

    const candidates = await collectCurrentCandidates();
    const now = Date.now();

    // Map scalping/on-chain candidates to their first-seen bar, so a
    // persistent setup notifies once per expiry window (see
    // resolveFirstSeenAnchors). Standard / v2 / gold ids are untouched.
    await resolveFirstSeenAnchors(redis, candidates);

    let recorded = 0;
    try {
        const standardSignals = candidates
            .filter(c => c.id.startsWith('standard:') && c.signal && c.anchorMs !== undefined)
            .map(c => c.signal as Signal);
        const barAnchors = new Map<string, number>();
        for (const c of candidates) {
            if (c.id.startsWith('standard:') && c.signal && c.anchorMs !== undefined) {
                barAnchors.set(c.signal.pair, c.anchorMs);
            }
        }
        recorded = await recordStandardSignals(standardSignals, barAnchors);
    } catch {
        recorded = 0;
    }

    let history: HistorySyncSummary | undefined;
    if (resolveSummary) {
        const hRedis = getHistoryRedis();
        const active = hRedis ? await countActive(hRedis).catch(() => 0) : 0;
        history = {
            configured: true,
            recorded,
            resolved: resolveSummary.resolved,
            wins: resolveSummary.wins,
            losses: resolveSummary.losses,
            expired: resolveSummary.expired,
            active
        };
    }

    const publicKey = getVapidPublicKey();
    const privateKey = getVapidPrivateKey();
    if (!publicKey || !privateKey) {
        return { ...empty, checked: candidates.length, history };
    }

    webpush.setVapidDetails(getVapidSubject(), publicKey, privateKey);

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
                url: candidate.url,
                icon: candidate.icon,
                badge: candidate.badge
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
        removedSubscriptions,
        history
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
