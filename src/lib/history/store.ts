import type { Redis } from '@upstash/redis';
import { getPushRedis } from '@/lib/push/store';
import type { Signal } from '@/lib/signals/types';

/**
 * Server-side signal history.
 *
 * Problem it fixes: the /completed pages used to read ONLY the visitor's
 * own browser localStorage ('completedSignals'). A signal was recorded as
 * completed only if that browser happened to see it resolve. When an
 * engine stopped re-issuing a signal (recent real cases: OP/USDT and
 * ARB/USDT shorts vanishing from /api/signals without touching SL or
 * TP1), the signal simply disappeared and never reached any completed
 * page. This store records every signal and its outcome on the server,
 * in the Upstash Redis store that already exists for push notifications.
 *
 * Storage layout (same Redis, no new service, no new env names):
 *   signal:history:active            hash  id -> HistoryRecord JSON
 *   signal:history:resolved          hash  id -> HistoryRecord JSON
 *   signal:history:resolved:by-time  zset  score = resolvedAt ms, member = id
 * Resolved history is capped at 200 entries (oldest pruned first).
 *
 * Identity: <ENGINE>:<PAIR>:<DIRECTION>:<first-seen bar ISO>.
 * The engine token is 'standard' for the standard engine and 'ONCHAIN'
 * for the on-chain engine - the completed pages filter on-chain records
 * by an id starting with 'ONCHAIN' (or 'CORR' for the old local ids),
 * so the token doubles as the page filter. First-seen entry/SL/TP
 * levels are canonical: while an active record exists for the same
 * engine+pair+direction, later re-issues of the same setup are NOT
 * recorded again - they are the same trade, not a new one. A genuinely
 * new setup (after the previous one resolved) gets a fresh record.
 *
 * NO secret is ever stored here - records hold only public signal data.
 */

export type HistoryEngine = 'standard' | 'onchain' | 'scalping';

/** Engine token used inside stable history ids (see above). */
export function historyEngineToken(engine: HistoryEngine): string {
    if (engine === 'onchain') return 'ONCHAIN';
    if (engine === 'scalping') return 'scalping';
    return 'standard';
}

export interface HistoryRecord {
    /** Stable id: <ENGINE>:<PAIR>:<DIRECTION>:<first-seen bar ISO>. */
    id: string;
    /** Generator id of the pass that first recorded it (merge dedupe). */
    sourceId: string;
    engine: HistoryEngine;
    /** Denormalised from the signal snapshot, for filtering without parsing it. */
    pair: string;
    direction: string;
    /** ISO timestamp of the first-seen bar (standard) or issuance (on-chain). */
    issuedAt: string;
    /** ISO timestamp of resolution; also mirrored as completedAt. */
    resolvedAt?: string;
    /** Alias of resolvedAt - the completed pages sort/group on this. */
    completedAt?: string;
    /** Full signal snapshot; status / tp flags / exitPrice / P&L are updated on resolution. */
    signal: Signal;
}

export const ACTIVE_KEY = 'signal:history:active';
export const RESOLVED_KEY = 'signal:history:resolved';
export const RESOLVED_INDEX_KEY = 'signal:history:resolved:by-time';
export const MAX_RESOLVED = 200;

/** The history store is the push store - same Redis, same env vars. */
export function getHistoryRedis(): Redis | null {
    return getPushRedis();
}

export function historyId(
    engine: HistoryEngine,
    pair: string,
    direction: string,
    anchorIso: string
): string {
    return `${historyEngineToken(engine)}:${pair}:${direction}:${anchorIso}`;
}

function parseRecord(raw: unknown): HistoryRecord | null {
    try {
        const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as HistoryRecord;
        if (!parsed || typeof parsed.id !== 'string' || !parsed.signal) return null;
        return parsed;
    } catch {
        return null;
    }
}

export async function listActive(redis: Redis): Promise<HistoryRecord[]> {
    const all = await redis.hgetall(ACTIVE_KEY);
    if (!all) return [];
    const records: HistoryRecord[] = [];
    for (const raw of Object.values(all as Record<string, unknown>)) {
        const rec = parseRecord(raw);
        if (rec) records.push(rec);
    }
    return records;
}

export async function findActive(
    redis: Redis,
    engine: HistoryEngine,
    pair: string,
    direction: string
): Promise<HistoryRecord | null> {
    const actives = await listActive(redis);
    return actives.find(r => r.engine === engine && r.pair === pair && r.direction === direction) ?? null;
}

/**
 * Record a first-seen signal as active. Returns false (and does not
 * overwrite) when an active record for the same engine+pair+direction
 * already exists - the re-issue is the same setup, not a new trade.
 */
export async function recordActive(redis: Redis, rec: HistoryRecord): Promise<boolean> {
    const existing = await findActive(redis, rec.engine, rec.pair, rec.direction);
    if (existing) return false;
    await redis.hset(ACTIVE_KEY, { [rec.id]: JSON.stringify(rec) });
    return true;
}

/** Overwrite an active record (e.g. to persist TP milestones hit while still active). */
export async function updateActive(redis: Redis, rec: HistoryRecord): Promise<void> {
    await redis.hset(ACTIVE_KEY, { [rec.id]: JSON.stringify(rec) });
}

export async function countActive(redis: Redis): Promise<number> {
    return (await redis.hlen(ACTIVE_KEY)) ?? 0;
}

/**
 * Move an active record to the resolved set (newest-first index) and
 * prune the resolved history to MAX_RESOLVED entries, oldest first.
 */
export async function moveToResolved(redis: Redis, rec: HistoryRecord): Promise<void> {
    const resolvedAtMs = rec.resolvedAt ? new Date(rec.resolvedAt).getTime() : Date.now();
    await redis.hdel(ACTIVE_KEY, rec.id);
    await redis.hset(RESOLVED_KEY, { [rec.id]: JSON.stringify(rec) });
    await redis.zadd(RESOLVED_INDEX_KEY, { score: resolvedAtMs, member: rec.id });
    await pruneResolved(redis);
}

export async function pruneResolved(redis: Redis): Promise<void> {
    const total = (await redis.zcard(RESOLVED_INDEX_KEY)) ?? 0;
    if (total <= MAX_RESOLVED) return;
    const excess = total - MAX_RESOLVED;
    const oldest = await redis.zrange(RESOLVED_INDEX_KEY, 0, excess - 1);
    if (!oldest || (oldest as unknown[]).length === 0) return;
    const ids = (oldest as unknown[]).map(String);
    // Remove exactly the pruned members - nothing else.
    await redis.hdel(RESOLVED_KEY, ...ids);
    for (const id of ids) {
        await redis.zrem(RESOLVED_INDEX_KEY, id);
    }
}

/** Resolved records, newest first, up to `limit`. */
export async function listResolved(redis: Redis, limit = 100): Promise<HistoryRecord[]> {
    const ids = await redis.zrange(RESOLVED_INDEX_KEY, 0, limit - 1, { rev: true });
    if (!ids || (ids as unknown[]).length === 0) return [];
    const all = await redis.hgetall(RESOLVED_KEY);
    if (!all) return [];
    const byId = all as Record<string, unknown>;
    const records: HistoryRecord[] = [];
    for (const id of (ids as unknown[]).map(String)) {
        const rec = parseRecord(byId[id]);
        if (rec) records.push(rec);
    }
    return records;
}
