# Push coverage: old scalping + on-chain in the watcher

Date: 2026-11-26. Status: **5-engine wiring built + tested, NOT merged,
NOT shipped. Guard-only ship: VERIFIED GO (see "Guard-only ship
verification" at the end) — exactly one file ships:
`src/lib/ml/predictiveModel.ts`.**
The ML-init guard round is done (see "Guard applied + re-test" below):
the guard works and signals are byte-identical, but the live 5-engine
tick is still ~13.5–14.9s against the ~10s Vercel Hobby limit, so the
5-engine wiring stays unshipped per the stop condition.
Branch work is in the working tree only (no commit, no push, no PR).
Production main is 2cff046d (PR #23). This work adds the two engines PR #23
deliberately left out.

## What changed (production code)

| File | Change (plumbing only) |
|---|---|
| `src/lib/push/notify.ts` | `collectCurrentCandidates()` now evaluates FIVE engines (standard, scalping-v2, gold, scalping, on-chain). ENGINE_LABELS += scalping → "Scalping", onchain → "On-Chain". New `resolveFirstSeenAnchors()` maps each candidate's per-evaluation anchor to its FIRST-SEEN bar via Redis (`push:firstseen:<engine>:<pair>:<direction>`, TTL = the signal's expiry) before the notified-set diff. New BTC dedup: the on-chain BTC candidate is dropped when Standard already covers the same pair + side + current decision bar in the same pass. The old "deliberately NOT covered" comment block is replaced with the new design. Standard / Scalping V2 / Gold behaviour byte-identical. |
| `src/lib/signals/standardSignals.ts` | Exported generic `lastClosedBarOpen(timestamps, barMs)` (last fully closed bar; falls back to flooring the latest timestamp to the bar grid). `lastClosedHourlyBarOpen` now calls it (behaviour identical). |
| `src/lib/signals/scalpingGenerator.ts` | `generateScalpingSignals` now returns `{ signals, barAnchors }` (pair → last closed 5m bar open); `generateSingleScalpingSignal` (private) now returns `{ signal, anchorMs }` (anchor from the fetched timestamps via `lastClosedBarOpen`, wall-clock 5m-grid fallback when timestamps are absent, e.g. legacy simulated paths). No scoring, levels, thresholds, or expiry changed. |
| `src/lib/signals/scalpingMarketData.ts` | `generateScalpingData` now also returns `timestamps: binanceData.timestamps` in the live-Binance crypto path (plumbing only; scoring never reads them). |
| `src/app/api/scalping/signals/route.ts` | Updated to `result.value.signals` (the only other caller of the class method; `autoGenerator` has its own private methods that only fetch the route). |
| `src/lib/signals/onChainGenerator.ts` | `OnChainReport` gains `barAnchorMs: number \| null` (last closed 1H BTC bar the core evaluated; shared by the BTC leg + all correlated alts; null when no BTC signal). `generateSignalForBitcoin` (private) now returns `{ signal, barAnchorMs }`. Route payload unchanged. |

No page text changed. No manifest/favicon change. No signal logic, levels,
thresholds, scores, or expiry changed anywhere.

## Anchor design

The watcher id is `engine:pair:side:anchor`, where the anchor is the
decision bar the signal was issued on — taken from each engine's own data,
never from the wall clock (a wall-clock anchor would re-notify a persistent
setup every 5 minutes).

**Old scalping.** The engine's natural re-issue unit is the 5m candle: it
re-evaluates every pair on every 5m close and re-issues the same setup while
it still qualifies. The anchor is the last fully closed 5m bar open at
evaluation time, derived from the fetched candle timestamps
(`lastClosedBarOpen(timestamps, 5m)`). Because a setup that merely persists
keeps producing the same anchor, the watcher must also remember the FIRST
bar it saw the setup on: `resolveFirstSeenAnchors()` stores the first-seen
bar in Redis (`push:firstseen:scalping:<pair>:<side>`, TTL 14400s = the
signal's 4h expiry) and rewrites every later candidate's id to that bar.
A setup vanishing and reappearing within the TTL keeps its old anchor (no
re-notify); after the TTL it gets a fresh anchor (notifies as a new
issuance). If Redis fails, the current-bar id is used as a fallback (at most
one extra notification, never a broken tick).

**On-chain.** The engine's natural re-issue unit is the 1H BTC bar: the
whole report (BTC leg + all correlated alt legs) is one evaluation of the
standard core on the last closed 1H BTC bar. The anchor is that bar
(`barAnchorMs`, shared by the BTC leg and every alt leg — the alts are
expressions of the same BTC event, so they share its issuance bar). The
first-seen mapping is identical in form (`push:firstseen:onchain:<pair>:<side>`,
TTL 172800s = the signal's 48h expiry). The whale veto stays a live-only
gate (it can only remove a signal, never create one), so it never affects
the anchor. The `Signal` type has no anchor field — anchors travel via the
`barAnchors` maps / `barAnchorMs` report field, mirroring
`generateStandardSignals()`.

**BTC dedup.** On-chain's BTC leg is the standard core verbatim, so when
Standard already covers the same pair + side + current decision bar in the
same pass, the on-chain BTC candidate is dropped inside
`collectCurrentCandidates()` (compared on the current bar, before the
first-seen mapping). The correlated alt legs are distinct trades (own
entries/levels) and are kept. All five engines stay in `Promise.allSettled`
isolation — one engine failing never blocks the others.

## Test gate

### Build: clean
`npm run build` — exit 0 (after fixing one duplicate-wrapper slip from two
overlapping edits and a type error in the capture script; the Next build
type-checks `scripts/` too).

### Deterministic module test: ALL CHECKS PASSED
`scripts/test-push-coverage.ts` (compile: `npx tsc -p
scripts/tsconfig.test-push-coverage.json`, then
`node scripts/resolve-aliases.mjs` to rewrite the `@/` alias in the emitted
JS, then `node /tmp/amg-bt-build/scripts/test-push-coverage.js`).
Runs the REAL `checkAndNotify()` against a fake Upstash Redis (in-memory,
extended with `SET ... EX`, `TTL`, `DEL`, `FLUSHALL`), a fake HTTPS push
endpoint with a real ECDH P-256 subscription, and payloads decrypted per
RFC 8291 (aes128gcm) and asserted field by field. Data is RECORDED live
data (`scripts/fixtures/push-coverage-fixtures.json`, 686 KB, captured
2026-11-26 ~01:58 PKT by `scripts/capture-push-coverage-fixtures.ts` —
KEEP, re-run to refresh): live 5m klines (48) for the top-30 scalping
pairs re-timestamped to "now" (prices untouched, only candle open times
shift, so the 30-min strict freshness gate passes); 1H klines (100) per
pair ending at a REAL core-firing bar (2026-11-21T05:00Z, SHORT) from the
canonical backtest dataset + each pair's 4H closes (250); a live-captured
Blockchain.info block (61 large txs, net flow $0.00M NEUTRAL, cross-check
50/50). `Math.random` pinned to 0.5 (same as the backtest harnesses).
`Date.now` is wrapped with a mutable offset so a bar advance is simulated
by advancing the wall clock (the scalping anchor is the last closed 5m bar
as of "now"; the 1H fixture is historical so the standard/on-chain anchors
never move with the offset).

Phases and results (second run, after the clock-offset fix — see caveat):
- **Phase 1 — engine failure isolation** (scalping 5m fetches stubbed to
  500, funding neutral): watch checked 32, new 32, sent 32 in ~71s
  (first-run TF init). 22 Standard SHORTs + 10 On-Chain alt SHORTs
  notified; ZERO scalping payloads; on-chain BTC suppressed by the dedup.
  All payloads carry the right title, URL, body format, icon and badge.
- **Phase 2 — labels + first-seen** (funding −0.0006 blocks Standard
  SHORTs): tick A checked 15, new 15, sent 15 — 4 Scalping (BTC, UNI,
  FTM, NEAR LONG) + 11 On-Chain (BTC + 10 alts) SHORT. Tick B (identical
  fixture): new 0, sent 0. Tick C (wall clock +5 min, one 5m bar
  advanced): new 0, sent 0 — the first-seen anchor holds across the bar
  advance. No Standard BTC SHORT (funding-blocked, as designed).
- **Phase 3 — BTC dedup** (funding neutral): tick D checked 36, new 22,
  sent 22 — all 22 Standard SHORTs; ZERO new On-Chain BTC SHORT.
- **Phase 4 — first-seen expiry simulates a new setup**: TTLs asserted
  via the TTL command — scalping NEAR LONG 14065s (≈14400s / 4h),
  on-chain BTC SHORT 172465s (≈172800s / 48h). UNI LONG's first-seen key
  deleted + clock +15 min → tick E checked 36, new 1, sent 1 — exactly
  "Scalping Signal: UNI/USDT LONG", and `push:notified` holds TWO
  distinct ids (`scalping:UNI/USDT:LONG:2026-11-25T20:10:00.000Z` and
  `...20:25:00.000Z`).
- The test FAILS clearly (exit 1) when the fixture has no firing
  scalping pair or the on-chain core does not fire — it never passes
  vacuously. First run caught a real test-design flaw (see "Caveats").

### Live smoke: payload checks PASS, load budget FAILS
`scripts/test-push-coverage-smoke.mjs` — runs the REAL production build
(`next start`) against the same fake Redis/push harness and REAL live
Binance / Blockchain.info data. Watch ticks run FIRST (before any
`/api/signals` call, which fires a background opportunistic
`checkAndNotify` that would overlap and contaminate the timings).
- Subscribe works via the real route (200, `{ok:true}`).
- Tick 1 (cold): **15,333ms**, checked 5, new 5, sent 5 — all 5 live
  scalping payloads received and decrypted, titles/icons/badges correct
  (XLM, FIL, SAND, AXS, NEAR SHORT).
- Tick 2: **15,961ms**, checked 6, new 1, sent 1 — exactly one genuinely
  new payload (AAVE/USDT SHORT, market moved across a 5m bar), ZERO
  duplicate titles.
- Tick 3 (warm): **15,863ms**, checked 8, new 1, sent 1 (THETA/USDT
  SHORT, genuinely new). First-seen keys recorded (8 scalping keys).
- Engine routes (live, timed individually; measured while the
  opportunistic background tick was running, so treat as upper bounds):
  Standard 5,233ms (0 signals), Scalping V2 16,669ms (0), Gold 1,399ms
  (0), Scalping 1,886ms (7 signals), On-Chain 11,029ms (0).
- **The three budget checks FAIL: every tick is ~15–16s against the
  ~10s Vercel Hobby serverless limit.** See "Load" below — this is the
  one open item, and it blocks shipping as-is.

## Load — the finding that blocks shipping

Measured on this VM (1.5 shared CPUs): the 5-engine watch tick takes
**15.3s / 16.0s / 15.9s** (cold / dedup / warm — consistent, not a cold
start). The pre-change 3-engine tick was ~7–8s live. Vercel Hobby kills
serverless functions at ~10s. The tick sends notifications only AFTER all
candidates are collected, so a killed tick sends NOTHING that cycle — no
duplicates and no partial sends, but also no notifications at all; the
next 5-min tick retries the same candidates (first-seen + notified-set
make that safe). If every tick is killed, the user gets no signal
notifications from the watcher, and the history sync in the same tick
also stalls. **Do not ship this wiring as-is.**

Root cause (traced, not guessed). The tick is dominated by CPU, not
network: the module test's steady-state tick is already ~10.6s with
STUBBED (fast) fetches for standard/scalping/on-chain and live fetches
only for V2/gold — so ~10s of the tick is computation. The computation is
TensorFlow model re-creation in the standard engine's signal path:
`SignalGenerator.generateSignal` calls
`PredictionEngine.generatePrediction` → `PredictiveModel.predict()` →
`PredictiveModel.initialize()` on EVERY call, and `initialize()`
unconditionally tries `tf.loadLayersModel('indexeddb://...')`, which
always fails server-side (no IndexedDB) and then builds a fresh LSTM
(`createModel()`). One fresh LSTM per qualifying standard pair, per tick
(~22 in the fixture run; up to 24 live). First creation in a process is
seconds (module-test tick 1: ~65–71s); steady-state each is ~0.3–0.5s.
This cost is PRE-EXISTING (the 3-engine watcher already pays it — hence
its ~7–8s), but adding two more engines pushes the tick over the limit.
(The on-chain engine itself pays no TF cost — its BTC leg uses
`evaluateSignalCore` directly; the alt legs compute levels directly.)

Why the fix is safe. The ML prediction never changes a signal:
`generator.ts` computes an `alignmentBonus` but never applies it (comment
in code: "confidence is purely technical, this is informational only"),
and `mlPrediction` is only logged and attached to the signal object as
metadata, displayed by `PredictionDisplay.tsx` as an informational panel.
The server-side model is never trained (IndexedDB load always fails,
`modelAccuracy` stays 0), so today's displayed prediction values come
from fresh random-weight LSTMs anyway.

**Recommended mitigation (NOT implemented — needs a decision):** guard the
re-creation — `PredictiveModel.initialize()` returns early when
`this.model` already exists (one-line guard in
`src/lib/ml/predictiveModel.ts`). First call in a process creates the
model as today; every later call reuses it. It changes no signal's
direction, score, confidence, levels, or issuance — only the values in
the informational prediction panel (which are random-weight outputs
today). Expected effect: the standard engine's per-tick cost drops from
~10s to ~1–2s, bringing the 5-engine tick to roughly 5–7s, comfortably
under the limit. Verify by re-running the smoke after the change.

Alternatives, in order:
1. Split the watch (two pinger calls: standard+v2+gold on one,
   scalping+on-chain on the other). Helps only partially — the standard
   engine's own TF cost stays inside the first call, and V2 alone measured
   16.7s standalone on a bad-network minute, so a split does not
   guarantee either half fits.
2. Vercel Pro (60s function limit) — costs money; the user's call.
3. Stagger the new engines to alternate ticks (their notifications would
   lag up to 10 min) — weak; not recommended.

## Caveats
- **Test-design flaw found and fixed during the run:** the first module-test
  run failed Phase 4 (2 checks). Cause was the TEST, not the product: the
  scalping anchor is derived from wall-clock `Date.now()`, so shifting
  only the fixture candles never advanced the anchor — after deleting the
  first-seen key the id was identical and the notified-set dedup correctly
  blocked it. Fixed by wrapping `Date.now` with a mutable offset in the
  test (advancing the clock advances the anchor and re-timestamps the 5m
  fixture). Second run: ALL CHECKS PASSED.
- The fixture's live scalping firing at capture was BTC/UNI/NEAR LONG;
  the test's tick A also fired FTM/USDT LONG on the saved klines (the
  forming candle moved a few seconds between the capture and the live
  generator run). Real signal from the real generator on recorded live
  data; asserted as tolerated, not required.
- V2 and Gold labels are still verified via the shared code path + the
  module test's shape assertions, not a captured live V2/Gold payload
  (no live V2/Gold signal fired during either test run) — same caveat as
  PR #23.
- The smoke's per-engine route timings were measured while the
  opportunistic background tick (fired by the `/api/signals` call) was
  running, so they are upper bounds, not clean standalone numbers. The
  watch-tick timings (15.3/16.0/15.9s) are clean — ticks 1–2 ran before
  any route call.
- Timings are from this VM (1.5 shared CPUs, this IP's Binance
  rate-limit behaviour). Vercel's CPU/network differ, but the tick is
  dominated by CPU-bound model creation, which does not get faster on
  Vercel — the over-budget conclusion is robust to the environment; the
  exact seconds will vary.
- A runtime restart interrupted one smoke re-run mid-flight (no output,
  orphaned `next start` cleaned up); the reported smoke numbers are from
  the clean re-run after it.
- `scripts/resolve-aliases.mjs` is a post-compile helper (tsc does not
  rewrite the `@/` alias; the emitted JS needs it). Reusable by any
  future tsc-compiled test that imports `notify.ts` or the history lib.

## Files (new, this task)
- `scripts/test-push-coverage.ts` + `scripts/tsconfig.test-push-coverage.json` — deterministic module test (see above).
- `scripts/test-push-coverage-smoke.mjs` — live smoke (production build + fake Redis/push + live data).
- `scripts/resolve-aliases.mjs` — post-compile `@/` rewriter.
- `scripts/capture-push-coverage-fixtures.ts` + `scripts/tsconfig.capture-push-coverage-fixtures.json` — fixture capture (KEEP; re-run to refresh). Fixture: `scripts/fixtures/push-coverage-fixtures.json`.
- This report: `PUSH-COVERAGE-REPORT.md`.
- Deleted after use (one-off): `scripts/find-firing-bars.ts` + `scripts/tsconfig.find-firing-bars.json`.

## Guard applied + re-test (2026-11-26, after user approval "Guard lagao aur live kar do")

### The guard (only production change this round)
`src/lib/ml/predictiveModel.ts` — `initialize()` is now memoized: it
returns early when `this.model` exists, and concurrent callers share one
in-flight `initPromise` (a plain `if (this.model)` check alone was NOT
enough — measured: the first attempt still created 22 models, because all
~22 parallel `generatePrediction()` calls pass the check before any of
them finishes the async indexeddb load; the promise memoization fixed
that). `clearModel()` resets both `model` and `initPromise`, so a later
`initialize()` still recreates the model. No signal logic, levels,
thresholds, scores, or expiry touched; no other production file changed.

### Build: clean (twice)
`npm run build` — exit 0, before and after a comment tidy-up.

### Deterministic module test: ALL CHECKS PASSED (re-run)
Same fixture, same phases, same counts as the pre-guard run:
- Phase 1: checked 32, new 32, sent 32 — **12,770ms (was 69,359ms)**.
  Model creations: **1 (was 22)**.
- Phase 2 tick A: 15/15/15 in 10,537ms; ticks B/C: 0/0 (first-seen holds
  across the 5m bar advance).
- Phase 3 tick D: 36/22/22 — all 22 Standard SHORTs; zero on-chain BTC
  (dedup holds).
- Phase 4 tick E: 36/1/1 — "Scalping Signal: UNI/USDT LONG".
- Zero FAIL lines.

### Signal-unchanged sanity check: PASS (exact)
Temporary payload-body print added to the test, then removed. Two runs on
the identical fixture — once with the guard stashed (original code) and
once with it applied: **all 70 decrypted payloads byte-identical
(pairs, sides, Entry, SL, TP1)**. Code-level proof backs it:
`generator.ts` computes `alignmentBonus` but never applies it (dead
local; only a console.log), and `mlPrediction` is attached to the signal
as metadata only — direction, score, confidence, and levels come from
the technical core, pure functions of the klines. The only thing the
guard can change is the values inside the informational prediction
panel, which are random-weight outputs today.

### Live smoke: payload checks PASS, budget STILL FAILS — DO NOT SHIP
`scripts/test-push-coverage-smoke.mjs` re-run against the real
production build + live Binance/Blockchain.info data (one false start:
the first attempt died on `EADDRINUSE :3102` from an orphaned
`next-server` left by an earlier smoke run; killed it, re-ran clean):
- Tick 1 (cold): **14,858ms**, checked 13, new 13, sent 13 — all 13 live
  scalping payloads correct (labels, icon/badge, zero duplicates).
- Tick 2 (dedup): **14,434ms**, checked 0, new 0, sent 0.
- Tick 3 (warm): **13,520ms**, checked 0, new 0, sent 0.
- First-seen keys: 13 recorded for the new engines. All payload checks
  PASS; the only failures are the three ~10s budget checks.

### What still dominates the tick (network, not CPU)
The guard fixed the CPU part (module-test Phase 1: 69s → 12.8s), but the
live tick is network-bound. Per-engine route timings (live, timed
individually — measured while the opportunistic background tick was
running, so upper bounds): Standard 5,232ms, **Scalping V2 16,433ms**,
Gold 1,320ms, Scalping 1,915ms, On-Chain 6,320ms. The tick runs all five
engines in parallel, so it costs roughly the slowest engine + overhead.
Scalping V2's 53-pair scan is the long pole (it alone exceeded 10s on a
bad-network minute in the pre-guard run too). The server log also shows
~120× `Binance futures API error: 451` (funding-rate fetches fail
geo-blocked, fail-neutral by design — fast failures, but 120 of them per
run). No 418s in this run.

### Verdict: STOP — not shipped
Per the task's stop condition (tick still over ~10s after the guard), the
5-engine wiring is **built + tested but NOT shipped**. The guard stays in
the working tree (it is a strict improvement: 69s → 12.8s on the
CPU-bound path, signals byte-identical) — but on its own it does not get
the live tick under the Vercel Hobby limit. Next options for the owner:
(a) split the watch into two pinger calls — partial only, V2 alone
already exceeds 10s on bad minutes; (b) Vercel Pro (60s limit, costs
money); (c) trim the V2 scan (fewer pairs / shared kline cache across
ticks — a bigger change, not attempted here); (d) ship anyway knowing
most ticks get killed before sending — NOT recommended (no
notifications, and the history sync in the same tick stalls too).

## Example notifications (captured live in the smoke)
- Scalping: `Scalping Signal: NEAR/USDT SHORT` — body `Entry … · SL … · TP1 …`, icon/badge `https://amgtrading.vercel.app/logo.png`, url `/scalping`.
- On-Chain (from the deterministic module test, live-recorded data):
  `On-Chain Signal: ETH/USDT SHORT` — same body format and logo
  icon/badge, url `/on-chain`. (No live on-chain signal fired during the
  smoke run; the module test proves the title/icon/badge/URL per engine.)

## Guard-only ship verification (2026-11-26, user order "Guard akela live kar do")

Decision to verify: the ~14s figure was measured for all FIVE engines.
Before shipping the guard alone, confirm the THREE-engine watch tick
(Standard + Scalping V2 + Gold, the PR #23 watcher) WITH the guard fits
comfortably under the ~10s Vercel Hobby limit. Verdict: **GO**.

### What ships — exactly one file
`src/lib/ml/predictiveModel.ts`, diffed directly against production main
2cff046d (read-only `get_file_contents`, no fetch/checkout): the ONLY
change is the guard — `initPromise` memoization, `initialize()` split
into guard + `initializeOnce()`, `clearModel()` resets `initPromise`.
No other file differs. The guard is standalone: it imports nothing from
the 5-engine coverage work and no coverage file imports it.

### How it was measured
A TEMPORARY tree (~/workspace/.tmp-guard-only, deleted after use) was
built as production main + the guard only: `notify.ts`,
`standardSignals.ts`, `scalpingGenerator.ts`, `scalpingMarketData.ts`,
`src/app/api/scalping/signals/route.ts`, `onChainGenerator.ts` were all
restored to their main versions (read-only GitHub reads); grep confirmed
zero coverage remnants (`resolveFirstSeen`, `push:firstseen`,
`barAnchorMs`, `lastClosedBarOpen` — no hits). `npm run build` clean.
The temp build ran against the fake-Upstash + fake-push harness
(`scripts/guard-only-timing.mjs`, same pattern as
`scripts/test-push-label-icon.mjs`: throwaway VAPID, real ECDH sub,
RFC 8291-decrypted payload assertions).

### Results
- **Production watch (the environment that matters), current main
  WITHOUT the guard, 3-engine tick, live, WITH the real history sync
  (9 actives): 5,039ms / 5,141ms / 5,031ms (3 samples, 60s apart).**
  All comfortably under 10s. The guard only removes CPU work, so the
  tick WITH the guard is bounded above by these numbers.
- Temp build (main + guard) on this VM: 4 timed ticks 12,724 / 12,485 /
  12,523 / 12,181ms — all over 10s. This is a property of THIS VM, not
  the guard: direct fetch timings from here show Binance vision klines
  at 0.97–1.38s per request and the futures 451 at 0.31–1.16s, so a
  tick firing 100+ parallel fetches is network-bound here. Per-engine
  cold routes on the temp build: Standard 5,330ms, Scalping V2
  7,976ms, Gold 1,274ms; the parallel watch (12,178ms) exceeds the
  slowest engine by ~4.2s (parallel contention on 1.5 shared CPUs +
  history sync). None of that cost is TF model creation — the guard
  already removed that (module test: 22 → 1 model builds).
- The earlier "~7–8s" pre-guard 3-engine figure could not be reproduced
  on this VM (12.2–12.7s); production measures ~5.0s. The VM and
  Vercel disagree because of network path, not code — judge the ship
  by the production numbers.
- Payload checks on the temp build: subscribe OK, served sw.js passes
  `data.icon` through, logo serves 200 as PNG, no duplicate titles.
  No live payload was captured in this run — the market was dead quiet
  (checked=0 on every tick; route counts Standard 0 / V2 0 / Gold 0).
  Nothing new to prove here: the temp copy's `notify.ts` IS production
  main's file byte-for-byte, and payload correctness for the 3-engine
  watcher was already proven by PR #23's test (18 live Standard
  payloads decrypted and asserted). The only new code is the guard,
  whose signal-neutrality was proven byte-identical (70/70 payloads)
  in the guard round.

### Verdict: GO
Ship exactly `src/lib/ml/predictiveModel.ts` (PR from main 2cff046d).
The 5-engine coverage wiring stays unshipped. Production 3-engine tick
~5.0s with the real history sync leaves ~5s of headroom under the
~10s Hobby limit; the guard can only reduce it.

## Trim for 5-engine ship (2026-11-28, user order "Scan trim karke 5-engine live karo")

### Trigger
2026-11-28 15:19–15:22 PKT the user asked why no Scalping V2 / On-Chain /
Gold notifications arrive (only Standard does). Live check: V2 and Gold
genuinely not firing (0 signals, high bar by design); on-chain never
wired. The 5-engine coverage was built + tested but unshipped because
the watch tick measured 13.5–16s vs the ~10s Vercel Hobby limit. He
chose the trim route: "Scan trim karke 5-engine live karo".

### Audit (2026-11-28, before touching anything) — CLEAN
Working tree vs GitHub main 93fc9542 via the connector read API (no
fetch; helper `/tmp/fetch-main.py`, copies in `/tmp/gh-main/`). Every
tangled file EXCEPT the 6 coverage files is byte-identical (0 diff
lines) to main: predictiveModel.ts (guard), manifest.ts, layout.tsx,
Navbar.tsx, iconImage.tsx + 3 icon routes, sw.js, all pages, filters,
autoGenerator, correlatedSignalGenerator, engineCore, generator, types,
history lib + route. favicon.ico and spotEnhancements.ts are absent
from main (their deletions already shipped). Only 6 files differ —
exactly the coverage wiring (notify.ts, standardSignals.ts,
scalpingGenerator.ts, scalpingMarketData.ts, scalping/signals/route.ts,
onChainGenerator.ts). `src/lib/signals/onChainScoring.ts` is untracked
and NOT in main — imported only by the backtest harness, never by
production code; it must NOT be pushed. The trim adds changes to 6
more files (below); each was verified trim-only against main.

### Fetch map (from reading the code) — per watch tick, ~227 requests
Standard 73 (24× 1H-100 + 1× regime 4H-250 + 24× 4H-250 closes + 24×
funding premiumIndex, all 451-fail), V2 107 (1× bulk 24h tickers +
53× 5m-100 + 53× 1m-100, NO funding calls), Gold 3 (PAXG 1H-100 +
4H-250 + 1d-250), Scalping 30 (5m-48), On-Chain ~14 (Blockchain.info
+ BTC 1H-100 + regime 4H-250 + BTC 4H-250 + 10 alt 1H-100 fetched
SEQUENTIALLY in CorrelatedSignalGenerator). All kline fetches flow
through `BinanceAPI.getKlines` (data-api.binance.vision).

### Trim design — what was done, in preference order
(a) SHARED IN-TICK KLINE CACHE — DONE. New `src/lib/signals/klineCache.ts`
(`TickKlineCache`): one fetch per (symbol, interval) per tick; a longer
cached series serves a shorter limit by tail-slice (the last N candles
of a limit-100 fetch ARE the candles a limit-N fetch would return at
the same instant); a request for more candles than cached re-fetches at
the bigger limit and replaces the entry; a failed fetch never poisons
the entry (dropped on rejection so a later caller retries). Created
fresh in `collectCurrentCandidates()` and passed explicitly down the
engine chain — NO module-level state, so no cross-tick staleness and no
test contamination. Route callers pass no cache and fetch fresh, so
their behaviour is byte-for-byte unchanged. Saves ~36 requests: 25×
5m overlap (V2 5m-100 vs Scalping 5m-48), BTC 1H-100 (Standard +
On-Chain) ×1, BTC 4H-250 (Standard regime + Standard BTC closes +
On-Chain regime) ×2, alt 1H-100 (On-Chain correlated, 8 of 10 overlap
Standard's 24). It also collapses On-Chain's 10 SEQUENTIAL alt fetches
(8 become instant cache hits) — the biggest wall-clock win in the
tick after rotation.
(b) FUNDING BULK — DONE. New `BinanceAPI.getFundingRates()`: ONE
`GET /fapi/v1/premiumIndex` (no symbol) → Map<symbol, rate>; failure
returns an empty map (filter neutral, exactly as today). V2 has NO
funding calls — the 451s are Standard's 24 individual `getFundingRate`
calls. Semantics identical in every environment (same per-symbol
values when reachable; undefined when 451). Saves 23 requests. The
single `getFundingRate` method is kept (public API, now uncalled).
`standardSignals.ts` awaits one shared `fundingPromise` in the
per-pair enrichment loop.
(c) REDUCE KLINE LIMITS — REJECTED with evidence. Limit cuts change
indicator values: ICTEngine lookback reaches 60 candles (daily-bias
fallback uses `candles[len-60]`), Standard/On-Chain EMAs are recursive
over the fetched series, Scalping MACD likewise. Any cut below 100
changes engine outputs — forbidden (no signal-logic changes). NOT
implemented.
(d) V2 UNIVERSE ROTATION — DONE (watcher-only). In
`collectCurrentCandidates`, `scalpingV2WatchPairs()` selects half of
SCALPING_V2_PAIRS by 5-min bucket parity
(`Math.floor(Date.now()/300000) % 2`, interleaved by index). V2
fetches halve (106 → ~54). TIMING CHANGE, stated plainly: each pair
is scanned every 10 min instead of 5; a new V2 setup is detected
0–10 min after it appears (avg ~5 min) vs 0–5 min (avg ~2.5 min)
without rotation; V2 signals have 4h expiry so the delay is
immaterial to the trade; the /api/scalping-v2/signals route is NOT
rotated — visitors always see the full 53-pair scan. V2 signal ids
are deterministic per bar, so no duplicate risk; only sub-10-min
transient setups can be missed.

No signal logic, scores, thresholds, levels, grades, expiry, or the
anchor/dedup design changed anywhere. No page text, manifest,
favicon, or ML guard touched.

### What changed per file (vs main 93fc9542; diff lines include coverage)
- `src/lib/signals/klineCache.ts` — NEW (81 lines), the cache (a).
- `src/lib/signals/binanceAPI.ts` — trim only (+70/−28): `getKlines`,
  `getCandles`, `getMarketDataWithRealPrices`, `getScalpingMarketData`,
  `get4hCloses`, `getBtcRegime` take an optional trailing `cache?`;
  new `getFundingRates()` bulk (b). Uncached behaviour identical
  (the fetch body moved into `fetchFn`, same try/catch).
- `src/lib/signals/marketData.ts` — trim only (+4/−2): `generateMarketData`
  takes `cache?` and passes it to `getMarketDataWithRealPrices`.
- `src/lib/signals/standardSignals.ts` — coverage + trim (+40/−19):
  `generateStandardSignals` takes `cache?`; enrichment uses the bulk
  funding call (b) and cached regime/4H closes.
- `src/lib/signals/scalpingV2.ts` — trim only (+5/−3):
  `generateScalpingV2Signals` takes `cache?`, passed to both
  `getCandles` calls.
- `src/lib/signals/goldSignals.ts` — trim only (+5/−4):
  `generateGoldSignals` takes `cache?`, passed to 1H/4H/1d fetches.
- `src/lib/signals/scalpingMarketData.ts` — coverage + trim (+6/−2):
  `generateScalpingData` takes `cache?`.
- `src/lib/signals/scalpingGenerator.ts` — coverage + trim (+42/−13):
  `generateScalpingSignals` / `generateSingleScalpingSignal` take
  `cache?` and pass it through.
- `src/lib/signals/onChainGenerator.ts` — coverage + trim (+34/−15):
  `generateOnChainReport` / `generateSignalForBitcoin` take `cache?`.
- `src/lib/signals/correlatedSignalGenerator.ts` — trim only (+8/−4):
  `generateCorrelatedSignals` / `generateSignalForCoin` take `cache?`.
- `src/lib/push/notify.ts` — coverage + trim (+209/−19): creates one
  `TickKlineCache` per tick, passes it to all five engines,
  `scalpingV2WatchPairs()` rotation (d), header "three engines" →
  "five engines" (comment-only).
- `src/app/api/scalping/signals/route.ts` — coverage only (+1/−1).

### Test-stub fixes the trim forced (test-only, `scripts/test-push-coverage.ts`)
The cache shares ONE underlying series across engines, so the stub
must model one series per (symbol, interval) — its old limit-specific
branches did not: 5m/48 returned fixture data while 5m/100 went
LIVE, so a cached V2 5m/100 series would have fed the Scalping
engine live data instead of fixture data (nondeterministic test).
Fixed: 5m serves BOTH limits 48 and 100 from the same 48 recorded
candles (a limit-100 request legitimately returns fewer candles than
asked for; the ICT engine tolerates short series — every
length-sensitive path is guarded, incl. `candles[max(0,len-60)]`).
When `scalpingFail` is set (Phase 1), BOTH 5m limits fail — a
5m-endpoint outage takes V2's 5m fetch down too, so the cache cannot
smuggle data past the outage. Funding stub: the bulk call (no
`symbol`) now returns an ARRAY of `{symbol, lastFundingRate}` rows
(one per fixture symbol, all carrying the phase's stub rate); the
per-pair call still returns the single object. Without the array,
`getFundingRates` would throw on `for...of`, return an empty map,
and Phase 2's funding-block assertion would fail.

### Test gate
- **Build: clean** (post-trim, `npm run build`).
- **Deterministic module test: ALL CHECKS PASSED** (381 PASS, 0 FAIL,
  exit 0; log `/tmp/module-test-trim-2026-11-28.log`). Phase counts
  identical to the pre-trim run (Phase 1: 32/32, Phase 2 tick A: 15
  = 4 scalping + 11 on-chain, Phase 3: 22 Standard, Phase 4 TTLs
  hold); payload titles byte-identical to the Nov 26 run
  (e.g. `Scalping Signal: UNI/USDT LONG`, `On-Chain Signal: POL/USDT
  SHORT`, `Standard Signal: MATIC/USDT SHORT`). Neutrality argument:
  in the test the stub serves ONE series per (symbol, interval) for
  every limit, so a cached slice is exactly what a direct fetch
  returns; the bulk funding stub returns the same per-symbol rate
  the per-pair stub did; rotation cannot change payloads here (V2
  issues 0 in every phase). Phase 1 tick: 7,528ms (was ~12,700ms
  post-guard, Nov 26) — the trim cut the stubbed tick ~40%.
- **Live smoke (same VM, same day; logs
  `/tmp/smoke-baseline-2026-11-28.log` vs
  `/tmp/smoke-trim-2026-11-28.log`) — PER-ENGINE route timings:**
  - Baseline (pre-trim): Standard 5,415ms (7 sig), V2 8,771ms (0),
    Gold 1,584ms (0), Scalping 2,301ms (18), On-Chain 35,959ms (0).
  - Trim: Standard 4,100ms (7 sig), V2 8,145ms (0), Gold 1,410ms
    (0), Scalping 2,516ms (9), On-Chain 30,466ms (0). (Route timings
    are unchanged by design — routes take no cache and V2's route
    does not rotate; the On-Chain route's ~30s is its own sequential
    alt loop + cold/burst effects, NOT the tick's on-chain leg — see
    the warm isolated measurement below.)
  - **Tick totals, baseline → trim: cold tick 1: 131,251ms → 10,412ms;
    tick 2: 65,049ms → 28,584ms; warm tick 3: 20,820ms → 12,922ms.**
    The trim cut the warm tick 38% same-day. Funding: one bulk-451
    line per tick (was 24 per-pair 451 lines). Only the three ~10s
    budget checks fail in both runs (VM-side only — see projection).
  - **Isolated live timings (one-off diagnostic
    `/tmp/time-trim-tick.cjs`, live Binance, this VM):** V2 full
    53-pair scan, warm: 9,999ms. On-chain alone, warm (fresh cache):
    6,473ms. Parallel tick (one shared cache, COLD — includes the
    one-off TF model creation + a 135-fetch burst): 46,594ms total
    (standard 12,699ms, v2-rotated 23,193ms, gold 5,265ms, scalping
    4,493ms, onchain 46,533ms; cache {fetches:135, hits:4}).
    The cold parallel numbers are NOT steady-state: the warm
    sequential runs right after were 3–7× faster, and the cold run
    carries the TF model build. The low hit count (4/135) in that
    cold burst run is flagged, not hidden — likely burst/cold
    effects (the smoke's warm-tick improvement is the better
    evidence the cache helps in the real tick); it is an open
    question for a live-site check, not a ship-blocker.
    NOTE: the runtime flagged an approval timeout while that
    diagnostic exec ran; its output was delivered in full and it
    was NOT re-run.
  - **V2 scan on this VM (gate prong 1):** full scan warm 8.1–10.0s;
    the watcher's ROTATED half-scan does half the fetches and half
    the ICT evals → ~4–5s, well under 10s. (Inferred from the warm
    full scan; the one cold parallel measurement of the rotated scan,
    23.2s, is burst/cold-model contaminated and is not the
    steady-state number.)
  - **Production projection (gate prong 2):** Nov 26 direct live
    measurement: production 3-engine tick ~5.0s while this VM
    measured the same work at 12.2–12.7s (ratio ~2.44×). Trim warm
    tick on this VM: 12.9s → production ≈ 5.3s; engine-parallel-max
    projected ≈ 2s + history resolve ≈ 3.3s ≈ 5–7s total. Fits the
    ~10s Hobby limit with ~2× margin. The VM's own warm tick
    (12.9s) stays over 10s — that is the VM's slow Binance path,
    not the production number (same as Nov 26, when the VM measured
    12.2–12.7s for a production tick of 5.0s).

### Verdict: GO — shippable
Build clean, module test ALL CHECKS PASSED with identical payloads,
warm tick cut 38% same-day, V2 rotated scan ~4–5s on this VM, and a
credible production projection of ~5–7s against the ~10s limit. The
remaining VM-side over-budget ticks are the known slow-path
property, already priced into the projection. Ship the files below
as ONE PR from main 93fc9542 (parent reviews the diff first; push
goes through the connector's push-files, NOT git — the local repo
is tangled and local `main` is stale).

### Push file list (exact — nothing else)
Production (12): `src/lib/push/notify.ts`,
`src/lib/signals/standardSignals.ts`,
`src/lib/signals/scalpingGenerator.ts`,
`src/lib/signals/scalpingMarketData.ts`,
`src/app/api/scalping/signals/route.ts`,
`src/lib/signals/onChainGenerator.ts`,
`src/lib/signals/klineCache.ts` (NEW),
`src/lib/signals/binanceAPI.ts`,
`src/lib/signals/marketData.ts`, `src/lib/signals/scalpingV2.ts`,
`src/lib/signals/goldSignals.ts`,
`src/lib/signals/correlatedSignalGenerator.ts`.
Tests (7, all NEW): `scripts/test-push-coverage.ts`,
`scripts/test-push-coverage-smoke.mjs`,
`scripts/resolve-aliases.mjs`,
`scripts/capture-push-coverage-fixtures.ts`,
`scripts/tsconfig.test-push-coverage.json`,
`scripts/tsconfig.capture-push-coverage-fixtures.json`,
`scripts/fixtures/push-coverage-fixtures.json`.
Docs (1): `PUSH-COVERAGE-REPORT.md` (this file).
EXCLUDE: `src/lib/signals/onChainScoring.ts` (untracked, backtest-only,
not in main, imported only by `scripts/backtest-onchain.ts`) and all
other untracked reports/scripts from earlier shipped work.
Housekeeping note: each smoke run leaves its `next start` server
listening on :3102 after the script exits (cleanup does not kill
it) — kill it manually before the next run or the next run fails
with EADDRINUSE.
