# Scalping V2 + Money Rotation — Build Report

Date: 2026-11-21. Branch: `feature/scalping-v2` (local commit only, not pushed).
User instruction honoured throughout: **testing first, upload after** — every
claim below is backed by a test in the TEST RESULTS section.

---

## PAGE 1 — /scalping-v2 (ICT / Smart Money engine, ported and fixed)

### What was built
- `src/lib/signals/ictEngine.ts` — a faithful TypeScript port of the ICT
  engine extracted from the amg-eight bundle (`engine-body.js`), method by
  method: swing detection, market structure (BOS/CHoCH), FVGs, order blocks,
  liquidity sweeps, premium/discount, OTE, daily bias (4-vote, quantised
  confidence), session, volume filter, engulfing, true-range ATR, ranging
  check, /100 scoring, and the exact original gate order. It also returns a
  **gate-funnel diagnostic** (stage reached per scan) — new instrumentation,
  no logic change.
- `src/lib/signals/scalpingV2.ts` — server-side generation service: fetches
  100×5m + 100×1m candles per pair from Binance (data-api.binance.vision),
  freshness-checks both series, runs the engine, aggregates the funnel, and
  converts issued setups to the repo's `Signal` shape (final target = TP3).
- `src/app/api/scalping-v2/signals/route.ts` — thin route in the
  `/api/signals` pattern (60 s server cache, 502 when no pair loads).
- `src/app/scalping-v2/page.tsx` — scan funnel display, active signals via
  the shared `SignalList`, live price polling through the shared honest
  updater (`SignalGenerator.updateSignal`), and a closed-signals history
  (this browser) with realised P/L and milestone display.
- Storage: `SignalManager` gained a `scalpingv2` store type (completed
  records carry `isScalpingV2`), and `SignalCatchup` now includes it.

### Mandatory fixes applied (from the audit)
- **Simulated-candle fallback DELETED** — there is none anywhere in the new
  path; data failure = pair skipped, total failure = honest 502 /
  "Live Data Unavailable" UI state.
- **Freshness gate** (`BinanceAPI.isCandleSeriesFresh`, ≤ 2 candle
  intervals): stale/frozen series are rejected and counted, never analysed.
  This fires in production data today: FTM/USDT's spot series is frozen at
  Jan 2025 and is rejected as `pairsStale: 1` on every scan.
- **Universe updated**: MATIC/USDT → POL/USDT, RNDR/USDT → RENDER/USDT.
- **Grades recalibrated**: ELITE ≥ 88, A+ ≥ 75 (A ≥ 65, B ≥ 55 bands kept
  for display). Issuance at A+/ELITE only.
- **Honest accounting**: TP1 touch is a milestone, never a completion.
  A trade closes COMPLETED only at the final target (TP3) before SL,
  STOPPED at SL, EXPIRED at expiry (4 h), with realised P/L at the exit
  price — the shared rules from the main engine.
- **Honest labels**: the hard-coded `riskRewardRatio: 1.5` is gone; the
  signal exposes its real ladder (TP1 = 1.5R, TP2 = 3R, TP3 =
  `riskRewardToFinal`, computed — 5R or the swing extreme). The wrapper's
  post-offset RR check (which always equalled 1.5 and could never reject)
  was not ported.

### Threshold choice + firing sanity
Only the grade gate was changed (A+ 82 → 75, ELITE 90 → 88); no other
engine logic was touched to make it fire. On recent real data the ported
engine fires at a small, sane rate — see TEST RESULTS (3): 2 fires in
6,902 evaluations (12 pairs × 48 h), both A+ SELLs at scores 78/79, i.e.
≈ 1/day per 12 pairs (≈ 4/day extrapolated to the full universe). Under
the old ≥ 82 cutoff both would have been rejected — exactly the audit's
0-for-1,556 failure. The score distribution below the gate (74, 73, 71,
70, 69…) shows the threshold is reachable but selective.

---

## PAGE 2 — /money-rotation (the real money-rotation concept)

### What was built
- `src/lib/signals/moneyRotation.ts` — computes, per pair, from live 1h
  candles (server-side, data-api.binance.vision):
  - **quote-volume share** of the universe: last 24 h vs prior 24 h
    (share %, share change in pp, share momentum %);
  - **relative strength vs BTC** over 1h/4h/24h (percentage points) and
    the composite 0.5·RS24 + 0.3·RS4 + 0.2·RS1;
  - **rotation score** = clamp(50 + 1.5·shareMomentum + 2.5·rsComposite,
    0, 100) — formula published on the page, no black box;
  - classification IN (share momentum ≥ +5% and RS composite > 0),
    OUT (≤ −5% and < 0), NEUTRAL otherwise.
