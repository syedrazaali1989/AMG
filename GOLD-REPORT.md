# AMG Trading — Gold Signal Engine: Gate Report

Branch: `feature/gold-engine` (local only, not pushed)
Date: 2026-11-22
User order: "Ab ek strong engine sirf gold k signal ka bannao" — a dedicated
gold signal engine, under the standing rule: test first, ship only what
passes the walk-forward gate.

## Verdict: NO-SHIP — the gate failed, nothing was added to the site

The engine was built and backtested exactly as specified. The frozen
segment-1 winner (G6) reached segment 2 with a positive expectancy
(+0.086R) and enough signals (113 fired), but its expectancy is
**smaller than one standard error (±0.106R)** — statistically
indistinguishable from zero at the bar every previous round was held
to. The untuned default configuration is noisier still. Gold did not
earn its page on this evidence, so `/gold` and `/api/gold/signals`
were **not** built, and production is byte-identical to main 76dcced0
(the only commit on this branch is this report).

---

## Step 1 — Instrument: PAXG/USDT (evidence)

Probed live on `data-api.binance.vision` (the only Binance domain
proven reachable from this site's Vercel deployment), 2026-11-22:

| Instrument | Result |
|---|---|
| **XAUUSDT spot** | **Not listed** — exchangeInfo and klines both return HTTP 400 (invalid symbol). Binance offers XAU only as a futures perpetual, whose data domain is geo-blocked from the site's servers. Not usable. |
| **PAXGUSDT spot** | **TRADING, deep and liquid** — 1H klines back to **2020-08-28**; last price $3,543.60; 24h quote volume ≈ **$9.41M** across 53,312 trades at probe time. |
| XAUTUSDT spot | Listed, but 1H history only from 2026-03-26 (~8 months) — too shallow for this gate. Not chosen. |

**Chosen: PAXG/USDT.** PAXG is Paxos-issued tokenised gold —
1 PAXG = 1 troy ounce of physical gold held in custody — and its
price tracks the spot gold price. Cross-check at probe time: PAXG
$3,543.60 vs XAUT $3,540.34, a ~0.09% spread between two independent
tokenised-gold instruments. The engine would have priced on PAXG,
and the page copy would have said so. The site's old forex layer was
**not** touched — it is simulated and is not a data source.

**Dataset actually used:** PAXGUSDT 1H klines, **2023-01-01 →
2026-11-22, 34,112 candles**, downloaded from data-api.binance.vision
and preserved at `~/workspace/.amg-bt/data-gold/PAXGUSDT.json`.
Exactly **one missing hour** in 3.9 years (2023-03-24T13:00Z).
Liquidity is real throughout and grows over time (median hourly
quote volume ≈ $46k in 2023 → $536k in 2026). Because PAXG trades
24/7 on Binance, there are no weekend gaps to paper over: weekend
liquidity is thinner (median hourly quote volume ≈ $78k vs ≈ $188k
on weekdays) but continuous — the backtest trades the actual PAXG
series, weekends included, exactly as the live engine would have.

## Step 2 — Engine design (built, tested, not shipped)

`goldEngineCore.ts` (pure decision core, mirroring engineCore's
structure; exact bytes preserved at
`~/workspace/.amg-bt/goldEngineCore.ts`). Same indicator scoring
family and weights as the crypto engine (RSI / momentum / ROC /
MACD / Bollinger / EMA trend / volume), pullback-confirmed long
entries, counter-trend gate (score ≥ 70), ATR-based stop with the
Bollinger adjustment, TP1/TP2/TP3 ladder at 25% / 65% / 85% of the
move with the full TP as the trade target, 48h expiry, FUTURE
(LONG/SHORT) semantics — the same convention `/api/signals` uses.

Differences from crypto, by design:
- **BTC regime filter removed** (meaningless for gold); replaced by
  a **daily-regime filter on gold itself**: no longs below the
  daily EMA200, no shorts above it.
- **4H MTF confirmation kept** (gold's own 4H EMA50 vs EMA200).
- **No funding filter** (spot instrument).
- **Gold-specific parameters made explicit** — the crypto long-entry
  pullback band (0.5–1.5% in 10h) and 0.5% minimum TP distance are
  large moves for gold, so band and minimum distance are parameters
  with a pre-registered gold-scaled set (0.1–0.5% / 0.2%).

## Step 3 — Backtest gate (walk-forward, honest accounting)

Harness: `~/workspace/.amg-bt/backtest-gold.ts` (results:
`gold-results.json`). Identical outcome rules to the crypto gates:
WIN only at full TP before SL; same-candle TP+SL = ambiguous
(excluded — **zero occurred** in any variant); neither within 48h =
EXPIRED (excluded from win rate and expectancy); one open signal at
a time; hourly evaluation; `Math.random` pinned to 0.5 as in all
previous gates. Evaluation starts 2023-07-19 (first hour with 200
daily closes for the regime warmup).

- **Segment 1 (selection):** 2023-07-19 → 2025-07-20
- **Segment 2 (frozen):** 2025-07-20 → 2026-11-20

Pre-registered variants: G0 = default (crypto parameters verbatim,
both filters on, score ≥ 58); G1 = gold-scaled, both filters;
G2 = gold-scaled, 4H only; G3 = gold-scaled, daily only;
G4 = gold-scaled, no filters; G5 = gold-scaled, both filters,
score ≥ 65; G6 = gold-scaled, both filters, score ≥ 52.
Selection rule: highest segment-1 expectancy among variants with
≥ 30 resolved segment-1 trades. Ship rule (segment 2, frozen
winner): expectancy > 0 **and** > 1 × SE **and** ≥ 50 fired.

### Segment 1 — selection

| Variant | Fired | L / S | W / L | Expired | Win rate | Expectancy | SE |
|---|---|---|---|---|---|---|---|
| G0 default (58, crypto bands) | 1 | 1 / 0 | 0 / 0 | 1 | — | 0.000R | — |
| G1 gold-scaled (58) | 3 | 3 / 0 | 0 / 0 | 3 | — | 0.000R | — |
| G2 gold-scaled, 4H only | 6 | 3 / 3 | 0 / 1 | 5 | 0.0% | −1.000R | 0.000R |
| G3 gold-scaled, daily only | 4 | 4 / 0 | 0 / 0 | 4 | — | 0.000R | — |
| G4 gold-scaled, no filters | 23 | 5 / 18 | 0 / 6 | 17 | 0.0% | −1.000R | 0.000R |
| G5 gold-scaled, score ≥ 65 | 0 | — | — | — | — | — | — |
| **G6 gold-scaled, score ≥ 52** | **101** | **90 / 11** | **28 / 27** | **46** | **50.9%** | **+0.080R** | **0.155R** |

### Segment 2 — frozen evaluation

| Variant | Fired | L / S | W / L | Expired | Win rate | Expectancy | SE |
|---|---|---|---|---|---|---|---|
| G0 default (untuned base rate) | 24 | 4 / 20 | 8 / 3 | 13 | 72.7% | +0.174R | 0.230R |
| G1 gold-scaled (58) | 28 | 8 / 20 | 8 / 7 | 13 | 53.3% | −0.164R | 0.210R |
| G2 gold-scaled, 4H only | 35 | 8 / 27 | 10 / 8 | 17 | 55.6% | −0.123R | 0.191R |
| G3 gold-scaled, daily only | 31 | 11 / 20 | 9 / 7 | 15 | 56.3% | −0.066R | 0.220R |
| G4 gold-scaled, no filters | 57 | 17 / 40 | 18 / 11 | 28 | 62.1% | +0.086R | 0.169R |
| G5 gold-scaled, score ≥ 65 | 18 | 5 / 13 | 4 / 6 | 8 | 40.0% | −0.369R | 0.259R |
| **G6 (frozen winner)** | **113** | **54 / 59** | **43 / 26** | **44** | **62.3%** | **+0.086R** | **0.106R** |

Full window, for reference: G6 fired 214 (144 L / 70 S), 57.3% win
rate, +0.084R (SE 0.090R). Every other variant is negative or
single-digit-sample noise over the full window.

### Why the gate fails

1. **The winner's edge is inside its own error bar.** G6 segment 2:
   +0.086R vs SE ±0.106R. The ship rule — set before the run, the
   same rule that rejected nominal winners in rounds 2 and 5 —
   requires expectancy greater than one standard error above zero.
   0.086 < 0.106. It also wasn't convincing in segment 1
   (+0.080R vs SE 0.155R).
2. **At the crypto engine's own threshold, the engine is nearly
   mute on gold.** Scores are sums of 5/10/15/20/25-point blocks, so
   "58" effectively means 60; gold's calmer 1H series rarely
   assembles that (segment 1: G0 fired once, G1 three times — and
   every one of those trades expired unresolved inside 48h). Only
   lowering the threshold to 52 produced a tradeable signal flow,
   and that flow's edge is the noise-level one above.
3. **The untuned default (G0) base rate is noise too:** segment 2
   +0.174R rests on 11 resolved trades (SE 0.230R) and only 24
   fired — below the 50-signal floor on its own.

## End state

- Production files: **byte-identical to main 76dcced0** (verified:
  `git diff 76dcced0` over the tree is empty). No `/gold` page, no
  `/api/gold/signals` route, no engine file in the repo.
- The only commit on `feature/gold-engine` is this report.
- Preserved for reproducibility in `~/workspace/.amg-bt/`:
  `backtest-gold.ts`, `tsconfig.backtest-gold.json`,
  `gold-results.json`, `data-gold/PAXGUSDT.json` (the dataset), and
  `goldEngineCore.ts` — the engine's exact bytes. To re-run the
  gate: restore `goldEngineCore.ts` to
  `src/lib/signals/goldEngineCore.ts`, re-add the one optional
  `dailyCloses?: number[]` field to `MarketData` in
  `src/lib/signals/types.ts`, then compile and run the harness.

**Bottom line for the user:** a gold engine was built on real PAXG
(gold) prices and tested over 3.3 years of hourly data. Its best
configuration wins about 6 times in 10, but the profit per trade is
so small relative to its variance that it cannot be distinguished
from luck under the same standard that validated the crypto engine.
Shipping it would mean putting an unproven engine next to a proven
one. If gold is revisited, the honest next lever is a longer
segment-2 (more resolved trades to shrink the error bar) or a
genuinely different gold-specific entry model — not a lower bar.

---

## SHIPPED ON USER DECISION (2026-11-22)

The gate verdict above stands as the test record. After being told
the result plainly, the user ordered: **"Phir bhi gold page laga
do"** ("put the gold page up anyway"). The gold engine therefore
ships as the USER'S decision, overriding the ship gate — with
honest page copy and no strength or accuracy claims, as set out
below. This section was appended when the work was done; nothing
in the gate record above was altered.

### Configuration shipped — G6, exactly as backtested

`GOLD_PRODUCTION_PARAMS` in `src/lib/signals/goldEngineCore.ts` is
set to the gate's frozen winner G6:

- `mtfConfirm: true` (4H EMA50 vs EMA200 must agree)
- `dailyRegime: true` (no longs below / shorts above the daily EMA200)
- `minScore: 52`
- `counterTrendMinScore: 70`
- `pullbackMinPct: 0.1`, `pullbackMaxPct: 0.5` (gold-scaled)
- `minTpDistancePct: 0.2` (gold-scaled)

The shipped `goldEngineCore.ts` is byte-identical to the tested
bytes preserved at `~/workspace/.amg-bt/goldEngineCore.ts` except
for that constant and its doc comment (verified by diff). No
parameter was changed after the backtest: what ships is what was
tested.

### Files changed

- `src/lib/signals/goldEngineCore.ts` — NEW. The tested engine,
  restored from the preserved bytes, G6 as production default.
- `src/lib/signals/goldSignals.ts` — NEW. Server-side generation:
  live PAXG/USDT 1H candles (freshness-gated) + 250 4H closes +
  250 daily closes from data-api.binance.vision via BinanceAPI;
  builds the Signal in the shared shape (pair shown as
  "XAU/USD (PAXG)", entryPrice, stopLoss, takeProfit1/2/3,
  confidence, ACTIVE status, LONG/SHORT direction, 48h expiry,
  `isGold` marker). Throws when live data is unavailable/stale —
  no simulated prices anywhere in the path.
- `src/lib/signals/types.ts` — `MarketData.dailyCloses?: number[]`
  re-added (the one field the gate record said to restore).
- `src/app/api/gold/signals/route.ts` — NEW. 60s cache mirroring
  /api/signals; honest 502 on data failure; payload
  `{ signals, price, issued, generatedAt, cached }`.
- `src/app/gold/page.tsx` — NEW. Same professional design as the
  other signal pages (header pill, StatsCards, scan panel, history
  table), SignalList/SignalCard with `showCharts` — per-signal 1H
  chart with Entry / Stop Loss / TP1 / TP2 / TP3 lines. Monitoring
  uses the shared SignalManager 'gold' store + SignalGenerator
  .updateSignal rules (win only at full TP, EXPIRED separate);
  prices polled for the real instrument pair PAXG/USDT.
- `src/app/api/candles/route.ts` — the display pair
  'XAU/USD (PAXG)' is accepted and mapped to PAXG/USDT for the
  candle fetch, so gold signal charts load real candles.
- `src/lib/services/signalManager.ts` — 'gold' added as a store
  type, mirroring the scalpingv2 integration (ActiveSignals,
  get/set/add/update/complete, clearExpired, clearAll,
  getSignalType via the `isGold` marker, completed records carry
  `isGold`).
- `src/lib/services/signalCatchup.ts` — 'gold' added to the
  catch-up store list (best-effort, as for the other stores).
- `src/components/layout/Navbar.tsx` — "Gold 🥇" link added
  between On-Chain and Completed Signals.

### Verification (local, production build)

- `npx tsc --noEmit`: clean.
- `npm run build`: passes; `/gold` and `/api/gold/signals`
  registered; all pre-existing routes unchanged.
- Smoke (local `next start`):
  - `/gold` → 200.
  - `/api/gold/signals` → 200 with the **honest empty state**:
    `{"signals":[],"price":3546.63,"issued":false,...}` — the
    engine ran on the live PAXG price ($3,546.63, consistent with
    the day's earlier $3,543.60 probe) and issued no signal on
    that pass. Server log shows NO filter-neutral warnings, i.e.
    both the 250 4H closes and the 250 daily closes loaded, so
    the evaluation ran with the full G6 filter context supplied.
  - `/api/candles?pair=XAU/USD (PAXG)&interval=1h` → 200 with real
    PAXG candles (OHLC ≈ $3,528–$3,557); `pair=PAXG/USDT` → 200.
  - Regression: /dashboard, /scalping, /scalping-v2, /on-chain,
    /money-rotation, /completed all 200; /api/signals 200.
  - Not verified: a live signal payload end-to-end (the engine
    issued none during the smoke window — market-dependent, same
    limitation as the earlier UI rounds). The Signal conversion
    is type-checked and mirrors the scalping-v2 converter.

### Exact honest wording on the /gold page

Intro paragraph (verbatim from the page):

> "Generated server-side from live Binance candles (refreshed
> every minute) - the same signal for every visitor. Prices come
> from PAXG, Paxos-issued tokenised gold (1 PAXG = 1 troy ounce of
> gold) traded on Binance spot: Binance does not list a direct
> XAU/USD pair, so PAXG is the real gold price this engine runs
> on, and every signal card names it. The engine scores the hourly
> chart and issues at most one signal at a time, only when its
> score reaches 52 and both the 4H trend and the daily trend
> (price vs the daily EMA200) agree with the direction. TP1, TP2
> and TP3 are milestones only - a trade counts as completed only
> when the full take profit is reached before the stop loss;
> setups expire after 48 hours. If live data is unavailable, no
> signals are shown - signals are never generated from simulated
> prices. Each signal card shows its 1H price chart with the
> entry, stop loss and TP1–TP3 levels marked on it."

Disclosure paragraph (verbatim from the page):

> "Please read this before using these signals: this is a new
> engine, added recently. It was backtested on PAXG hourly data
> from 2023 to 2026 before being added. Its best configuration
> finished that test with a small positive result - about +0.09R
> average per completed trade on the test data - but the result
> is not statistically proven: the margin is smaller than the
> test's own margin of error, so it could still be luck. No track
> record on live markets exists yet. Treat these signals as
> unproven and size any trade accordingly."

No "strong", "accurate", or win-rate claim appears anywhere on
the page (checked against the served HTML). The backtest's 62.3%
segment-2 win rate is deliberately NOT quoted on the page; the
"+0.09R average per completed trade" figure is the report's
+0.086R expectancy, rounded, and is presented only inside the
not-proven disclosure.

---

## F+B UPGRADE (2026-11-23)

Production now runs the G6 core with the **F+B** combination from
the A-to-Z round (`~/workspace/.amg-bt/GOLD2-REPORT.md`), applied
at issuance in `src/lib/signals/goldSignals.ts` exactly as the
combination wrapped the core in the backtest harness:

- **(B) Session gate.** A signal is issued only when the signal
  bar's UTC open hour is in [07:00, 21:00) — London / New York
  hours. Implemented as a post-core veto on the last 1H candle's
  open time (`isGoldSessionBar`), mirroring harness gate B, which
  read the entry bar's open-time hour after the core decision.
- **(F) 72h expiry.** `GOLD_EXPIRY_MS` is now 72h (was 48h). The
  signal's `expiresAt` carries the lifetime into the shared
  monitoring (`SignalGenerator.updateSignal` marks EXPIRED past
  `expiresAt`); the TP1/TP2/TP3 ladder and the win-only-at-full-TP
  accounting are unchanged — the longer window only extends how
  long a trade may take to reach the full target or the stop,
  exactly the harness's resolution walk extended from 48 to 72
  hours.

Everything else is the shipped G6 configuration:
`GOLD_PRODUCTION_PARAMS` and the core's decision logic are
unchanged (comment-only edits in `goldEngineCore.ts`).

**Why F+B.** In the A-to-Z round's frozen segment 2
(2025-07-20 → 2026-11-20), F+B scored **+0.278R expectancy
(SE 0.116R), 71.7% win rate, 53 resolved** (77 fired, 38 L / 39 S)
and passed the ship gate. The round's strongest variant was the
breakout combination I+F (+0.463R) but with a 36.6% win rate —
frequent small losses by design. Presented with both, the user
asked which engine keeps profits healthy with the fewest losses;
the assistant recommended F+B (highest win rate among the gate
passes, expectancy still ~3× G6's, and the smallest change to the
shipped engine), and the user approved it ("Krdo", main chat
2026-11-23).

**Page copy.** The /gold disclosure was updated factually: the
engine trades only during London / New York hours (07:00–21:00
UTC) with a 72-hour signal lifetime, backtested over 2023–2026
PAXG data with a positive result on a small sample (53 resolved
trades in the final test segment) that is still not statistically
proven. No win-rate or expectancy figure is quoted on the page
as a claim; the PAXG instrument disclosure is unchanged.
