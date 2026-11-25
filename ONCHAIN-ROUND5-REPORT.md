# On-chain ROUND 5: standard entry + core ATR levels as the ship candidate — PRE-REGISTERED

Date: 2026-11-25. Written BEFORE running the ship test. Branch: `feature/onchain-round5`.

## Fidelity check (step 1, DONE before this file was written)

The round-4 harness (`scripts/backtest-onchain-standard.ts`) was recompiled
from the current source and re-run. It reproduces round 4 EXACTLY:

| Variant | Fired | W / L / Exp | Win rate | Expectancy |
|---|---|---|---|---|
| S0 control (standard entry, on-chain levels, 48h) | 10 (3L/7S) | 1 / 2 / 7 | 33.3% | +0.667R |
| D0 DIAGNOSTIC (standard entry + core ATR levels, 48h) | 12 (4L/8S) | 6 / 1 / 5 | 85.7% | +0.480R |

D0: 12 fired, 6W/1L, +0.480R, TP1 touched on 10 of 12. No discrepancy —
proceeding to the Round 5 ship test.

## The problem (established, rounds 1–4)

Four rounds failed on the 95-day window (2026-08-16 → 2026-11-19), honest
accounting (WIN only at final TP, LOSS at SL, expired excluded):

| Round | What was tried | Best result |
|---|---|---|
| 1 — regime filter | BTC trend/regime veto on the toy entry | −0.615R (worse than baseline −0.545R) |
| 2 — levels grid | 6 (SL, final-TP) pairs | −0.059R (TP1-as-final; still negative) |
| 3 — new entry rules | stricter threshold, EMA50, veto, 96h expiry | −0.167R (strict + 96h, E3) |
| 4 — standard entry | core verbatim, on-chain fixed levels | +0.667R on 3 resolved trades — noise, gate fail |

Round 4's diagnostic settled the real question: **the binding constraint is
the LEVELS, not the entry.** The same proven entry earns on the core's own
ATR levels (D0: 6W/1L, +0.480R) but starves on the on-chain fixed
−3%/+12% levels (7 of 10 expire unresolved in 48h; +12% TP reached once
in 10 fires). Rounds 1–3 tested the wrong half.

The small-sample problem: the standard core fires only ~10–12 times per
95 days on BTC-only, so the old gate (resolved ≥ 10) is nearly
unreachable in a single-pair window — D0 itself resolved only 7. This
round strengthens the sample with option (b): the multi-pair basket
universe (below), and uses a gate designed for the small sample (below).

## The ship candidate (R5 design — pre-registered)

**Standard entry + core ATR levels, basket-wide.** Concretely:

- **BTC leg:** `evaluateSignalCore()` verbatim (`DEFAULT_RULES`), exactly
  as in D0. Direction, entry, confidence, stopLoss, takeProfit (final),
  takeProfit1 come from the core's own output. Nothing re-tuned.
- **Alt legs (the correlated basket, as in production):** the top-10
  coins from `CorrelationMatrix.getCorrelatedCoins(0.74).slice(0, 10)`,
  read from the code (not from memory): ETH 0.90, SOL 0.88, AVAX 0.87,
  MATIC 0.86, BNB 0.85, LTC 0.83, DOT 0.82, LINK 0.81, APT 0.80,
  UNI 0.79. Each alt inherits the BTC direction, entry = the alt's own
  close at the event hour, confidence = min(BTC confidence + 2, 95)
  (exactly as `CorrelatedSignalGenerator` sets it in production).
  Each alt's levels are the **core's ATR level formula, verbatim**
  (engineCore.ts: slMultiplier = 1.5 − 0.3·(confidence/100);
  tpMultiplier = 3.5 + 2.5·(confidence/100); ATR(14) from true range;
  Bollinger-band stop adjustment; TP1/TP2/TP3 at 25%/65%/85% of the
  TP distance with the 0.5%-of-entry minimum distance), applied to the
  alt's own ATR and Bollinger bands at the event hour, for the BTC
  direction. No multiplier is re-tuned; the formula is copied, not
  re-derived.