- Signals: only decisive rotation — IN with score ≥ 55 → LONG, OUT with
  score ≤ 45 → SHORT — **and** shareNow ≥ 0.1% of universe volume (see
  "interpretations" — added after the first smoke test). Levels: stop =
  1.5 × ATR(14, 1h, true range, from `engineCore.calculateATR`), targets
  1.5R / 3R / 5R, final = TP3, 4 h expiry. Every signal embeds its full
  rotation evidence; the page renders the complete table (share prev →
  now, momentum, RS 1h/4h/24h, score, class) so every number is auditable.
- `src/app/api/money-rotation/route.ts` (60 s cache; 502 if BTC or most
  of the universe is unavailable) and `src/app/money-rotation/page.tsx`
  (methodology, BTC benchmark line, stats, signal cards with evidence,
  full table, honest empty state).

---

## TEST RESULTS

**(1) Typecheck + build — PASS**
- `npx tsc --noEmit`: clean (run twice, before and after the final edits).
- `npm run build`: passes. Route table includes
  `ƒ /api/scalping-v2/signals`, `ƒ /api/money-rotation`,
  `○ /scalping-v2`, `○ /money-rotation`. Both pages return HTTP 200 from
  the production server.

**(2) /api/scalping-v2/signals smoke test (production build, live data) — PASS**
Two live scans (Sat 2026-11-21, ~15:55 and ~16:20 UTC):
- Run 1: HTTP 200. Funnel: requested 53, **loaded 51 fresh, stale 1,
  failed 1**; stages — ranging 23, noBias 1, noLtfBreak 17, wrongZone 4,
  confluence 3, belowGrade 3, **issued 0**. Top scores: SOL 57 (B),
  FET 49, SUI 36.
- Run 2: HTTP 200. Loaded 52, stale 1, failed 0; issued 0; top scores
  AVAX 55 (B), LDO 50.
- Zero issued in these two snapshots is a market state (quiet weekend
  session, best score 57 vs the 75 gate), **not** an error: the funnel
  proves the engine executed over fresh candles for 51–52 pairs and
  filtered them at the documented stages. Firing itself is proven by (3).

**(3) ICT firing sanity on recent historical data — PASS**
Harness `scripts/ict-sanity.ts` (pattern follows `scripts/backtest.ts`),
running the exact production `ICTEngine` over the last 48 h of real
Binance 5m/1m candles, closed candles only, 5-min steps, 60-min
one-open-signal suppression, dailyOpen from the 5m candle 24 h prior:
- **6,902 evaluations across 12 pairs → 2 fires**:
  ETH/USDT SELL, score 78 (A+), 2026-11-20T00:30Z;
  SUI/USDT SELL, score 79 (A+), 2026-11-21T00:10Z.
- Rate: 1.0 fire/day per 12 pairs (≈ 4.4/day extrapolated to 53 pairs) —
  > 0 and sane for an A+-grade scalping scanner; not dozens/hour.
- Historical funnel: noLtfBreak 3,911; ranging 1,677; wrongZone 889;
  noBias 294; belowGrade 89; confluence 40; issued 2. Top scores seen:
  79, 78, 74, 73, 71, 70, 69, 69, 69, 69.
- No further recalibration was needed: the threshold fix alone cured
  the original never-fires failure.

**(4) /api/money-rotation spot check vs independent data — PASS**
Independent Python reconstruction from data-api.binance.vision (same
rules, written separately):
- Same universe: **52 pairs loaded, FTM excluded as stale in both**
  implementations. Universe 24h quote volume: independent $6,032.2M vs
  API $6,031.1M (0.02% apart — snapshot drift of the in-progress hour).
- Shares sum to exactly 100.0% (now and prev) in the API output.
- BNB/USDT: shareNow 2.5199 (indep) vs 2.5202 (API); sharePrev 2.6750 vs
  2.6750; RS24h −0.92 vs −0.95 pp; RS4h +0.46 vs +0.43 pp.
- NEAR/USDT: shareNow 2.3384 vs 2.3380; sharePrev 2.6750 vs 2.6750;
  RS24h −0.49 vs −0.51 pp; RS4h +0.14 vs +0.11 pp.
- PEPE/USDT: shareNow 0.6330 vs 0.6331; sharePrev 1.0922 vs 1.0922;
  RS24h −0.27 vs −0.33 pp; RS4h −1.43 vs −1.49 pp.
- Share deltas ≤ 0.0004 pp; RS deltas ≤ 0.061 pp, identical across the
  1h/4h/24h windows per pair — the signature of price drift between the
  two snapshots (~1–2 min apart), not of a computation difference.
