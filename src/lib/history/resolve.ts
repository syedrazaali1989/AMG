import { BinanceAPI } from '@/lib/signals/binanceAPI';
import { SignalStatus } from '@/lib/signals/types';
import type { Redis } from '@upstash/redis';
import {
    listActive,
    moveToResolved,
    updateActive,
    type HistoryRecord
} from './store';

/**
 * Outcome resolution for server-side signal history.
 *
 * For each active record we walk the pair's real klines from
 * data-api.binance.vision (the same public market-data domain the
 * engines already use) in time order. The interval follows the engine:
 * 1H for standard/on-chain, 5m for scalping (whose ±1% TP1 and -0.7%
 * stop live and die inside a single hour - a 1H walk would see both
 * levels inside one candle and the SL-wins-tie rule would wrongly mark
 * most scalping signals LOSS). The first touch decides:
 *   SL touched first  -> LOSS   (status STOPPED)
 *   TP3 touched first -> WIN    (status COMPLETED)
 *   TP1/TP2 touches are recorded as milestones either way.
 *   Expiry passed with neither touched -> EXPIRED (milestones noted).
 *
 * Honesty rules:
 * - The issuance candle itself is SKIPPED: a signal is issued mid-hour,
 *   so that candle's high/low includes price action from BEFORE the
 *   signal existed, which could fake a touch. Only candles opening
 *   after the issuance hour are walked. A touch that happens and
 *   reverses inside the issuance hour is missed (conservative: the
 *   signal stays active and resolves later, or expires - never a
 *   fabricated win or loss).
 * - If both SL and TP3 are inside ONE candle's range, the order is
 *   unknowable from OHLC data, so SL wins (never claim a win that
 *   cannot be proven).
 * - If klines cannot be fetched for a pair, its signals stay active -
 *   a missing data source never invents a result.
 */

export interface Kline {
    openTime: number;
    high: number;
    low: number;
    close: number;
}

export type KlineFetcher = (symbol: string, interval: '1h' | '5m') => Promise<Kline[]>;

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const KLINE_LIMIT = 1000; // ~41 days of 1H candles, ~3.5 days of 5m; expiries are <= 48h

export function hourFloorMs(ms: number): number {
    return Math.floor(ms / ONE_HOUR_MS) * ONE_HOUR_MS;
}

export function fiveMinFloorMs(ms: number): number {
    return Math.floor(ms / FIVE_MIN_MS) * FIVE_MIN_MS;
}

/** Default fetcher: real klines from Binance's public market-data domain. */
export async function defaultKlineFetcher(symbol: string, interval: '1h' | '5m' = '1h'): Promise<Kline[]> {
    const fetchOnce = async (): Promise<Kline[]> => {
        const klines = await BinanceAPI.getKlines(symbol, interval, KLINE_LIMIT);
        return klines
            .map(k => ({
                openTime: Number(k[0]),
                high: parseFloat(String(k[2])),
                low: parseFloat(String(k[3])),
                close: parseFloat(String(k[4]))
            }))
            .filter(k => Number.isFinite(k.openTime) && Number.isFinite(k.high) && Number.isFinite(k.low) && Number.isFinite(k.close))
            .sort((a, b) => a.openTime - b.openTime);
    };
    try {
        return await fetchOnce();
    } catch (error) {
        // One bounded retry for transient rate-limit / server errors
        // (Binance 418/429/5xx). A 451 (geo-block) or a bad symbol is
        // permanent and is not retried.
        const msg = error instanceof Error ? error.message : String(error);
        if (!/418|429|500|502|503/.test(msg)) throw error;
        await new Promise(r => setTimeout(r, 10000));
        return fetchOnce();
    }
}

export type ResolutionOutcome = 'ACTIVE' | 'WIN' | 'LOSS' | 'EXPIRED';

export interface Resolution {
    outcome: ResolutionOutcome;
    tp1Hit: boolean;
    tp2Hit: boolean;
    tp3Hit: boolean;
    /** Exit price (SL, TP3, or last close at/before expiry). */
    exitPrice?: number;
    /** Resolution time in ms (candle close, or expiry). */
    resolvedAtMs?: number;
}

function pairToSymbol(pair: string): string {
    return pair.replace('/', '');
}

function profitLossPercent(rec: HistoryRecord, exitPrice: number): number {
    const entry = rec.signal.entryPrice;
    if (!entry) return 0;
    const isLong = rec.signal.direction === 'LONG' || rec.signal.direction === 'BUY';
    return isLong ? ((exitPrice - entry) / entry) * 100 : ((entry - exitPrice) / entry) * 100;
}

/**
 * Pure outcome computation for one record against an ordered kline list.
 * No I/O - unit-testable with scripted candles.
 * `candleMs` is the kline interval in ms (1H for standard/on-chain,
 * 5m for scalping): it floors the issuance bar and stamps resolution time.
 */
