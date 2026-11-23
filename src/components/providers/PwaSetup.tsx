'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker (public/sw.js) once on the client.
 * Renders nothing. Registration failures are ignored - the site works
 * exactly the same without the worker.
 */
export function PwaSetup() {
    useEffect(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {
                // Service worker unavailable (unsupported browser, etc.)
            });
        }
    }, []);

    return null;
}
