# Signal History — server-side completed-signal record

## Problem (verified from code)
`/completed` and `/on-chain/completed` read ONLY the visitor's browser
localStorage (`completedSignals`). A signal was recorded as completed only
if that browser happened to see it resolve. When the engine stopped
re-issuing a signal (recent real cases: OP/USDT and ARB/USDT shorts
vanishing from `/api/signals` without touching SL or TP1), the signal
disappeared from the API and never reached any completed page.

## Fix
Every standard-engine and on-chain signal is now recorded on the server,
in the Upstash Redis store that already exists for push notifications
(same env vars, no new service, no new secrets). Gold and scalping-v2
are untouched in this PR.

- `src/lib/history/store.ts` — storage layout:
  `signal:history:active` (hash id → record JSON),
  `signal:history:resolved` (hash) + `signal:history:resolved:by-time`
  (zset by resolvedAt, capped at 200 entries, oldest pruned first).
- `src/lib/history/resolve.ts` — outcome walker over real 1H klines
  from data-api.binance.vision, first touch decides: SL first → LOSS
  (status STOPPED), TP3 first → WIN (COMPLETED), TP1/TP2 recorded as
  milestones, expiry with neither touched → EXPIRED. Honesty rules:
  the issuance candle is skipped (its range includes pre-signal action);
  SL wins a same-candle SL+TP3 tie; a candle opening after expiry is
  beyond the signal's life; if klines cannot be fetched the signal
  stays active — a missing data source never invents a result.
- `src/lib/history/sync.ts` — `resolveHistory()` (resolve stale actives
  for both engines) and `recordStandardSignals()` (Redis-only recording
  of the current standard signals). `syncOnChainHistory()` (record +
  resolve) is used by the on-chain route.
- `src/lib/push/notify.ts` — `checkAndNotify()` now resolves history
  FIRST, then evaluates the engines, then records current standard
  signals. See "Ordering lesson" below.
- `src/app/api/history/route.ts` — GET, public read like the other
  signal APIs: resolved signals (latest 100, newest first) plus active
  count. No auth, no secrets in the response.
- `src/app/completed/page.tsx`, `src/app/on-chain/completed/page.tsx`
  — fetch `/api/history` and merge with existing localStorage entries,
  deduped by id, server record winning on conflict. Layout unchanged;
  no new headings or prose (site stays clean).
- `src/app/api/on-chain/signals/route.ts` — fire-and-forget
  `syncOnChainHistory(report.signals)` after caching the fresh payload.

Identity: `<ENGINE>:<PAIR>:<DIRECTION>:<first-seen bar ISO>` — the same
concept as the push IDs. First-seen entry/SL/TP levels are canonical;
later re-issues of the same setup are NOT recorded again.

## Ordering lesson (found by the e2e test, fixed in this PR)
The first version ran history resolution AFTER `collectCurrentCandidates()`.
Six watch ticks in a row then resolved 0. Cause: the three engines fetch
~80 Binance endpoints in parallel, and that burst trips Binance's 418 IP
rate-limit — every kline fetch after the burst fails, so the resolver
always found "no data" and left signals active, deterministically, on
every tick. Resolution now runs BEFORE engine evaluation, while the IP
is still fresh, and `defaultKlineFetcher` has one bounded retry (10s)
for transient 418/429/5xx only (451 geo-block and bad symbols are not
retried). The on-chain route's own resolve step can still hit the ban
after its generation burst — the watcher's resolve-first step covers it
on the next tick.

A second, related catch: the mocked e2e test's fake Upstash server first
returned HGETALL as a JSON object, which the @upstash/redis client
silently deserializes to `{}` (it expects the real wire format: a flat
array `[field, value, ...]`). The fake now returns the flat array.
Production code was correct throughout; the fake was wrong.

## Tests (all passed before PR)
- `npm run build` — clean (tsc + Next build).
- `scripts/test-signal-history.mjs` — mocked end-to-end: fake Upstash
  REST endpoint (in-memory) + real production build (`next start`) +
  real Binance 1H klines (read-only) + throwaway VAPID keys. Seeded
  outcomes are verified from the same klines the server walks before
  seeding — never invented:
  - FET/USDT SHORT (entry 0.1053, SL 0.11105, issued 2026-11-23 03:07Z):
    SL touched in the 12:00 UTC candle (high 0.11140) → LOSS, exitPrice
    exactly the SL.
  - BTC LONG (entry 81861.24, issued 2026-10-22 08:00Z): TP3 touched
    first → WIN.
  - BTC SHORT (same entry/hour, on-chain): SL touched first → LOSS.
  - Two records with absurd levels and a past expiry → EXPIRED.
  - One record with absurd levels and a live expiry → stays ACTIVE.
  - First watch tick resolved 5 (1 win, 2 losses, 2 expired), active 1;
    `/api/history` returned all 5 with no duplicates; second read stable;
    on-chain route 200; watch `sent: 0` and zero push subscriptions
    stored — no real push notification was sent at any point.
- Not verified by this test: a live-signal push send (no subscribers
  exist) and the completed pages' client-side merge rendering (no live
  signal was mounted during the smoke run); the merge code is a plain
  fetch + dedupe over the existing localStorage path.
