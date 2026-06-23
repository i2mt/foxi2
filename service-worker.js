// MedCalc Pro Service Worker
// Network-first strategy for all assets.
// Always tries to fetch the latest version.
// Falls back to cache only when offline.

const CACHE_NAME = 'FoxiMed_v4.7.2.1';

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

// Fetch - Network First for EVERYTHING, EXCEPT large model/data files,
// which pass through untouched.
//
// Why: this handler clones every successful response to cache it. Cloning
// a streamed response means the browser buffers BOTH copies at once (one
// for the page, one for the cache) — fine for small app-shell files, but
// for something like a 53MB Vosk model, that's a real memory spike. iOS
// Safari in particular can respond to that by killing the service worker's
// background process mid-transfer, which breaks the fetch from the page's
// point of view even though a plain direct navigation to the same URL
// (which never goes through this handler at all) works fine. The model
// file already has its own, separate, deliberate caching strategy in
// voice-recognition.js — it doesn't need (or want) this handler's help too.
const SW_SKIP_PATTERNS = [/\.tar\.gz(\?|$)/i, /\.gguf(\?|$)/i, /\.bin(\?|$)/i, /\.onnx(\?|$)/i];

self.addEventListener('fetch', event => {

    if (event.request.method !== 'GET') return;

    if (SW_SKIP_PATTERNS.some(re => re.test(event.request.url))) {
        return; // let the browser handle it as a completely normal, uncontrolled fetch
    }

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
