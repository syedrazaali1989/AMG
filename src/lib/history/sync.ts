import type { Signal } from '@/lib/signals/types';
import { getHistoryRedis, countActive, historyId, recordActive, type HistoryEngine, type HistoryRecord } from './store';
import { resolveActiveSignals, hourFloorMs, fiveMinFloorMs, type KlineFetcher, type ResolveSummary } from './resolve';

/**
 * History sync drivers: record currently-active signals, then resolve
 * stale ones against real klines.
 *
 * Standard engine: driven by the push watcher (checkAndNotify) and the
 * opportunistic trigger, so it runs every few minutes alongside the
 * notification check - no new cron, no new service.
 *
 * On-chain engine: recording happens in the /api/on-chain/signals route
 * (fire-and-forget on each fresh generation); resolution of already
 * recorded actives also runs from the watcher so a setup resolves even
 * when nobody visits the on-chain page.
 *
 * Scalping engine: same pattern via /api/scalping/signals, resolved on
 * 5m klines (see resolve.ts).
 *
 * Every step is guarded: no storage, no live data, or any failure just
 * returns a summary with configured:false / zero counts. History must
 * never break signals, notifications, or the route that called it.
 */

export interface HistorySyncSummary {
    configured: boolean;
    recorded: number;
    resolved: number;
    wins: number;
    losses: number;
    expired: number;
    active: number;
}

const EMPTY: HistorySyncSummary = {
    configured: false,
    recorded: 0,
    resolved: 0,
    wins: 0,
    losses: 0,
    expired: 0,
    active: 0
};

function toRecord(engine: HistoryEngine, signal: Signal, anchorMs: number): HistoryRecord {
    const issuedAt = new Date(anchorMs).toISOString();
    return {
        id: historyId(engine, signal.pair, signal.direction, issuedAt),
        sourceId: signal.id,
        engine,
        pair: signal.pair,
        direction: signal.direction,
        issuedAt,
        signal: {
            ...signal,
            // The completed pages filter scalping records on this flag
            // (the same marker the old client-side SignalManager set).
            ...(engine === 'scalping' ? { isScalping: true } : {}),
            timestamp: new Date(signal.timestamp),
            expiresAt: signal.expiresAt ? new Date(signal.expiresAt) : undefined
        }
    };
}

async function finish(
    redis: NonNullable<ReturnType<typeof getHistoryRedis>>,
    recorded: number,
    resolveSummary: ResolveSummary
): Promise<HistorySyncSummary> {
    const active = await countActive(redis).catch(() => 0);
    return {
        configured: true,
        recorded,
        resolved: resolveSummary.resolved,
        wins: resolveSummary.wins,
        losses: resolveSummary.losses,
        expired: resolveSummary.expired,
        active
    };
}

/**
 * Resolve stale actives for BOTH engines against real klines. Returns
 * null when no history store is configured. The watcher calls this
 * BEFORE evaluating the engines: the three engines fetch ~80 Binance
 * endpoints in parallel, and that burst trips Binance's 418 IP
 * rate-limit - any kline fetch after it fails, so resolution must run
 * while the IP is still fresh. (Discovered by the mocked e2e test:
 * six watch ticks in a row resolved 0 while the burst ran first.)
 */
export async function resolveHistory(fetcher?: KlineFetcher): Promise<ResolveSummary | null> {
    const redis = getHistoryRedis();
    if (!redis) return null;
    try {
        return await resolveActiveSignals(redis, fetcher);
    } catch {
        return { checked: 0, resolved: 0, wins: 0, losses: 0, expired: 0, stillActive: 0, errors: [] };
    }
}

/**
 * Record the standard engine's current signals (first-seen levels are
 * canonical). Redis only - no market-data fetch, so it can run after
 * the engine burst. Returns the number of newly recorded setups.
 */
export async function recordStandardSignals(signals: Signal[], barAnchors: Map<string, number>): Promise<number> {
    const redis = getHistoryRedis();
    if (!redis) return 0;
    let recorded = 0;
    try {
        for (const signal of signals) {
            const anchorMs = barAnchors.get(signal.pair) ?? hourFloorMs(new Date(signal.timestamp).getTime());
            const rec = toRecord('standard', signal, anchorMs);
            if (await recordActive(redis, rec)) recorded++;
        }
    } catch {
        // Recording failure never breaks the caller.
    }
    return recorded;
}

/**
 * Record the scalping engine's current signals and resolve stale
 * scalping actives (on 5m klines). The generator stamps a fresh id on
 * every pass, so the anchor is the 5-minute bar the signal was first
 * seen in. Called fire-and-forget by /api/scalping/signals; the
 * watcher's resolveHistory() also resolves scalping records (it walks
 * every engine) so a setup resolves even when nobody visits the page.
 */
export async function syncScalpingHistory(
    current?: Signal[],
    fetcher?: KlineFetcher
): Promise<HistorySyncSummary> {
    const redis = getHistoryRedis();
    if (!redis) return EMPTY;

    let recorded = 0;
    try {
        if (current) {
            for (const signal of current) {
                const anchorMs = fiveMinFloorMs(new Date(signal.timestamp).getTime());
                const rec = toRecord('scalping', signal, anchorMs);
                if (await recordActive(redis, rec)) recorded++;
            }
        }
    } catch {
        // Recording failure: still resolve what is already recorded.
    }

    let resolveSummary: ResolveSummary;
    try {
        resolveSummary = await resolveActiveSignals(redis, fetcher, 'scalping');
    } catch {
        resolveSummary = { checked: 0, resolved: 0, wins: 0, losses: 0, expired: 0, stillActive: 0, errors: [] };
    }

    try {
        return await finish(redis, recorded, resolveSummary);
    } catch {
        return { ...EMPTY, configured: true, recorded, resolved: resolveSummary.resolved, wins: resolveSummary.wins, losses: resolveSummary.losses, expired: resolveSummary.expired };
    }
}

/**
 * Record the on-chain engine's current signals and resolve stale
 * on-chain actives. The on-chain generator stamps a fresh id on every
 * pass, so the anchor is the hour the signal was first seen. When
 * `current` is omitted (watcher path) only resolution runs.
 */
export async function syncOnChainHistory(
    current?: Signal[],
    fetcher?: KlineFetcher
): Promise<HistorySyncSummary> {
    const redis = getHistoryRedis();
    if (!redis) return EMPTY;

    let recorded = 0;
    try {
        if (current) {
            for (const signal of current) {
                const anchorMs = hourFloorMs(new Date(signal.timestamp).getTime());
                const rec = toRecord('onchain', signal, anchorMs);
                if (await recordActive(redis, rec)) recorded++;
            }
        }
    } catch {
        // Recording failure: still resolve what is already recorded.
    }

    let resolveSummary: ResolveSummary;
    try {
        resolveSummary = await resolveActiveSignals(redis, fetcher, 'onchain');
    } catch {
        resolveSummary = { checked: 0, resolved: 0, wins: 0, losses: 0, expired: 0, stillActive: 0, errors: [] };
    }

    try {
        return await finish(redis, recorded, resolveSummary);
    } catch {
        return { ...EMPTY, configured: true, recorded, resolved: resolveSummary.resolved, wins: resolveSummary.wins, losses: resolveSummary.losses, expired: resolveSummary.expired };
    }
}
