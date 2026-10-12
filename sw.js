// ===================================
// SERVICE WORKER — offline support
// Bump CACHE_VERSION whenever app files change so users get the update.
// ===================================

const CACHE_VERSION = 'v66';
const APP_CACHE = `cashg-app-${CACHE_VERSION}`;
const FONT_CACHE = 'cashg-fonts';
const LIB_CACHE = 'cashg-libs';

const APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './tracker.css',
    './ios.css',
    './fonts/inter-latin.woff2',
    './script.js',
    './config.js',
    './cloud.js',
    './receiptstore.js',
    './account.js',
    './tour.js',
    './connectivity.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './icons/favicon-64.png',
    './icons/logo-mark.png',
    './icons/logo.png'
];

// The admin dashboard is online-only and must never be served from the app cache
const ADMIN_PATH = new URL('./admin/', self.location).pathname;

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => ![APP_CACHE, FONT_CACHE, LIB_CACHE].includes(key))
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Google Fonts: serve cached copy, refresh in background
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
        return;
    }

    // Supabase client library, so the app can start offline
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/')) {
        event.respondWith(staleWhileRevalidate(request, LIB_CACHE));
        return;
    }

    // Everything else from other origins (Supabase API, storage) always goes to the network
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith(ADMIN_PATH)) return;

    // Page loads: network first so updates show up, fall back to cached app offline
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const copy = response.clone();
                    caches.open(APP_CACHE).then(cache => cache.put('./index.html', copy));
                    return response;
                })
                .catch(() => caches.match('./index.html', { ignoreSearch: true }))
        );
        return;
    }

    // Static files: cache first, then network
    event.respondWith(staleWhileRevalidate(request, APP_CACHE));
});

async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
        .then(response => {
            if (response && (response.ok || response.type === 'opaque')) {
                cache.put(request, response.clone());
            }
            return response;
        })
        .catch(() => cached);
    return cached || network;
}
