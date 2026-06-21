// MedCalc Pro Service Worker
// Network-first strategy for all assets.
// Always tries to fetch the latest version.
// Falls back to cache only when offline.

const CACHE_NAME = 'FoxiMed_v4.6.0';

const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './voice-assistant.css',
    './script.js',
    './voice-recognition.js',
    './voice-commands.js',
    './voice-ui.js',
    './converters.js',
    './drugDatabase.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './icons/fox-mark.png',
    './icons/fox-mark-mask.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap'
];

// Install
self.addEventListener('install', event => {
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames =>
            Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            )
        )
    );

    self.clients.claim();
});

// Fetch - Network First for EVERYTHING
self.addEventListener('fetch', event => {

    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseClone);
                        });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// Allow page to activate waiting SW immediately
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
