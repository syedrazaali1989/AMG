/**
 * Per-tick shared kline cache for the push watcher.
 *
 * One watch tick fires ~200 Binance kline requests across five engines,
 * and many of them are the SAME series fetched twice:
 *   - BTC 1H/100: the Standard engine AND the on-chain BTC leg.
 *   - BTC 4H/250: Standard's BTC regime fetch, Standard's per-pair 4H
 *     closes for BTC/USDT, AND the on-chain regime fetch.
 *   - 1H/100 for the correlated alts: the on-chain alt legs re-fetch the
 *     series the Standard engine already fetched for the same pairs.
 *   - 5m: the Scalping V2 scan fetches 5m/100 for 53 pairs; the old
 *     scalping engine fetches 5m/48 for 30 of (mostly) the same pairs.
 *
 * This cache dedupes them: one fetch per (symbol, interval) per tick.
 * A cached LONGER series serves a shorter request by tail-slice — the
 * last N candles of a limit-100 fetch are exactly the candles a
 * limit-N fetch would have returned at the same instant. A request for
 * MORE candles than the cached series holds re-fetches at the bigger
 * limit and replaces the entry.
 *
 * Scope is deliberately narrow, and that is the whole point:
 *  - ONE instance is created per watch tick (per collectCurrentCandidates
 *    call) and passed explicitly down the engine call chain. There is NO
 *    module-level state, so a warm serverless container can never serve
 *    a previous tick's candles, and the deterministic module test (which
 *    runs many ticks in one process against stubbed fetch) cannot leak
 *    data between phases.
 *  - Route callers (/api/signals, /api/scalping-v2/signals, ...) do NOT
 *    pass a cache, so their behaviour is byte-for-byte what it was:
 *    every getKlines fetches fresh.
 *  - Signal logic never sees the cache: every caller receives the same
 *    candles it would have fetched itself, at the same limit it asked
 *    for. The only observable difference is fewer HTTP requests.
 */
export class TickKlineCache {
    private entries = new Map<string, { limit: number; promise: Promise<number[][]> }>();
    private fetches = 0;
    private hits = 0;

    /**
     * Return klines for (symbol, interval, limit), fetching once per
     * (symbol, interval) per tick. `fetchFn` performs the real fetch
     * (BinanceAPI.getKlines body) and is only invoked on a miss.
     */
    async getKlines(
        symbol: string,
        interval: string,
        limit: number,
        fetchFn: () => Promise<number[][]>
    ): Promise<number[][]> {
        const key = `${symbol}:${interval}`;
        const hit = this.entries.get(key);
        if (hit) {
            const klines = await hit.promise;
            if (hit.limit >= limit) {
                this.hits++;
                // Same candles a limit-N fetch would return (oldest
                // first, so the tail is the most recent N). When the
                // cached series is shorter than requested (a young
                // pair with little history), return all of it.
                return klines.length > limit ? klines.slice(klines.length - limit) : klines;
            }
            // Cached series is shorter than requested: re-fetch at the
            // bigger limit and replace the entry.
        }
        this.fetches++;
        const promise = fetchFn();
        // A failed fetch must not poison the entry: drop it so a later
        // caller in the same tick retries instead of sharing the error.
        promise.catch(() => {
            if (this.entries.get(key)?.promise === promise) this.entries.delete(key);
        });
        this.entries.set(key, { limit, promise });
        return promise;
    }

    /** Requests actually sent to Binance vs requests served from cache. */
    get stats(): { fetches: number; hits: number } {
        return { fetches: this.fetches, hits: this.hits };
    }
}
