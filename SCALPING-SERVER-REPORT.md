# Scalping server route + futures-only — PR report

## Problem 1 — old /scalping page was still client-side
The page generated signals in each visitor's browser
(`ScalpingSignalGenerator` + `AutoGenerator` + `SignalManager` in
localStorage), with a random 30-pair shuffle, so every visitor saw
different signals and there was no shared record. All other engines
(standard, scalping-v2, on-chain, gold) are server-side.

## Fix 1 — new route `GET /api/scalping/signals`
- Server-side generation with the SAME engine, parameters and levels
  (5m candles, 7-period RSI, fast MACD 5/13/4, MIN_SCORE 30,
  TP1 +1% / TP2 +2% / TP3 +3% / SL -0.7%, 15-60 min targets).
- Universe: the top 30 pairs of `MarketDataManager.getCryptoPairs()`
  (deterministic top market cap - the old page scanned a random 30).
  MATIC/USDT is mapped to POL/USDT (Binance renamed the token;
  mirrors the scalping-v2 fix).
- One generator call per pair, run in parallel: the generator scans
  sequentially and 30 sequential Binance calls would risk the
  serverless timeout. Same engine, same scoring - only the call shape
  changes.
- Strict data mode (new `strict` flag on `ScalpingSignalGenerator`
  and `ScalpingMarketData`): a failed or stale live fetch THROWS
  instead of falling back to simulated data; a pair that fails is
  skipped, and if every pair fails the route answers an honest 502.
  A freshness gate rejects frozen series (e.g. FTM spot, frozen at
  Jan 2025 - last candle must be within 30 minutes).
- Expiry: the generator sets none, so the route stamps +4h (the
  short-horizon family convention, same as scalping-v2). Without it a
  15-minute setup could sit "active" in history for 48h and block
  re-issues of the same pair+direction.
- 60s server cache (same as /api/scalping-v2/signals).
- The page (`src/app/scalping/page.tsx`) now fetches the route and
  polls every 60s. No market/type selection, no SignalManager, no
  AutoGenerator, no client-side generation.
- History: the route records via `syncScalpingHistory()` (new in
  `src/lib/history/sync.ts`) and `/scalping/completed` merges
  `/api/history` with localStorage exactly like /completed and
  /on-chain/completed. Resolution walks 5m klines (see below), and
  the watcher's resolve-first step covers scalping records too.

## Forex scalping is gone - and why
The old page offered a FOREX market. Its data was never live:
`ExnessAPI.getForexKlines` generates a `Math.random()` walk
("For now, generate realistic historical data") and the Frankfurter
live-price path is commented out as unsuitable for scalping ("daily
data ... not suitable for scalping"). The server route serves CRYPTO
only; `?market=FOREX` gets a 400, never fake signals. The page no
longer offers the FOREX choice.

## Problem 2 — SPOT must exist nowhere
- `src/app/api/signals/route.ts`: the `type` parameter is gone; the
  route is FUTURE only (`type=SPOT` is ignored, never yields SPOT).
- `src/app/dashboard/page.tsx`: the Step-2 SPOT/FUTURE selector is
  removed; choosing CRYPTO sets FUTURE directly. BUY defaults removed.
- `src/app/scalping/page.tsx`: no type selector (part of Fix 1).
- `src/components/ui/SignalList.tsx`: the "Spot" filter option removed.
- `src/components/ui/SignalDirectionFilter.tsx`: BUY removed,
  `signalType` prop removed; LONG/SHORT only.
- `src/lib/services/autoGenerator.ts`: config is FUTURE only;
  scalping generation fetches `/api/scalping/signals` instead of
  running the generator in the browser.
- Engine internals: `SignalType.SPOT` removed from the enum;
  `SPOT_PROFILE`/`FUTURES_PROFILE` (dead) removed from
  `generator.ts` with the SPOT enhancements spread and the
  spotEnhancements import; expiry is always 48h; `engineCore.ts`
  direction is always LONG/SHORT (SPOT SELL skip and SPOT
  confidence constant removed); `scalpingGenerator.ts` direction is
  always LONG/SHORT. `src/lib/signals/spotEnhancements.ts` deleted.
- `src/app/layout.tsx`: metadata description/keywords no longer
  mention spot trading.
- `SignalDirection.BUY` remains as an enum member (display guards in
  SignalCard/SignalNotifications and a few `BUY || LONG` checks), but
  no generator, route, page or filter can produce it.
- Left untouched on purpose: "Binance spot" as a DATA-source label
  (coin pages, gold page, BinanceAPI comments) - futures signals are
  priced off spot market data; that is not a spot trading signal.

## History resolution for scalping (5m, not 1H)
`src/lib/history/resolve.ts` is now interval-aware: scalping records
resolve on 5m klines, standard/on-chain still on 1H. A 1H walk would
see a scalping setup's ±1% TP1 and -0.7% stop inside one candle and
the SL-wins-tie rule would wrongly mark most scalping signals LOSS.
`KlineFetcher` takes `(symbol, interval)`; `resolveOutcome` takes the
candle width for the issuance-bar floor and resolution timestamp.
1H behaviour for the other engines is unchanged.

## Test gate
- `npm run build` clean (tsc + Next). One build failure on the way:
  narrowing `direction` to LONG|SHORT made a `=== BUY` comparison a
  type error in engineCore.ts - fixed by simplifying it to LONG.
- Mocked e2e `scripts/test-scalping-server.mjs` (fake Upstash REST +
  real production build + real Binance klines + throwaway VAPID keys):
  **ALL CHECKS PASSED (26/26, EXIT 0)** on 2026-11-24:
  - /api/scalping/signals: HTTP 200 in ~3.5s, 8 signals, 28/30 pairs
    scanned (2 failed live-data fetches, skipped honestly), all
    FUTURE, all LONG/SHORT, all stamped with a 4h expiry.
  - /api/scalping/signals?market=FOREX: 400, never fake data.
  - /api/signals?type=SPOT: 200, FUTURE signals only, LONG/SHORT only.
  - Seeded scalping records resolved from real 5m klines: BTC LONG
    LOSS -> STOPPED (SL 0.993 touched), BTC LONG WIN -> COMPLETED
    (TP3 +3% touched), past-expiry record -> EXPIRED, untouched
    record stays ACTIVE; records carry engine 'scalping' and
    isScalping: true.
  - /scalping and /dashboard served HTML contain no 'Spot Trading'
    button and no 'SPOT' string.
  - Watch configured, sent 0, zero push subscriptions stored - no
    real push was sent.
  - One test-design fix on the way: the first run's only failure was
    the test asserting the WATCH resolves the seeds - in fact the
    scalping route's own fire-and-forget sync resolves them first
    (the watch is a backstop), so the assertion now polls /api/history
    for the outcome instead of assuming the driver. No production
    code changed for that; the route resolving first is by design.
  - Note: the first full run was interrupted by a runtime restart
    (empty log - it piped through `tail`); re-run from scratch passed.
    Watch ticks in that run resolved 0 for six straight ticks while
    this VM's IP was Binance-418-banned; the route had already
    resolved the seeds, and the ban is the known recurring VM-IP
    pattern, not a code fault.