- (Curiosity verified, not a bug: BNB and NEAR prior-24h shares agree to
  5 decimal places — 2.67497447…% vs 2.67497340…% — their prior-day
  quote volumes genuinely differ by only ~$65k on a ~$161M base.)
- Live behaviour: first run issued 22 signals, dominated by micro-share
  pairs (a 0.02%-share pair swinging ±20% share momentum on one small
  hour). After adding the documented 0.1% share floor: **14 signals**,
  all SHORT, in a tape where BTC's share rose 50.2% → 56.1% (money
  rotating into BTC / out of alts) — the one-sided board is the honest
  picture of that regime. All 14 hold ≥ 0.13% share (≥ ~$8M/day volume).

**(5) No simulated/random fallback in the new code paths — PASS**
`grep -rn 'Math.random'` over all new files (ictEngine.ts, scalpingV2.ts,
moneyRotation.ts, both API routes, both pages, ict-sanity.ts): the only
hit is a **comment** in ictEngine.ts describing the original page's
removed behaviour. No executable random, simulated-candle, or
hard-coded-price fallback exists in any new code path. (Pre-existing
`Math.random` uses elsewhere in the repo — e.g. the V1 scalping page's
pair shuffle and the main engine's analyzer components — were not
touched; they are outside these two pages' data paths.)

---

## Files changed

New:
- `src/lib/signals/ictEngine.ts` — ICT engine port + funnel diagnostics
- `src/lib/signals/scalpingV2.ts` — V2 universe, freshness-gated scan, Signal conversion
- `src/lib/signals/moneyRotation.ts` — rotation computation + signals
- `src/app/api/scalping-v2/signals/route.ts`
- `src/app/api/money-rotation/route.ts`
- `src/app/scalping-v2/page.tsx`
- `src/app/money-rotation/page.tsx`
- `scripts/ict-sanity.ts`, `scripts/tsconfig.ict.json` — firing-sanity harness
- `SCALPING-V2-REPORT.md` — this report

Modified:
- `src/lib/signals/binanceAPI.ts` — `Candle` type, `getCandles()`,
  `getAll24hTickers()`, `isCandleSeriesFresh()`
- `src/lib/services/signalManager.ts` — `scalpingv2` store type
  (`SignalStoreType`, `isScalpingV2` on completed records)
- `src/lib/services/signalCatchup.ts` — catch-up now includes scalpingv2
- `src/components/layout/Navbar.tsx` — links to both new pages

## Interpretations (where the port could not be a pure copy)
1. **Universe size is 53 pairs, not 54.** The audit's "54" count included
   the literal string `"/USDT"` that appears in the page code; the
   extracted pair list itself has 53 entries. All 53 are ported, with
   MATIC → POL and RNDR → RENDER.
2. **dailyOpen**: production passes the 24h ticker's openPrice (what the
   original page used, per the audit). The engine's internal fallback
   (first candle of the calendar day) is ported unchanged.
3. **Wrapper offset dropped**: the original page shifted every level by
   0.015% of entry and then "checked" RR against TP1 (always exactly
   1.5, never rejecting). The shift existed only around that check; the
   port issues the engine's own unshifted levels and no check.
4. **Expiry added (4 h)**: the original had no expiry — trades ran until
   TP/SL under 3-second polling, with TP1 marking completion. Honest
   accounting needs an EXPIRED state, so a 4 h scalping expiry is set
   and stated on the page. The original's "TP3 only counts within
   30 min of TP2" downgrade rule was dropped as arbitrary.
5. **Final target = TP3**: "completed" means the TP3 the engine computed
   (5R, or the swing extreme when it lies beyond 3R) is reached before
   SL. `takeProfit` is set to TP3 so the shared updater enforces this.
6. **FTM/USDT kept in the list** (only MATIC/RNDR were mandated for
   replacement). Its spot series is frozen (Jan 2025), so the freshness
   gate excludes it automatically and visibly (`pairsStale: 1`).
7. **Direction mapping**: ICT BUY/SELL → LONG/SHORT (futures), the
   repo's convention for FUTURE signals.
8. **Rotation formula weights are new** (the concept did not exist to
   copy): score = clamp(50 + 1.5·shareMomentum + 2.5·rsComposite);
   rsComposite = 0.5·RS24 + 0.3·RS4 + 0.2·RS1. Published on the page.
9. **Signal share floor (0.1%)** added after smoke test (4) showed
   micro-share noise dominating issuance; documented in code and on
   the page. The rotation *table* still shows every pair's real numbers.
10. **Session scoring** uses the server's UTC clock (the original used
    the visitor's browser clock via `Date`); in the historical harness
    all steps are scored with the run-time session (≤ 5 points) — the
    same caveat the original audit's harness carried.
