# Push notifications: engine label + logo icon — report

Date: 2026-11-25. User's complaint: the first signal notification never
said WHICH engine it came from (Standard / Scalping / Scalping V2 /
On-Chain) and carried no logo icon.

## What changed (2 production files, no page text touched)

### `src/lib/push/notify.ts`
- New `ENGINE_LABELS` map: `standard → Standard`, `scalping-v2 →
  Scalping V2`, `gold → Gold`.
- `toCandidate()` title is now `` `${label} Signal: ${pair} ${direction}` ``
  (was `New Signal: ${pair} ${direction}`). Body is byte-identical
  (`Entry … · SL … · TP1 …`). Signal ids, URLs, history recording and
  all other behaviour are untouched.
- New `NOTIFICATION_ICON_URL = 'https://amgtrading.vercel.app/logo.png'`
  (absolute URL — a push payload cannot resolve a relative path).
  Every candidate carries `icon` + `badge` = that URL, and the JSON
  payload sent by `checkAndNotify()` now includes both fields.
- A code comment on `collectCurrentCandidates()` records why old
  scalping and on-chain are deliberately NOT in the watcher (see below).

### `public/sw.js` (push handler only)
- `showNotification()` now receives `icon: data.icon || '/logo.png'`
  and `badge: data.badge || '/logo.png'`. An old payload without the
  fields still shows the logo via the fallback.
- Verified BEFORE editing: the live served `/sw.js` (fetched
  2026-11-25 ~19:00 PKT) is byte-identical to the local file.
- `/logo.png` verified serving live (500×500 PNG).

### Scope rules respected
- No page text added or changed anywhere (notification text only).
- Manifest stays icon-free, no favicon re-added: the logo appears
  ONLY in push notifications, nowhere on the website.

## New notification format (live-verified)

`Standard Signal: SOL/USDT SHORT`
body: `Entry 66.83 · SL 70.72696384 · TP1 65.88`, url `/dashboard`,
icon + badge `https://amgtrading.vercel.app/logo.png`.

Per engine (same code path for all three):
- Standard → `Standard Signal: <PAIR> <LONG|SHORT>`, url `/dashboard`
- Scalping V2 → `Scalping V2 Signal: <PAIR> <LONG|SHORT>`, url `/scalping-v2`
- Gold → `Gold Signal: <PAIR> <LONG|SHORT>`, url `/gold`

Live payloads were captured and decrypted for Standard only (18 of
18 in the test run — Scalping V2 and Gold had zero live signals at
that time, see test notes). The V2/Gold titles use the identical
`toCandidate` + `ENGINE_LABELS` code path, and the built server bundle
was grep-verified to contain the `Scalping V2` label and the logo URL.

No re-subscribe needed: the change is server-side. The user's
existing subscription keeps working; the next notification already
carries the label + icon. (Installed service workers pick up the new
`sw.js` on the next page load — it calls `skipWaiting()`.)

## Coverage decision: old scalping + on-chain NOT added

Checked both server generators against the "add cleanly" bar
(direct import, same `Promise.allSettled` pattern, stable
`engine:pair:side:anchor` id, no extra load on the 5-min watcher).
Both fail it, so coverage stays at Standard / Scalping V2 / Gold —
exactly as before; neither engine push-notified before, and neither
does now.

### Old scalping — not added, 3 reasons
1. **No stable id.** Signals are stamped `SCALP_${Date.now()}_${random}`
   and the generator returns only prices/volumes — no timestamps, no
   bar anchor. A wall-clock 5m anchor would re-notify a persistent
   setup every 5 minutes (the watcher cadence) for up to its 4h
   expiry: notification spam. A proper fix needs the generator to
   return its decision-bar anchor (engine change).
2. **Load.** The route scans 30 pairs in parallel; the watcher burst
   already trips Binance 418 rate limits (the reason PR #20 resolves
   history BEFORE evaluating engines). +30 fetches per pass would make
   that worse for every engine.
3. **Mismatch.** 15–60-minute setups notified on a 5-minute anchor
   is the wrong granularity for a push channel.

### On-chain — not added, 3 reasons
1. **No stable id.** Signals are stamped `ONCHAIN_${Date.now()}_${random}`
   and `generateOnChainReport()` returns transactions + diagnostics,
   no decision-bar anchor. A wall-clock 1H anchor could flap at hour
   boundaries against the generator's own kline-derived bar and
   double-notify. A proper fix needs the generator to return its
   decision-bar anchor (engine change).
2. **Load.** One pass costs a Blockchain.info fetch + BTC 1H/4H +
   ~10 correlated-alt 1H fetches, every 5 minutes, on top of the
   418-prone burst.
3. **Duplication.** Its BTC leg is the standard engine's core
   verbatim — it would double-notify the same BTC trade the Standard
   engine already notifies in the same hour.

To add either engine later: make its generator return the decision-bar
anchor (the way `generateStandardSignals()` returns `barAnchors`), then
wire it into `collectCurrentCandidates()` with label `Scalping` /
`On-Chain`.

## Test gate — PASSED

`npm run build`: clean (exit 0, route table printed).

New mocked end-to-end test `scripts/test-push-label-icon.mjs`
(pattern of `scripts/test-signal-history.mjs`: fake Upstash REST +
fake push endpoint + throwaway VAPID keys + real production build):
- Fake push endpoint is HTTPS (web-push only speaks HTTPS) with a
  throwaway self-signed cert; server runs with
  `NODE_TLS_REJECT_UNAUTHORIZED=0`. One subscription is seeded via the
  real POST `/api/push/subscribe` (real ECDH P-256 keypair generated
  in the test), and captured payloads are DECRYPTED (RFC 8291
  aes128gcm) and asserted field by field.
- Result: **ALL CHECKS PASSED** (second run; the first run caught two
  bugs in the TEST script only — the RFC 8291 derivation missed the
  `WebPush: info` inner-HKDF stage and the trailing-`0x02` padding,
  and HGETALL's flat-array shape was miscounted. Both fixed in the
  test script; production code was not changed between runs).
- Watch tick: `checked 18, newCount 18, sent 18` — all 18 live
  Standard SHORTs sent to the one fake subscriber, all 18 payloads
  decrypted and asserted: title `Standard Signal: <PAIR> SHORT`,
  body `Entry · SL · TP1` unchanged, icon + badge = logo URL on every
  payload, URL `/dashboard` on every payload, no duplicate titles.
- Dedup: second watch tick `newCount 0, sent 0`, zero additional
  POSTs at the fake endpoint.
- Isolation: live route counts during the run were Standard 18,
  Scalping V2 0, Gold 0 — payloads still flowed for Standard while
  two engines were empty; plus a static check that the watcher
  isolates engines with `Promise.allSettled`.
- Served assets: the built server's `/sw.js` contains the
  `data.icon` / `data.badge` passthrough; `/logo.png` serves 200 as
  `image/png`.
- Subscription still stored after sends; `removedSubscriptions: 0`.

Caveat: no live Scalping V2 or Gold signal fired during the test
runs, so their exact title strings are verified by shared code path
+ bundle grep, not by a captured live payload. The next live V2/Gold
signal is the first live proof for those two labels.

## Git state

No commit, no push, no branch, no PR created (per instructions).
Working-tree edits only: `src/lib/push/notify.ts`, `public/sw.js`,
plus new `scripts/test-push-label-icon.mjs` and this report. All other
working-tree modifications are pre-existing production content, not
touched by this task.
