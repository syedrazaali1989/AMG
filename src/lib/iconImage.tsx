import { ImageResponse } from 'next/og';

/**
 * AMG app icon — the actual AMG logo (public/logo.png: gold "AMG TRADING"
 * with chart arrow on black), rendered at exact sizes by Next.js at
 * request time via next/og. No binary files in the repo (push-files
 * cannot carry them), so every icon is a code-generated route.
 *
 * Used by the manifest icon route handlers under src/app/icons/.
 * The logo is fetched from the same origin at request time and embedded
 * as a data URI; if that fetch fails, a gold "AMG" text mark is served
 * instead so the icon route never 500s.
 *
 * @param size     Output edge length in px (square).
 * @param logoUrl  Absolute URL of public/logo.png on this deployment.
 * @param maskable When true, the mark is scaled down with safe padding
 *                 so platform masks (circle/squircle) never clip it.
 */
export async function amgLogoIcon(size: number, logoUrl: string, maskable = false): Promise<ImageResponse> {
    let dataUrl: string | null = null;
    try {
        const res = await fetch(logoUrl);
        if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            dataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        }
    } catch {
        dataUrl = null;
    }
    if (!dataUrl) return textMark(size, maskable);

    const scale = maskable ? 0.78 : 1;
    const img = Math.round(size * scale);
    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0a0a0a'
                }}
            >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={dataUrl} width={img} height={img} />
            </div>
        ),
        { width: size, height: size }
    );
}

/**
 * Fallback mark — gold bold "AMG" letters inside a thin gold frame on
 * the site's dark background (#0a0a0a, gold #D4AF37). Served only when
 * the logo itself cannot be fetched.
 */
function textMark(size: number, maskable = false): ImageResponse {
    const scale = maskable ? 0.78 : 1;
    const frame = Math.round(size * 0.92 * scale);
    const border = Math.max(2, Math.round(size * 0.014 * scale));
    const fontSize = Math.round(size * 0.33 * scale);

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#0a0a0a'
                }}
            >
                <div
                    style={{
                        width: frame,
                        height: frame,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: `${border}px solid #D4AF37`,
                        color: '#D4AF37',
                        fontSize,
                        fontWeight: 900,
                        letterSpacing: '-0.02em'
                    }}
                >
                    AMG
                </div>
            </div>
        ),
        { width: size, height: size }
    );
}