export function resolveOutcome(rec: HistoryRecord, klines: Kline[], nowMs: number, candleMs: number = ONE_HOUR_MS): Resolution {
    const sig = rec.signal;
    const isLong = sig.direction === 'LONG' || sig.direction === 'BUY';
    const sl = sig.stopLoss;
    const tp1 = sig.takeProfit1 ?? sig.takeProfit;
    const tp2 = sig.takeProfit2 ?? sig.takeProfit;
    const tp3 = sig.takeProfit3 ?? sig.takeProfit;
    const issuedMs = new Date(rec.issuedAt).getTime();
    const expiresMs = sig.expiresAt ? new Date(sig.expiresAt).getTime() : issuedMs + 48 * ONE_HOUR_MS;

    let tp1Hit = Boolean(sig.tp1Hit);
    let tp2Hit = Boolean(sig.tp2Hit);
    let tp3Hit = Boolean(sig.tp3Hit);

    // Walk only candles that opened AFTER the issuance bar (see header).
    const startAfter = Math.floor(issuedMs / candleMs) * candleMs;
    let lastClose: number | undefined;
    let lastCloseAtOrBeforeExpiry: number | undefined;

    for (const k of klines) {
        if (k.openTime <= startAfter) continue;
        if (k.openTime > nowMs) break;
        // A candle that opens after expiry is beyond the signal's life:
        // touches in it must not resolve the signal.
        if (k.openTime > expiresMs) break;
        lastClose = k.close;
        lastCloseAtOrBeforeExpiry = k.close;

        const slTouched = isLong ? k.low <= sl : k.high >= sl;
        const t1 = isLong ? k.high >= tp1 : k.low <= tp1;
        const t2 = isLong ? k.high >= tp2 : k.low <= tp2;
        const t3 = isLong ? k.high >= tp3 : k.low <= tp3;

        if (t1) tp1Hit = true;
        if (t2) tp2Hit = true;
        if (t3) tp3Hit = true;

        // SL wins a same-candle tie: never claim an unprovable win.
        if (slTouched) {
            return { outcome: 'LOSS', tp1Hit, tp2Hit, tp3Hit, exitPrice: sl, resolvedAtMs: k.openTime + candleMs };
        }
        if (t3) {
            return { outcome: 'WIN', tp1Hit, tp2Hit, tp3Hit, exitPrice: tp3, resolvedAtMs: k.openTime + candleMs };
        }
    }

    if (nowMs > expiresMs) {
        const exitPrice = lastCloseAtOrBeforeExpiry ?? lastClose;
        return {
            outcome: 'EXPIRED',
            tp1Hit,
            tp2Hit,
            tp3Hit,
            exitPrice,
            resolvedAtMs: expiresMs
        };
    }

    return { outcome: 'ACTIVE', tp1Hit, tp2Hit, tp3Hit };
}

export interface ResolveSummary {
    checked: number;
    resolved: number;
    wins: number;
    losses: number;
    expired: number;
    stillActive: number;
    /** Pairs whose klines could not be fetched (left active, never faked). */
    errors: string[];
}

/**
 * Resolve every active record (optionally filtered to one engine).
 * Fetches klines once per pair. Never throws: a failure for one pair
 * leaves its signals active and is reported in `errors`.
 */
export async function resolveActiveSignals(
    redis: Redis,
    fetcher: KlineFetcher = defaultKlineFetcher,
    engine?: HistoryRecord['engine']
): Promise<ResolveSummary> {
    const summary: ResolveSummary = {
        checked: 0,
        resolved: 0,
        wins: 0,
        losses: 0,
        expired: 0,
        stillActive: 0,
        errors: []
    };

    const actives = (await listActive(redis)).filter(r => !engine || r.engine === engine);
    summary.checked = actives.length;
    if (actives.length === 0) return summary;

    // Group by (symbol, interval): scalping resolves on 5m klines, the
    // other engines on 1H. One fetch per group.
    const bySymbolInterval = new Map<string, { symbol: string; interval: '1h' | '5m'; records: HistoryRecord[] }>();
    for (const rec of actives) {
        const interval: '1h' | '5m' = rec.engine === 'scalping' ? '5m' : '1h';
        const symbol = pairToSymbol(rec.pair);
        const key = `${symbol}|${interval}`;
        const group = bySymbolInterval.get(key) ?? { symbol, interval, records: [] };
        group.records.push(rec);
        bySymbolInterval.set(key, group);
    }

    const nowMs = Date.now();

    for (const { symbol, interval, records } of bySymbolInterval.values()) {
        let klines: Kline[];
        try {
            klines = await fetcher(symbol, interval);
        } catch {
            summary.errors.push(symbol);
            summary.stillActive += records.length;
            continue;
        }

        const candleMs = interval === '5m' ? FIVE_MIN_MS : ONE_HOUR_MS;
        for (const rec of records) {
            const res = resolveOutcome(rec, klines, nowMs, candleMs);
            if (res.outcome === 'ACTIVE') {
                // Milestones may have been hit while still active: persist
                // them on the active record so a later resolution keeps
                // them. Best-effort - a failure here never blocks anything.
                if (res.tp1Hit !== Boolean(rec.signal.tp1Hit) || res.tp2Hit !== Boolean(rec.signal.tp2Hit) || res.tp3Hit !== Boolean(rec.signal.tp3Hit)) {
                    rec.signal.tp1Hit = res.tp1Hit;
                    rec.signal.tp2Hit = res.tp2Hit;
                    rec.signal.tp3Hit = res.tp3Hit;
                    await updateActive(redis, rec).catch(() => undefined);
                }
                summary.stillActive++;
                continue;
            }

            const resolved: HistoryRecord = {
                ...rec,
                resolvedAt: new Date(res.resolvedAtMs ?? nowMs).toISOString(),
                completedAt: new Date(res.resolvedAtMs ?? nowMs).toISOString(),
                signal: {
                    ...rec.signal,
                    status: res.outcome === 'WIN' ? SignalStatus.COMPLETED : res.outcome === 'LOSS' ? SignalStatus.STOPPED : SignalStatus.EXPIRED,
                    tp1Hit: res.tp1Hit,
                    tp2Hit: res.tp2Hit,
                    tp3Hit: res.tp3Hit,
                    exitPrice: res.exitPrice,
                    profitLossPercentage: res.exitPrice !== undefined ? profitLossPercent(rec, res.exitPrice) : 0
                }
            };

            await moveToResolved(redis, resolved);
            summary.resolved++;
            if (res.outcome === 'WIN') summary.wins++;
            else if (res.outcome === 'LOSS') summary.losses++;
            else summary.expired++;
        }
    }

    return summary;
}
