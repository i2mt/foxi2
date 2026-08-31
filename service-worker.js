// MedCalc Pro Service Worker
// App shell is network-first. Rizeh VAD + offline-ASR .data/.wasm use a
// stable cache-first model cache independent of ordinary app revisions.

const CACHE_NAME = 'FoxiMed_v5.1.0';
// Include the pinned model revision. The previous deployment accidentally
// stored Koochik bytes under a Rizeh-named cache, so reusing that namespace
// would keep serving the wrong 127 MB .data file after this release.
const MODEL_CACHE_NAME = 'FoxiMed_Model_Rizeh_v1_nonstreaming_int8_f2b9251_vad_sherpa_1_13_5';

const urlsToCache = [
    './',
    './index.html',
    './style.css?v=43',
    './voice-assistant.css?v=43',
    './calculation-core.js?v=34',
    './script.js?v=44',
    './voice-recognition.js?v=42',
    './koochik-asr.js?v=36',
    './koochik-worker.js?v=35',
    './sherpa-koochik/sherpa-onnx-asr.js',
    './sherpa-koochik/sherpa-onnx-vad.js',
    './sherpa-koochik/sherpa-onnx-wasm-main-vad-asr.js',
    './voice-commands.js?v=42',
    './voice-ui.js?v=42',
    './converters.js',
    './drugDatabase.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png',
    './icons/fox-mark.png',
    './icons/fox-mark-clean-mask.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;500;600;700&family=Roboto:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap'
];

// Install
self.addEventListener('install', event => {
    // Deliberately NOT calling self.skipWaiting() here. The app already has
    // a proper "update available" banner (script.js: setupUpdateDetection /
    // showUpdateBanner) that waits for the person to tap a button before
    // sending a SKIP_WAITING message — see the message handler below.
    // Calling skipWaiting() unconditionally here bypassed that entirely:
    // every deploy would activate immediately and force a page reload
    // ~300ms later (via the controllerchange listener in script.js),
    // regardless of what the person was in the middle of doing.
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            Promise.allSettled(urlsToCache.map(url =>
                cache.add(url).catch(err => {
                    console.warn('[SW] optional precache failed:', url, String(err));
                })
            ))
        )
    );
});

// Activate
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames =>
            Promise.all(
                cacheNames
                    // Retire old app shells and obsolete model payloads. The
                    // v27 Koochik cache is ~145 MB, so leaving it beside the
                    // smaller Rizeh model wastes scarce iOS site storage.
                    .filter(name =>
                        (name.startsWith('FoxiMed_v') && name !== CACHE_NAME) ||
                        (name.startsWith('FoxiMed_Model_') && name !== MODEL_CACHE_NAME)
                    )
                    .map(name => caches.delete(name))
            )
        )
    );

    self.clients.claim();
});

// Fetch strategy:
// - Small app assets: network-first, app-version cache fallback.
// - The large sherpa VAD+offline-ASR .data/.wasm payload: cache-first in a STABLE model cache
//   whose name is independent of FoxiMed app versions. A JavaScript-only
//   update therefore does not invalidate or redownload Rizeh.
//
// v18 was the first release that stores the large runtime/model this way, so
// users coming from v17 may need one final full download. Later app-shell
// updates can reuse the same model cache until the model/runtime itself is
// intentionally version-bumped.
const MODEL_ASSET_RE = /\/sherpa-koochik\/[^?#]+\.(?:data|wasm)(?:[?#]|$)/i;
const SW_SKIP_PATTERNS = [/\.tar\.gz(\?|$)/i, /\.gguf(\?|$)/i, /\.bin(\?|$)/i, /\.onnx(\?|$)/i];

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;

    if (MODEL_ASSET_RE.test(event.request.url)) {
        event.respondWith((async () => {
            const cache = await caches.open(MODEL_CACHE_NAME);
            const keyUrl = new URL(event.request.url);
            keyUrl.search = '';
            keyUrl.hash = '';
            const cacheKey = new Request(keyUrl.href, { method: 'GET' });

            // Normalize cache keys so query-string/cache-busting changes in
            // generated Emscripten loaders do not force another 130+ MB
            // model download. Ignore Vary as these are immutable same-origin
            // build assets for a fixed model/runtime cache version.
            const cached = await cache.match(cacheKey, { ignoreSearch: true, ignoreVary: true });
            if (cached) return cached;

            const response = await fetch(event.request);
            if (response && response.status === 200) {
                // CacheStorage is best-effort. Recognition must still work if
                // a browser refuses the large entry because of quota.
                event.waitUntil(
                    cache.put(cacheKey, response.clone()).catch(err => {
                        console.warn('[KoochikASR] model cache put failed:', String(err));
                    })
                );
            }
            return response;
        })());
        return;
    }

    if (SW_SKIP_PATTERNS.some(re => re.test(event.request.url))) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(networkResponse => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => cache.put(event.request, responseClone))
                        .catch(() => undefined);
                }
                return networkResponse;
            })
            .catch(() => caches.match(event.request))
    );
});

// Allow page to activate waiting SW immediately
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
