import type { MetadataRoute } from 'next';

/**
 * PWA manifest (served at /manifest.webmanifest by the Next.js file
 * convention and linked automatically). Colours match the site's dark
 * theme: background hsl(0 0% 4%) = #0a0a0a.
 * Icons are the AMG logo, code-generated PNGs (route handlers under
 * src/app/icons/, rendered by src/lib/iconImage.tsx) — no binary files
 * in the repo. Restored 2026-11-26 on the owner's order ("Icon wapis
 * lagao"), so Chrome offers Install again. There is still no favicon.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'AMG Trading',
        short_name: 'AMG',
        description: 'Professional trading signals for Forex and Cryptocurrency markets.',
        start_url: '/dashboard',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
            {
                src: '/icons/icon-192',
                sizes: '192x192',
                type: 'image/png'
            },
            {
                src: '/icons/icon-512',
                sizes: '512x512',
                type: 'image/png'
            },
            {
                src: '/icons/icon-maskable-512',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'maskable'
            }
        ]
    };
}
