import type { MetadataRoute } from 'next';

/**
 * PWA manifest (served at /manifest.webmanifest by the Next.js file
 * convention and linked automatically). Colours match the site's dark
 * theme: background hsl(0 0% 4%) = #0a0a0a.
 * No icons by the owner's decision (2026-11-23).
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
        theme_color: '#0a0a0a'
    };
}