- **MATIC slot = POLUSDT.** Production's on-chain path fetches
  `MATIC/USDT` with no MATIC→POL mapping (the mapping exists only in
  the scalping-v2 engine); MATICUSDT was delisted in Sep 2024, so the
  production MATIC leg today fetches a frozen series. The backtest
  uses POLUSDT (the live traded pair) for the MATIC slot. Shipping
  this design REQUIRES the same MATIC→POL mapping in the on-chain
  path — recorded here as part of the ship implementation, not as a
  separate change.
- **Expiry 48h** (R5) / **96h** (R5-96, see variants). One basket event
  at a time: after a BTC event fires at hour i, the next BTC
  evaluation starts at the BTC leg's resolution hour + 1 (identical
  cadence to D0 — the same ~12 BTC events). Alt legs resolve
  independently on their own price paths (each pair's own SL/TP,
  same expiry).
- **Whale veto (LIVE-ONLY):** whale flow must not oppose the direction
  (LONG requires net flow ≥ 0, SHORT requires net flow ≤ 0; neutral
  never blocks; fail-neutral). It CANNOT be evaluated in the backtest
  (no historical whale data — same infeasibility as rounds 1–4), so it
  is a documented no-op here. The backtest validates entry + levels
  ONLY, never the veto.
- **Outcome rules (honest, same as rounds 1–4):** WIN = final TP
  (core `takeProfit`) first; LOSS = SL first; AMBIG = both in the
  same candle (excluded); EXPIRED = neither within expiry (excluded
  from win rate/expectancy). TP1 (`takeProfit1`) is a milestone only;
  TP1 touches are counted and reported. Win R per trade = the core's
  own RR for that leg (TP distance / SL distance); a LOSS is −1R.

## Sample strengthening (option b, pre-registered)

The ship test runs the R5 design over the **full basket (BTC + 10
alts = 11 pair-trades per BTC event)** on the same 95-day window,
same honest accounting. Basket data: canonical
`~/workspace/.amg-bt/data/` (BTC + ETH, SOL, AVAX, BNB, DOT, LINK,
UNI already present, 3120 candles each, 2026-07-14 → 2026-11-21)
plus APTUSDT, LTCUSDT, POLUSDT fetched 2026-11-25 from
`data-api.binance.vision` klines (real Binance 1H candles, same
window) — all three verified: 3120 candles each, `openTime` arrays
exactly equal to BTCUSDT.json, no gaps. The three files are saved
alongside the canonical set with the same JSON shape
(openTime/high/low/close/volume).

Caveat, stated before the run: pooled basket outcomes are CORRELATED
— one BTC decision drives all 11 legs — so the effective independent
sample is the ~12 BTC events, not the ~130 pair-trades. The gate's
resolved ≥ 7 and the concentration cap guard against one-trade
wonders, but the per-event breakdown (basket-total R per BTC event,
and how many events are net-positive) is reported alongside the
pooled numbers so the result cannot hide behind the basket.

## Ship gate (designed for the small sample — written BEFORE the run)

Applied to the POOLED basket outcomes (all 11 legs, all events).
ALL four conditions must hold:

1. Expectancy > **+0.15R**
2. Resolved (W+L) ≥ **7**
3. Win rate ≥ **50%**
4. Concentration: no single trade contributes more than **50%** of
   total expectancy (max single-trade R / |sumR| ≤ 0.5)

A marginal or noise-level pass is a NO-SHIP. No lowering the gate,
no cherry-picking a sub-window, no adding variants after the run.

## Pre-registered variants (ship candidates — at most 2)

- **R5 — standard entry + core ATR levels, basket, 48h expiry.**
  The ship candidate.
- **R5-96 — R5 with 96h expiry.** Rounds 3–4 showed expiry helps
  once the entry is strict. If both pass, the better expectancy
  ships; if only one passes, it ships as tested (with the live-only
  whale veto, per the round-4 reasoning: the veto only removes
  signals, so every signal it issues is a member of the backtested
  population).

## Fidelity check for the alt-level formula (must pass BEFORE the ship test counts)

