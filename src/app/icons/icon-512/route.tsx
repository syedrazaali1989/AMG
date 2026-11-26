import { amgLogoIcon } from '@/lib/iconImage';

// Manifest icon, 512x512 PNG of the AMG logo, generated at request time
// (no binary files in the repo). Referenced by src/app/manifest.ts.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const logoUrl = new URL('/logo.png', request.url).toString();
    return amgLogoIcon(512, logoUrl);
}
