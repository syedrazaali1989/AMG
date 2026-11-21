# On-Chain Page Fix — Report (2026-11-21)

Branch: `feature/onchain-fix` (based on main `fd89e80`, PR #3 merge). Committed locally, NOT pushed.

## What was fake

1. **`src/lib/signals/whaleAlertAPI.ts` — 100% simulated.** `getTransactions()` returned
   `getSimulatedData()` unconditionally ("Use simulated data by default (real API has CORS
   issues in browser)", "🐋 Using simulated whale data (demo mode)"): 5–10 invented
   transactions with `Math.random` amounts, random exchange names, and fabricated
   addresses/hashes. The real Whale Alert API code was commented out. (The class had no
   remaining callers in the app, but it was the page concept's "whale feed" layer and a
   loaded gun for any future use.)
2. **`src/lib/signals/blockchainInfoAPI.ts` — fake fallback inside the "real" source.**
   When the Blockchain.info request failed, `getLargeTransactions()` silently returned
   `generateFallbackData()`: 7 invented transactions with random BTC amounts, random
   inflow/outflow types and fake hashes, indistinguishable from real ones downstream.
   Separately, `getBTCPrice()` silently fell back to a hardcoded **$50,000** BTC price,
   which would have corrupted every USD value and the $500K threshold itself.
3. **Correlated altcoin selection was random.** `CorrelatedSignalGenerator` picked 10
   coins at random per call (`CorrelationMatrix.getRandomCorrelatedCoins`), so the same
   BTC move produced different "signals" on every refresh and for every visitor.
4. **Dishonest labels.** The BTC rationale claimed transactions were ">$1M each" while the
   actual threshold was $500K; the page header likewise advertised "Min Transaction: $1M".
   Completed-signal stats on the old page counted `tp2Hit || tp3Hit` as "completed".

## What replaced it

- **`whaleAlertAPI.ts` deleted** (no callers; nothing of value to salvage — its only real
  code path required a paid key and was commented out).
- **`blockchainInfoAPI.ts` — real data only, failures are loud.**
  - `getBTCPrice()` throws when the ticker is unreachable or returns no USD price. The
    $50,000 fallback is gone.
  - `generateFallbackData()` deleted. `getLargeTransactions()` throws when the source is
    unreachable; an empty result now genuinely means "no large transfers found".
  - **Source change (important):** large transactions are now collected from the most
    recent **confirmed blocks** (`/latestblock` + `/rawblock`, latest block first, previous
    block too if the latest yields < 10 large transfers; largest first, cap 50). Reason:
    the previously used `/unconfirmed-transactions` feed returns only the ~100 newest
    mempool transactions — measured live during this fix, its largest transfer was
    **$446K**, i.e. the $500K feed was empty by construction and could essentially never
    fire honestly (this is almost certainly why the fake fallback existed). One confirmed
    block is the complete population of ~2,100 transactions and contained **50 transfers
    ≥ $500K** at test time. Each transaction now also carries its `blockHeight`.
- **`onChainGenerator.ts` — report-based generation.** New `generateOnChainReport()`
  returns `{ signals, transactions, diagnostics }`; `generateOnChainSignals()` delegates
  to it and now propagates live-data failures instead of swallowing them into `[]`.
  Diagnostics expose the full evidence: transactions analysed, inflow/outflow counts and
  USD, net flow, on-chain score, technical score + RSI, combined score vs the ±10
  threshold, whether the BTC signal issued, and how many correlated signals followed.
  Signals get a 48h `expiresAt` (repo FUTURE convention) so the shared outcome updater
  closes them honestly: **final TP (TP3) = COMPLETED, SL = STOPPED, expiry = EXPIRED,
  TP1/TP2 milestones only, realised P/L at the exit price.** Rationale threshold text
  corrected to "≥$500K".
- **`correlatedSignalGenerator.ts` — deterministic + labelled.** Selection is now the 10
  strongest BTC-correlated coins (correlation ≥ 0.74, highest first) — identical for every
  visitor and auditable. Every correlated signal's rationale starts with an explicit
  "🏷️ CORRELATED signal — derived from the BTC on-chain signal … not an independent
  whale signal" label, and correlated signals also carry the 48h expiry.
- **New server route `src/app/api/on-chain/signals/route.ts`** following the
  `/api/signals` / `/api/scalping-v2/signals` pattern: one shared server-side generation
  pass, 60s cache, and **HTTP 502 when a live source is down** — never simulated data.
  Response: `{ signals, transactions, diagnostics, generatedAt, cached }`.
- **`autoGenerator.ts`** — the client auto-generator's on-chain case now fetches
  `/api/on-chain/signals` (same pattern as standard signals) instead of running the
  generator in the browser.
- **`src/app/on-chain/page.tsx` — rewritten** on the scalping-v2 page pattern: consumes
  the API (60s rescan), merges signals into the existing `onchain` SignalManager store,
  polls live Binance prices and applies the shared honest outcome rules, and shows:
  the scoring-evidence panel, the **real large-transaction feed** (time, block height,
  hash linked to the public explorer, BTC + USD value, from → to addresses, flow label),
  an honest closed-history table (full-TP win rate), and a "Live Data Unavailable" state
  on 502. Header copy names the actual sources and mechanics; the "$1M" claim is gone.

## Data sources used (all free, no API key)

- **Blockchain.info** — BTC/USD ticker, latest confirmed blocks (`latestblock`, `rawblock`).
- **Binance via `data-api.binance.vision`** — BTC/alt prices and 1h klines through the
  repo's existing `BinanceAPI` / `MarketDataManager` (unchanged).
- **mempool.space** — reachable and used as the *independent verification source* in
  testing (not integrated into the runtime path; one real source, honestly labelled,
  beats two blended ones).

## Audit of the rest of the flow

- `MarketDataManager.generateMarketData` (CRYPTO) — already real-only (Binance klines,
  throws on failure). Unchanged.
- `MarketDataManager.getAllMexcPrices()` — **still contains a `Math.random` simulated
  spread** applied to Binance prices when MEXC is unreachable. It is **not used by the
  on-chain flow** (only caller: the dashboard's MEXC price comparison). Left untouched as
  out of scope for this fix, but flagged here plainly: those comparison prices can be
  simulated today.
- `CorrelationMatrix.getRandomCorrelatedCoins()` — still exists but now has **no
  callers**; the on-chain flow no longer uses it.
- `autoGenerator.ts` line ~162 `.sort(() => Math.random() - 0.5)` — pair shuffling inside
  `generateScalpingSignals` (the separate scalping flow), not the on-chain path. Untouched.
- `ExchangeAvailability` — static exchange-availability metadata, not market data. Untouched.

## TEST RESULTS

**(a) Build.** `npx tsc --noEmit` clean. `npm run build` passes. Route table includes
`ƒ /api/on-chain/signals` and `○ /on-chain`; both returned **HTTP 200** from the
production server (`next start`, port 3200).

**(b) Live smoke test of `/api/on-chain/signals`** (production build, 2026-11-21 ~17:43Z):
HTTP 200, `cached: false`, **50 transactions**, **0 signals**, diagnostics:
`transactionsAnalyzed: 50, exchangeInflowCount: 0, exchangeOutflowCount: 0,
unknownCount: 50, netFlowUSD: 0 (NEUTRAL), onChainScore: 0, technicalScore: -10,
rsi: 73, combinedScore: -5, threshold: 10, btcSignalIssued: false, correlatedIssued: 0`.
Server log confirms: "Found 50 real BTC transactions over $500,000 in 1 confirmed
block(s)" → "BTC Scoring: OnChain=0, Technical=-10, Total=-5" → "signal too weak".
A second pair of rapid calls confirmed the 60s cache (`cached: true`, same payload).
Independent verification of feed transactions against **mempool.space** (`/api/tx/<hash>`):

| Hash (prefix) | Feed value | mempool.space value | Block | Match |
|---|---|---|---|---|
| f5ddffcccf214dfa | 4500.00 BTC | 4500.00 BTC | 976931 = 976931 | ✅ exact |
| 6f9a0f16956db068 | 1499.64 BTC | 1499.64 BTC | 976931 = 976931 | ✅ exact |
| 1ee5dd602cb1f21a | 543.84 BTC | 543.84 BTC | 976931 = 976931 | ✅ exact |

(USD values differ by <0.2% between snapshots because each is computed from the live
BTC price at fetch time. Timestamps: Blockchain.info reports the transaction's
first-seen time, mempool.space the block time — 151s apart for the first row, same
transaction, same block.)

**(c) Grep proof.** Over the full on-chain code path (`api/on-chain/`, `on-chain/page.tsx`,
`onChainGenerator.ts`, `blockchainInfoAPI.ts`, `correlatedSignalGenerator.ts`,
`autoGenerator.ts`): no `getSimulatedData`, no `generateFallbackData`, no simulated-data
code remains — "simulat*" hits are only comments/copy stating that simulation never
happens. **`Math.random` in the on-chain path is used ONLY for signal ID generation**
(`onChainGenerator.ts`, `correlatedSignalGenerator.ts`) — it never touches data, prices,
transactions, scores or selection. `whaleAlertAPI` has zero remaining references.

**(d) No-signal evidence.** No signal qualified at test time, and the diagnostics above
prove the pipeline ran on real data: 50 real ≥$500K transfers were scored (all classified
wallet-to-wallet this block), the technical score came from live Binance prices
(RSI 73 → −30, MACD positive → +20, net technical −10), and the combined
−5 fell short of the ±10 threshold, so nothing was issued — the honest outcome.

## What could NOT be made real (stated plainly)

- **Exchange inflow/outflow labelling coverage is weak.** Labelling relies on a small
  built-in set of 5 known exchange wallet addresses. In the test block, **0 of 50** large
  transfers touched those addresses, so all were classified "unknown" and the on-chain
  score was 0. The transactions and values are fully real; the *flow classification* will
  often be neutral simply because modern exchange wallets mostly use addresses outside
  this tiny set. Proper labelled-wallet coverage requires a labelled-address provider
  (e.g. Whale Alert's paid API) — no free source provides it, so it was NOT faked.
  Consequence: BTC on-chain signals will fire mainly when a labelled exchange wallet is
  involved or the technical score alone reaches the threshold.
- **The feed is confirmed blocks, not a real-time mempool stream.** Large transfers
  appear once their block is mined (~10 min cadence). The page copy says exactly this;
  nothing claims to be a real-time whale-alert service.
- **Out of scope, left as found:** the dashboard's MEXC comparison prices
  (`getAllMexcPrices`) can still be simulated when MEXC is unreachable (see audit above).