The harness computes the alt levels with the verbatim core formula.
As a check, the SAME formula is applied to the BTC leg at every D0
event (same entry, direction, ATR, confidence, Bollinger as the core
used) and compared against the core's own stopLoss/takeProfit. They
must match (relative error < 1e-9). If they do not match, STOP and
report the discrepancy — the ship test does not run. A second check
requires the 48h variant's BTC-leg subtotal to reproduce D0 exactly
(12 fired, 6W/1L, +0.480R); it applies to the 48h variant ONLY —
the 96h variant has a different resolution cadence by design, so its
BTC leg legitimately differs. (Harness correction found during the
first run: check 2 was initially applied to both variants and the
96h run tripped it with 10 fired / 5W/1L — the check itself was
mis-scoped, not the design. The design and gate are unchanged.)

## Method (identical to rounds 1–4 unless stated)

- Data: canonical `~/workspace/.amg-bt/data/` + the three fetched
  files above. Eval window starts at index 800 (2026-08-16, 4H
  EMA200 ready) — the same window the standard engine's gate used.
- Harness: `scripts/backtest-onchain-round5.ts` (new) + tsconfig.
  Builds `MarketData` exactly as `scripts/backtest.ts` does
  (WINDOW = 100 1H closes + highs/lows/volumes, `closes4hAt`,
  precomputed `btcTrendAt`), calls `evaluateSignalCore(md, FUTURE,
  DEFAULT_RULES)` — the exact production function. `Math.random`
  pinned to 0.5 (same as `scripts/backtest.ts`). Engine logging
  silenced during the sweep.
- Whale half: NOT backtested. No whale input is simulated anywhere.

## What ships if a variant passes

In `onChainGenerator.generateSignalForBitcoin`:
- Build the same `MarketData` the standard route builds
  (`MarketDataManager.generateMarketData` + `BinanceAPI.get4hCloses`
  + `BinanceAPI.getBtcRegime`, funding left undefined) and call
  `evaluateSignalCore` — replacing `calculateOnChainTechnicalScore`
  entirely. Direction, confidence, RSI, MACD display fields come
  from the core result.
- Apply the whale-must-not-oppose veto from the live transaction
  feed (fail-neutral: if the flow cannot be computed, do not block).
- Remove the redundant standalone regime-veto code (the core
  applies the same filter) and the now-dead toy technical half
  (`onChainScoring.ts` — kept for the harness's historical record,
  or removed; decided at implementation time and stated in the PR).
- In `CorrelatedSignalGenerator`: replace the fixed-percentage
  `calculateLevels` with the core ATR level formula (same
  multipliers, same Bollinger adjustment, same minimum distance),
  applied per alt with the alt's own ATR/Bollinger and the
  production alt confidence (BTC confidence + 2, cap 95).
  Map the MATIC slot to POLUSDT (see above).
- Keep 48h/96h expiry as tested, the existing diagnostics —
  extended with the core's scores (`buyScore`/`sellScore`/
  `confidence`) and `whaleVetoBlockedLong/Short` counts — and the
  correlated basket. `onChainScoring.ts` becomes dead code for the
  generator.
- Do NOT touch the standard engine itself, gold, scalping-v2, or
  the old scalping engine.
- State plainly in the PR and the final message: after this change
  the on-chain BTC signal is nearly the standard engine's BTC
  signal — the remaining differences are the whale veto and the
  alt basket.

## RESULTS (filled in after the run — nothing below was known beforehand)

Run: `BT_DATA_DIR=$HOME/workspace/.amg-bt/data node
/tmp/amg-bt-build/scripts/backtest-onchain-round5.js`
(log: `/tmp/onchain-round5-run.log`). Eval window 2026-08-16T22:00Z →
2026-11-19T13:00Z. Regime mix: UP 1472h / DOWN 848h / NEUTRAL 0h.
Compile clean. Fidelity check 1 PASSED (the verbatim formula
reproduces the core's BTC stopLoss/takeProfit at every event,
relative error < 1e-9). Fidelity check 2 PASSED for the 48h variant
(BTC leg reproduces D0 exactly: 12 fired, 6W/1L/5 exp, +0.480R).
One harness correction during the run: check 2 was initially
applied to both variants and the 96h run tripped it (10 fired,
5W/1L) — the 96h variant has a different resolution cadence by
design, so check 2 is 48h-only. Design and gate unchanged.

