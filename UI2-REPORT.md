# AMG Trading — Per-Signal Charts Extended to All Signal Pages

Branch: `feature/charts-all-pages` (local only, not pushed)
Date: 2026-11-22
Basis: main 384df03c (PR #6 merged — SignalChart component, `showChart` /
`showCharts` opt-in props, `/api/candles` route). **Presentation only** —
no signal logic, thresholds, APIs or accounting were changed.

User's order: "Baqi pages pai bhe bannao yehi chieez" — the same
per-signal chart (Entry / SL / TP1–TP3 lines) that PR #6 added to
/dashboard, now on every remaining signal page.

---

## Pages found (codebase search for SignalList / SignalCard usage)

| Page | How it renders signals | Chart before |
|---|---|---|
| `/dashboard` | `SignalList` | ✅ already opted in (PR #6) |
| `/scalping-v2` | `SignalList` | ❌ |
| `/scalping` | `SignalList` | ❌ |
| `/on-chain` | `SignalList` | ❌ |
| `/completed` | `SignalCard` directly (4 grids, completed/history view) | ❌ |
| `/on-chain/completed` | `SignalCard` directly (history view) | ❌ |
| `/scalping/completed` | `SignalCard` directly (history view) | ❌ |
| `/money-rotation` | verified table only — **no signals by design** (PR #5) | n/a |
| `/` (home) | landing page, no signal cards (copy/links only) | n/a |

No other file in `src/` references `SignalCard`/`SignalList`.

## Pages changed (6)

For the three live `SignalList` pages — `showCharts` opt-in added
(which also switches SignalList's grid to the chart-mode
`grid-cols-1 lg:grid-cols-2`, exactly as on /dashboard), plus the same
honest subtitle sentence PR #6 added to the dashboard ("Each signal
card shows its 1H price chart with the entry, stop loss and TP1–TP3
levels marked on it."), appended to each page's existing explainer —
no existing copy removed or altered:

- `src/app/scalping-v2/page.tsx`
- `src/app/scalping/page.tsx`
- `src/app/on-chain/page.tsx`

For the three completed/history pages — they render the same `Signal`
objects via `SignalCard` directly, so each card got the `showChart`
prop, and each signal grid was widened from
`grid-cols-1 md:grid-cols-2 lg:grid-cols-3` to the chart-mode
`grid-cols-1 lg:grid-cols-2` (stats grids untouched):

- `src/app/completed/page.tsx` (4 cards, 4 grids)
- `src/app/on-chain/completed/page.tsx` (1 card, 1 grid)
- `src/app/scalping/completed/page.tsx` (1 card, 1 grid)

### TP-field coverage (per the brief's fallback rule)
All three live generators already set the partial TPs —
`scalpingGenerator.ts` (`takeProfit1: tp1`), `scalpingV2.ts`
(`takeProfit1: ict.tp1`), `onChainGenerator.ts` (`takeProfit1: tp1`) —
so live pages' signals carry TP1–TP3 and the chart draws all three
lines. Completed/history signals are the same stored `Signal` objects;
any older stored signal lacking partial TPs renders through
SignalChart's existing fallback (single TP line from `takeProfit`).
No payload, API or accounting changes were made. Note the history-view
charts show the pair's **recent** 1H candles with the completed
signal's own levels drawn on them — the same behaviour PR #6 shipped
for the dashboard component, unchanged.

## Deliberately unchanged
- `/money-rotation` — no signals exist there by design (signal layer
  removed in PR #5); its verified table is exactly as before. Its
  client chunks contain no chart code (verified below).
- `/` home page — renders no signal cards.
- `/dashboard` — already had the chart (PR #6); untouched this round.
- All engine/API files — untouched; `git diff` against 384df03c covers
  only the six page files above plus this report.

## Verification
- `npx tsc --noEmit`: **clean**.
- `npm run build`: **passes**; all pages build, `/api/candles`
  registered. Changed pages' first-load sizes rose with the chart code
  (on-chain 494 kB, scalping 500 kB, scalping-v2 493 kB, completed
  views ~200 kB), consistent with the chart component now being
  included for those routes.
- Local production run (`next start`, port 3101) smoke tests:
  - `/dashboard`, `/scalping-v2`, `/scalping`, `/on-chain`,
    `/completed`, `/scalping/completed`, `/on-chain/completed`,
    `/money-rotation` → all **200**.
  - The chart-describing sentence is present in the served HTML of
    /scalping-v2, /scalping and /on-chain.
  - `GET /api/candles?pair=BTC/USDT&interval=1h&limit=5` → **200**
    with real current candles (latest close 60,210.06, matching the
    live BTC market at smoke time).
  - Chart wiring per page: every changed page's served HTML loads the
    shared client chunks containing `createPriceLine` (the
    SignalChart code path) — verified for all six changed pages;
    /money-rotation loads no such chunk.
- **What could not be verified here (same limitation as PR #6):**
  the chart's *visual* rendering — this environment has no browser
  for screenshots, and whether a live signal is active at any given
  moment is market-dependent, so no card was guaranteed to mount a
  chart during the smoke run. The opt-in props are in the source diff
  and type-checked; the chart code path itself was verified end-to-end
  in PR #6 (fetch → setData → createPriceLine). Visual confirmation
  should happen on the first live signal after deploy, as with PR #6.

## Files changed
- `src/app/scalping-v2/page.tsx` (`showCharts` + subtitle sentence)
- `src/app/scalping/page.tsx` (`showCharts` + subtitle sentence)
- `src/app/on-chain/page.tsx` (`showCharts` + subtitle sentence)
- `src/app/completed/page.tsx` (`showChart` ×4 + grid widening ×4)
- `src/app/on-chain/completed/page.tsx` (`showChart` + grid widening)
- `src/app/scalping/completed/page.tsx` (`showChart` + grid widening)
- `UI2-REPORT.md` (this report)
