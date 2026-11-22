# AMG Trading — Main Signals UI Upgrade: Per-Signal Charts with Entry / SL / TP1–TP3 Lines

Branch: `feature/signals-ui` (local only, not pushed)
Date: 2026-11-22
Basis: main b158bc87 (PR #2 engine). **Presentation only** — no signal
logic, thresholds, or accounting were changed.

User's order: "Isko ek professional UI mai tadbeel kro... Jese scalping
page banna hai waisa he isko krdo with chart k sth or Entry, Stop loss,
Tp1 Tp2 Tp3 tak mentioned k sth chart pai."

---

## STEP 1 — Inspection findings

### (a) How /scalping-v2 renders
- Client page (`src/app/scalping-v2/page.tsx`): `Navbar`, a coloured
  pill header, a gradient title (`bg-gradient-primary bg-clip-text`),
  an honest explainer paragraph, a `StatsCard` row (grid
  `md:grid-cols-4`), `glass rounded-lg` panels, and signals rendered
  through the **shared** `SignalList` → `SignalCard` components
  (grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
- It uses **no chart itself**. The only chart component in the app is
  `src/components/ui/PriceChart.tsx` (lightweight-charts candlesticks,
  no price lines), used by neither the dashboard nor scalping-v2.
- Conclusion: the "professional design language" to mirror is the
  shared card system itself (glass panels, gradient headings,
  StatsCards, the SignalCard layout). The dashboard already uses the
  same components — the missing piece was the per-signal chart.

### (b) Where the main /api/signals results are displayed, and the payload shape
- Main view: **`/dashboard`** ("Standard Trading Signals"), which
  fetches `/api/signals?market=CRYPTO&type=SPOT|FUTURE` and renders
  via `SignalList` → `SignalCard`. The home page (`/`) is a landing
  page linking to /dashboard; it shows no signals.
- `/api/signals` returns `{ signals, generatedAt, cached }`. Each
  signal is built in `SignalGenerator.generateSignal`
  (`src/lib/signals/generator.ts`) from `evaluateSignalCore` and
  **already includes** `entryPrice`, `currentPrice`, `stopLoss`,
  `takeProfit`, **`takeProfit1`, `takeProfit2`, `takeProfit3`**,
  `confidence`, `direction`, `status`, `pair`, `signalType`,
  `timestamp`, `expiresAt` (generator.ts destructures TP1–TP3 from the
  core result and assigns them onto the returned Signal object).
- **No API extension was needed** — the TP levels were already in the
  payload; the card text already displayed them. Only the chart and
  its candle feed were missing.

### (c) Charting library
- `lightweight-charts` **5.0.9 is already a dependency** (used by the
  existing `PriceChart`). v5 API used here: `chart.addSeries(
  CandlestickSeries, …)` and `series.createPriceLine({ price, color,
  lineWidth, lineStyle, axisLabelVisible, title })`. No new package
  was added.
- Candle source: `BinanceAPI.getCandles(pair, interval, limit)`
  already exists server-side (spot REST via
  `https://data-api.binance.vision`, the codebase's standard base).
  No `/api/candles` route existed — one was added.

---

## STEP 2 — What was built

### New: `src/app/api/candles/route.ts`
- `GET /api/candles?pair=BTC/USDT&interval=1h&limit=100`
  (interval whitelist 1m/5m/15m/1h/4h/1d; limit clamped 10–500;
  pair format validated → 400 on bad input).
- Server-side fetch via `BinanceAPI.getCandles` (data-api.binance.vision),
  mapped to `{ time (unix seconds), open, high, low, close, volume }`.
- 60-second in-memory cache per pair|interval|limit, mirroring
  `/api/signals`, so a dashboard full of cards shares upstream fetches.
- On any upstream failure: **502 `{ error: 'Live candle data
  unavailable' }`** — candles are never simulated.

### New: `src/components/ui/SignalChart.tsx`
- Client component; one instance per signal card. Fetches the pair's
  last 100 1H candles from `/api/candles` on mount.
- Renders a lightweight-charts candlestick series styled to the site
  (transparent background, muted grid/text, green/red candles — same
  palette as `PriceChart`).
- Draws the signal's own levels as **labelled price lines** via
  `createPriceLine`, each with its label **and price** in the line
  title and the price on the right axis (`axisLabelVisible: true`):
  - **Entry** — `#93c5fd` (light blue), solid, 2px
  - **SL** — `#ef4444` (red), dashed, 2px
  - **TP1** — `#86efac`, **TP2** — `#4ade80`, **TP3** — `#22c55e`
    (green shades), dashed, 1px
  - If a signal has no partial TPs, a single **TP** line is drawn
    from `takeProfit` instead.
- A legend row under the chart repeats each level's colour, label and
  price, so levels are readable even at a glance.
- States: "Loading chart…" placeholder while fetching; on failure a
  plain **"Chart unavailable — live candle data could not be loaded"**
  note (the card's numbers remain; nothing is invented).
- Resize-aware (ResizeObserver), chart disposed on unmount.

### Modified: `src/components/ui/SignalCard.tsx`
- New optional prop `showChart` (default **false**). When true and
  the signal is crypto, the chart block renders under the card header
  (above Confidence). All other content unchanged — pair, direction,
  entry, current price, SL, TP1/TP2/TP3 boxes, status, confidence
  were already in the card text and remain.

### Modified: `src/components/ui/SignalList.tsx`
- New optional prop `showCharts` (default **false**), passed through
  to each card. In chart mode the grid widens to
  `grid-cols-1 lg:grid-cols-2` so charts stay readable; default mode
  keeps the existing 1/2/3-column grid.

### Modified: `src/app/dashboard/page.tsx`
- Passes `showCharts` to `SignalList` (the only page that opts in).
- Subtitle now honestly describes the feature: "Each signal card
  shows its 1H price chart with the entry, stop loss and TP1–TP3
  levels marked on it." No performance claims added anywhere.

### Scope note
`SignalCard` is shared, so the chart code lands in a shared JS chunk,
but it **renders and fetches only where `showCharts` is passed** —
today only /dashboard. /scalping-v2, /scalping and /on-chain render
exactly as before. No engine file was touched:
`git diff` against b158bc87 covers only the five files above plus
this report.

---

## STEP 3 — Verification

- `npx tsc --noEmit`: **clean**.
- `npm run build`: **passes**; route table shows `ƒ /api/candles`
  registered and `/dashboard` built (501 kB first load — the increase
  is the lightweight-charts code in the dashboard's shared chunk).
- Production build run locally (`next start`, port 3100), smoke tests:
  - `GET /dashboard` → **200**; served HTML contains the new subtitle
    ("…TP1–TP3 levels marked on it").
  - `GET /api/candles?pair=BTC/USDT&interval=1h&limit=100` → **200**,
    100 real candles; the in-progress 08:00 UTC candle's close
    (60,090.58) matches the site's own live BTC price from
    `/api/binance/prices` (60,074.46) at the same moment — the feed
    is live, not cached history. ETH/USDT likewise returned 20 real
    candles. Bad interval and bad pair format → **400**.
  - `GET /api/signals?market=CRYPTO&type=FUTURE` → **200**; at
    smoke-test time **0 signals qualified** (the honest empty state —
    the PR #2 gates passed no pair at that moment; SPOT also 0).
    Because no live signal existed to capture, TP-field presence in
    the payload was verified in the generator code path instead
    (see Step 1b): every object the route returns is built with
    `takeProfit1/2/3` assigned from the engine core.
  - Chart wiring in the served bundle: the dashboard's client chunks
    contain `createPriceLine`, the `/api/candles` fetch, the
    "Chart unavailable" fallback and the "Entry / SL / TP levels
    marked" label — the component is compiled into the dashboard
    page and bound to the real API.
- **What could not be verified here:** the chart's *visual* rendering
  (pixels, line positions, label legibility) — this environment has
  no browser to screenshot the dashboard with, and with 0 live
  signals at test time no card mounted a chart during the smoke run.
  The chart code path (fetch → setData → createPriceLine per level)
  is type-checked, built, and bundle-verified; visual confirmation
  should happen on the first live signal after deploy.
- Environment note: one direct probe of data-api.binance.vision from
  this VM briefly hit Binance's request-weight limit (-1003) while
  the app's own routes were returning live data normally; the routes'
  60s caching and honest 502 state are the designed behaviour for
  such moments.

## Files changed
- `src/app/api/candles/route.ts` (new)
- `src/components/ui/SignalChart.tsx` (new)
- `src/components/ui/SignalCard.tsx` (opt-in `showChart` prop + chart block)
- `src/components/ui/SignalList.tsx` (opt-in `showCharts` prop + chart-mode grid)
- `src/app/dashboard/page.tsx` (passes `showCharts`; subtitle)
- `UI-REPORT.md` (this report)