| Variant | Events | Legs | W / L / Ambig / Exp | Win rate | Expectancy | SumR | Max single-trade share | TP1 touched |
|---|---|---|---|---|---|---|---|---|
| **R5 (48h)** | 12 | 132 (skipped 0) | 61 / 25 / 0 / 46 | 70.9% | **+0.497R** | +42.71R | 9.7% | 101 of 132 |
| **R5-96 (96h)** | 10 | 110 (skipped 0) | 51 / 25 / 0 / 34 | 67.1% | **+0.445R** | +33.82R | 12.2% | 90 of 110 |

R5 per-pair (fired W/L/exp sumR) — every pair net-positive:
BTC 12 6/1/5 +3.36R · ETH 12 6/1/5 +4.33R · SOL 12 7/1/4 +9.10R ·
AVAX 12 6/3/3 +2.80R · POL 12 3/5/4 +2.61R · BNB 12 6/2/4 +2.61R ·
LTC 12 6/2/4 +5.00R · DOT 12 6/3/3 +3.60R · LINK 12 5/2/5 +3.60R ·
APT 12 5/3/4 +2.21R · UNI 12 5/2/5 +3.47R.
POL is the weakest leg (3W/5L) but still net-positive.

R5 per-event basket R: 7 net-positive / 4 net-negative / 1 flat of
12 events: [+6.33, +16.70, −2.87, −0.87, −1.00, −11.00, +0.00,
+0.41, +8.19, +10.93, +2.20, +13.70]. Honest notes: one event lost
−11.00R (all 11 legs stopped out) and one event contributed
+16.70R (~39% of the +42.71R total) — the result is broad-based
across pairs and events (7 of 12 events net-positive), but it is
not uniform; the gate's concentration cap is per-trade (9.7%, met),
not per-event, and no post-hoc per-event cap was added.

### Gate verdict: BOTH VARIANTS PASSED — SHIP R5 (48h)

Gate (pooled basket, all four): expectancy +0.497R > +0.15R ✓ ·
resolved 86 ≥ 7 ✓ · win rate 70.9% ≥ 50% ✓ · max single-trade
share 9.7% ≤ 50% ✓. R5-96 also passes (+0.445R, 76 resolved,
67.1%, 12.2%) — the better expectancy ships, so **R5 (48h)** is
the ship candidate, with the live-only whale veto, exactly as
pre-registered. This is the FIRST passing gate of the whole
on-chain programme (rounds 1–4 all failed).

### What this means

The D0 design earns basket-wide, not just on BTC: the standard
entry + core ATR levels transfer to the correlated alts (each alt
leg uses its own ATR/Bollinger with the BTC direction). The whale
veto remains UNTESTED (live-only) — the backtest validates entry +
levels only. After shipping, the on-chain BTC signal is nearly the
standard engine's BTC signal; the remaining differences are the
whale veto and the alt basket.

## Implementation (what shipped)

Branch: `feature/onchain-round5` (from the working tree on the PR #21
checkout; true main 393e589e).

- `src/lib/signals/engineCore.ts` — level computation extracted verbatim
  into exported `calculateCoreLevels()`; `evaluateSignalCore()` calls it.
  Behaviour verified identical: the round-4 harness reproduces D0 exactly
  (12 fired, 6W/1L, +0.480R) AND the original gate harness reproduces the
  PR #2 numbers exactly (577 / 58.4% / +0.262R) after the refactor.
- `src/lib/signals/onChainGenerator.ts` — BTC signal now from
  `evaluateSignalCore()` verbatim (MarketData via MarketDataManager +
  `get4hCloses` + `getBtcRegime`, funding left undefined) + live-only whale
  veto (LONG needs flow.net >= 0, SHORT needs <= 0, neutral never blocks)
  + core levels. The toy RSI/MACD technical half is gone (round 3 proved
  MACD sign alone could fire a signal); `onChainScoring.ts` is kept for
  harness history but no longer imported. Diagnostics now carry
  buyScore/sellScore/coreConfidence/btcRegime/whaleVetoBlockedLong/Short
  (removed: technicalScore/combinedScore/threshold/regimeBlocked).
