/* AMG Trading service worker.
 *
 * - Runtime caching for STATIC ASSETS ONLY (cache-first). API responses
 *   are never cached: signal data must always be live.
 * - Web Push: shows the notification the server sent and focuses/opens
 *   the signal's page on click. The payload's icon/badge (the AMG
 *   logo) are passed through to showNotification; a payload without
 *   them falls back to /logo.png.
 */

const STATIC_CACHE = 'amg-static-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

function isStaticAsset(url) {
    return (
        url.pathname.startsWith('/_next/static/') ||
        /\.(?:png|jpg|jpeg|svg|ico|webp|woff2?|css|js)$/.test(url.pathname)
    );
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return; // never cache API responses

    if (isStaticAsset(url)) {
        // Cache-first for immutable static assets.
        event.respondWith(
            caches.match(request).then((hit) => {
                if (hit) return hit;
                return fetch(request).then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                });
            })
        );
        return;
    }

    if (request.mode === 'navigate') {
        // Network-first for pages, falling back to the cached copy offline.
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
    }
});

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (e) {
        data = { title: 'AMG Trading', body: event.data ? event.data.text() : '' };
    }

    const title = data.title || 'AMG Trading';
    const options = {
        body: data.body || '',
        icon: data.icon || '/logo.png',
        badge: data.badge || '/logo.png',
        data: { url: data.url || '/dashboard' }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/dashboard';

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) {
                    client.focus();
                    if ('navigate' in client && client.url !== targetUrl) {
                        client.navigate(targetUrl).catch(() => {});
                    }
                    return;
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(targetUrl);
            }
        })
    );
});
