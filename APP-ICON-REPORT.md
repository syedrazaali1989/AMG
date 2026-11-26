# App icon restored — AMG logo back in the PWA manifest

Date: 2026-11-26. Status: **built + tested, NOT merged, NOT shipped.**
Branch work is in the working tree only (no commit, no push, no PR).
Production main is 4293ce4e (PR #24). This restores what the owner's
2026-11-23 order ("Icon hata do web sai") removed — on his new order
2026-11-26: "Icon wapis lagao or app icon jo hai woh logo wala karo".

## Why Chrome showed no Install option

The manifest was icon-free. Chrome requires manifest icons (192px +
512px) to offer Install; without them the site is not installable.
The user had deleted the installed app and reopened the site in
Chrome, where no Install option appeared.

## What changed

| File | Change |
|---|---|
| `src/lib/iconImage.tsx` | NEW (recreated). `amgLogoIcon(size, logoUrl, maskable?)` renders the ACTUAL AMG logo (`public/logo.png`: gold "AMG TRADING" with chart arrow on black) at exact sizes via `next/og` ImageResponse. The logo is fetched from the same origin at request time and embedded as a data URI. If the fetch fails, a gold "AMG" text mark is served instead so the icon route never 500s. |
| `src/app/icons/icon-192/route.tsx` | NEW. Dynamic GET → 192x192 PNG of the logo. |
| `src/app/icons/icon-512/route.tsx` | NEW. Dynamic GET → 512x512 PNG of the logo. |
| `src/app/icons/icon-maskable-512/route.tsx` | NEW. Dynamic GET → 512x512 PNG of the logo at 78% scale with safe padding (maskable). |
| `src/app/manifest.ts` | Icons restored: 192x192 + 512x512 (purpose "any") + 512x512 (purpose "maskable"). Everything else identical (name, short_name AMG, start_url /dashboard, display standalone, theme/background #0a0a0a). |
| `src/app/layout.tsx` | Comment only: the old comment claimed `icon.tsx` / `apple-icon.tsx` generate the favicon + apple touch icon — both files were deleted in 2026-11-23. Now says icons live under `src/app/icons/` and there is no favicon. |
| `src/lib/push/notify.ts` | Comment only: the old comment said "the manifest stays icon-free" — now says the manifest icons were restored 2026-11-26. No code change. |

No binary files in the repo — all icons are code-generated routes
(push-files cannot carry binaries). This reuses the approach of
commit 8ee4067 ("Icons as generated routes"), but the art is the real
logo now, not the old text-frame "AMG" drawing.

## Scope rules respected

- Manifest / app icon ONLY. **No favicon re-added** — `/favicon.ico`
  still 404s (verified). The website icon-removal order stays in force
  for the site itself.
- No apple-touch-icon route restored: the manifest never referenced
  it, and the user's phone is Android/Chrome, so it is out of scope.
- No page text, service-worker, or push-notification changes. The
  push icon/badge already use the same logo (`/logo.png`, PR #23).

## Test gate — PASSED

`npm run build`: clean (icon routes registered as dynamic ƒ,
`/manifest.webmanifest` served).

New test `scripts/test-app-icon.mjs` (production build + live
assertions, incl. a minimal PNG decoder that counts gold pixels):
**ALL 22 CHECKS PASSED** — manifest serves 200 with the three icons
(correct src/sizes/type/purpose); each icon URL returns 200
`image/png` at EXACTLY 192x192 / 512x512 / 512x512; each render is
pixel-proven to be the logo (gold coverage matches the source logo:
7.2% plain, 4.4% maskable = 7.2% × 0.78²; zero gold pixels on the
outer border, ruling out the text-mark fallback); `/logo.png` 200;
`/sw.js` 200; `/favicon.ico` 404; maskable differs from plain 512
(padding applied).

Caveat (test-only, fixed in the test): the first run failed the three
logo-content checks — the gold-coverage threshold (8%) was set above
the logo's own 7.2%, and the maskable expectation ignored its 0.78
scale. Fixed the assertions; production code was not changed between
runs. The failure usefully proved the decoder works: the icon render
measured 7.26% vs the logo's 7.21%.

## Icon URLs (live after deploy)

- `https://amgtrading.vercel.app/icons/icon-192` — 192x192
- `https://amgtrading.vercel.app/icons/icon-512` — 512x512
- `https://amgtrading.vercel.app/icons/icon-maskable-512` — 512x512 maskable

## Steps for the user after it goes live

1. Chrome mein `amgtrading.vercel.app` kholein.
2. Chrome menu (⋮) → **Install app** (ab option aayega) → Install.
   Agar option turant na aaye to page ko ek dafa reload karein; Chrome
   installability ko dobara check karta hai.
3. App khol kar **bell dekhein**: agar app delete karne se subscription
   gayi ho to bell saada (off) hogi — us par tap karke dobara subscribe
   karein (Allow puche to Allow). Bell bajti hui bright sunehri ho to
   subscription pehle se on hai, kuch karne ki zaroorat nahi.
4. Agle naye signal par notification aani chahiye, label + logo ke saath.