- `src/lib/signals/correlatedSignalGenerator.ts` — alt levels via shared
  `calculateCoreLevels()` (alt ATR/Bollinger, alt confidence = BTC conf + 2,
  cap 95); `MARKET_PAIR_OVERRIDES` maps the MATIC slot to POL/USDT
  (production's on-chain path previously fetched the frozen MATICUSDT series
  with no mapping); signal `takeProfit` = core full takeProfit.
- `src/app/api/on-chain/signals/route.ts` — header comment only.
- `src/app/on-chain/page.tsx` — diagnostics panel shows the core scores +
  whale veto lines instead of the toy scores.
- `scripts/backtest-onchain-round5.ts` + `scripts/tsconfig.backtest-onchain-round5.json`
  (pre-registered, re-runnable), `scripts/test-onchain-round5.ts` +
  `scripts/tsconfig.test-onchain-round5.json` (mocked e2e).

The diff against true main (393e589e, verified via the GitHub connector's
`get_file_contents`) contains ONLY these 5 modified files + the 5 new files
above. Nothing else changed: standard engine, gold, scalping-v2 and the old
scalping engine are untouched.

## Test evidence (before push)

| Check | Result |
|---|---|
| Fidelity 1 — D0 reproduced (round-4 harness, post-refactor) | 12 fired, 6W/1L, +0.480R — EXACT |
| Fidelity 2 — 25-pair universe, 3 new files aligned | BTC + 3 (APT/LTC/POL) reproduces D0 exactly (6W/1L, +0.480R); 96h legitimately differs (10 fired, 5W/1L), check 2 is 48h-only |
| R5 gate (48h) | 12 events, 132 legs, W 61 / L 25, 70.9%, +0.497R, sumR +42.71R, max single-trade share 9.7% — ALL FOUR GATE CONDITIONS MET |
| R5-96 gate (96h) | 10 events, 110 legs, W 51 / L 25, 67.1%, +0.445R, max share 12.2% — also passes; best passer (R5 48h) ships |
| Original gate harness (PR #2 reproduction, post-refactor) | 577 / 58.4% / +0.262R — EXACT |
| Mocked e2e `scripts/test-onchain-round5.ts` (hour 872, canned live data) | ALL 30 CHECKS PASSED: 11 signals; BTC entry/SL/TP/TP1/TP3/confidence byte-equal to the core's output; ETH leg levels byte-equal to the independent core-formula computation; POL/USDT in, MATIC/USDT out; veto test: net inflow blocks the LONG, 0 signals, whaleVetoBlockedLong 1 |
| Live smoke (`next start`, real Binance + Blockchain.info) | /api/on-chain/signals 200 — 0 signals, honest empty (core issued nothing this bar, flow NEUTRAL $0.0M, 39 real txs, btcRegime DOWN); /api/signals 200; /completed 200; /on-chain 200 |
| `npm run build` (tsc + Next, final, after all edits) | clean |

## What this means for the user, plainly

After this change the on-chain BTC signal is nearly the standard engine's
BTC signal — the remaining differences are the whale veto and the alt basket.
The on-chain page no longer has its own entry logic; it reuses the one
engine that has actually earned money in backtesting (58.4% win, +0.262R
over 95 days) and the whale feed can only REMOVE a signal, never create one.
The whale half is still unbacktested (infeasible historically) — the veto
is a live-only gate, labelled as such, never presented as backtested.

Two honest caveats carried over from the backtest (unchanged by this round):

1. One event lost -11.00R (all 11 legs stopped out); one event contributed
   +16.70R (~39% of total). Broad-based (all 11 pairs net-positive) but not
   uniform.
2. Production history resolution (PR #20, `resolve.ts`) records WIN at
   takeProfit3 (85% of TP distance), while ALL backtests (PR #2 gate, D0,
   R5) use the full core.takeProfit (100%) as the WIN level. Pre-existing
   and engine-wide (same for the standard engine), so live recorded win
   rates may run slightly higher than backtested ones. Not changed in this
   round (out of scope — it would change the standard engine's recorded
   history too).

## Ship record (to fill after merge)

- PR: #
- Merged main SHA:
- Live verification (post-deploy):
