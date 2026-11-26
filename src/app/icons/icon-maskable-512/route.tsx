import { amgLogoIcon } from '@/lib/iconImage';

// Maskable manifest icon, 512x512 PNG of the AMG logo with safe padding
// around the mark, generated at request time. Referenced by
// src/app/manifest.ts.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const logoUrl = new URL('/logo.png', request.url).toString();
    return amgLogoIcon(512, logoUrl, true);
}
