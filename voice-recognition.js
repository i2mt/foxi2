/* ============================================
   FoxiMed — Voice Engine
   ============================================
   Low-level speech capture layer with TWO interchangeable backends:

     1. "webspeech" — the native browser SpeechRecognition API. Used on
        Android / desktop / macOS Safari, where it's fast and needs no
        download.

     2. "vosk" — an offline, on-device WASM speech engine (vosk-browser,
        https://github.com/ccoreilly/vosk-browser). Used on iOS, because
        Apple's WebKit SpeechRecognition implementation is unreliable —
        especially once the PWA is installed to the Home Screen, where it
        frequently fails outright. Vosk never touches that API at all, so
        it works the same whether the app is in a Safari tab or installed.

   Both backends are driven through the exact same public, event-driven
   API, so neither voice-commands.js nor voice-ui.js need to know which
   one is active:

       window.VoiceEngine.getSupportInfo()
       window.VoiceEngine.start()
       window.VoiceEngine.stop()
       window.VoiceEngine.isActive()
       window.VoiceEngine.on(event, handler)

   Events emitted: 'start', 'interim', 'final', 'end', 'error', 'audio',
                    'model-loading', 'model-ready'

   --- SETUP REQUIRED FOR THE VOSK (iOS) BACKEND ---
   Set VOSK_MODEL_URL below to your own hosted `.tar.gz` Persian Vosk
   model. Until that's set, iOS falls back to the native API + the
   existing "open in Safari / type instead" guidance, so nothing breaks
   if you deploy before the model is ready.

   WHICH MODEL: use vosk-model-small-fa-0.42 (53MB), not -0.5 (60MB).
   Despite the lower version number, alphacephei's own published word
   error rates show 0.42 is the noticeably better-trained generation —
   roughly 25-45% fewer word errors than 0.5 on their own benchmarks
   (CV17: 23.4 vs 31.2 / Fleurs: 14.0 vs 26.2) — while also being a
   smaller download. There's no real reason to use 0.5 instead.
   (A non-"small" vosk-model-fa-0.42 also exists with even better
   accuracy, but at 1.6GB it's impractical for a web app — skip it.)
   Get it from https://alphacephei.com/vosk/models.

   Gotchas worth knowing (verified against the actual vosk-browser v0.0.8
   source, not just its README, since the README example is slightly
   out of date):
     - The model file MUST be `.tar.gz`, not the `.zip` alphacephei.com
       distributes. Unzip it, rename the folder to exactly `model`, then:
           tar -czf vosk-model-small-fa-0.42.tar.gz model
       (the library's virtual filesystem expects the top-level folder to
       be literally named "model" — keeping the original folder name is
       a common silent-failure cause).
     - `new model.KaldiRecognizer(sampleRate)` requires the sample rate
       argument — the README's own snippet omits it, but the published
       type definitions and compiled source both require it.
     - Host the file on the SAME origin as the rest of FoxiMed (e.g. next
       to index.html) so there's no CORS step to configure at all.
     - Set a long Cache-Control (e.g. max-age=31536000, immutable) on that
       file at your host so repeat visits don't re-download ~53MB.
     - This part of the rebuild could not be end-to-end tested here (no
       iOS device, no microphone, no real network fetch of the model in
       this sandbox) — the integration matches the verified library
       source exactly, but please test for real on an iOS device before
       relying on it.
   ============================================ */
(function (window) {
    'use strict';

    // Mehdi: put your hosted, same-origin .tar.gz model URL here.
    // Leave empty to keep the current native-API/banner behavior on iOS.
    const VOSK_MODEL_URL = 'https://raw.githubusercontent.com/i2mt/foxi2/refs/heads/main/icons/vosk-model-small-fa-0.5.tar.gz';
    const VOSK_LIB_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
    // How long to wait for the model download before giving up. Raise this
    // further if your users are on consistently slow connections — there's
    // no real downside to being patient here, it only delays the *failure*
    // message on a genuinely dead connection, it doesn't block anything
    // else in the app.
    const VOSK_MODEL_TIMEOUT_MS = 15 * 60 * 1000; // generous outer backstop; the retry logic below handles ordinary stalls long before this
    const VOSK_CACHE_NAME = 'foximed-vosk-model-v1';

    function voskConfigured() { return !!VOSK_MODEL_URL; }

    // ============================================
    // ENVIRONMENT DETECTION
    // ============================================
    function detectIOS() {
        const ua = navigator.userAgent || '';
        const isClassicIOS = /iPad|iPhone|iPod/.test(ua);
        // iPadOS 13+ identifies as "Macintosh" but exposes multi-touch
        const isModernIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
        return isClassicIOS || isModernIPad;
    }

    function detectStandalonePWA() {
        const iosStandalone = window.navigator && window.navigator.standalone === true;
        const displayModeStandalone = window.matchMedia &&
            (window.matchMedia('(display-mode: standalone)').matches ||
             window.matchMedia('(display-mode: fullscreen)').matches);
        return !!(iosStandalone || displayModeStandalone);
    }

    const ENV = {
        isIOS: detectIOS(),
        isStandalone: detectStandalonePWA(),
        isSecureContext: window.isSecureContext !== false,
        isOnline: navigator.onLine !== false,
        hasSpeechRecognition: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        hasGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        hasAudioContext: !!(window.AudioContext || window.webkitAudioContext)
    };

    // ============================================
    // SUPPORT / LIMITATION REPORT
    // ============================================
    // status: 'ok'        -> everything should work normally
    //         'limited'    -> API exists but is known to be unreliable here
    //                         (iOS Home Screen app) — we still allow trying,
    //                         but the UI should show a persistent notice and
    //                         lead with the text fallback.
    //         'blocked'    -> no point attempting (no API / insecure context)
    function getSupportInfo() {
        if (!ENV.isSecureContext) {
            return {
                status: 'blocked',
                code: 'insecure',
                title: 'اتصال امن لازم است',
                message: 'دسترسی به میکروفون فقط روی HTTPS کار می‌کند. آدرس سایت را بررسی کنید.'
            };
        }
        if (ENV.isIOS && voskConfigured()) {
            if (voskFailInfo) return voskFailInfo;
            // Vosk doesn't touch WebKit's SpeechRecognition at all, so the
            // standalone-PWA restriction simply doesn't apply here.
            return { status: 'ok', code: 'ios-vosk', title: null, message: null };
        }
        if (!ENV.hasSpeechRecognition) {
            return {
                status: 'blocked',
                code: 'unsupported',
                title: 'تشخیص گفتار در دسترس نیست',
                message: 'این مرورگر از تشخیص صدا پشتیبانی نمی‌کند. می‌توانید دستورات را تایپ کنید — همه قابلیت‌ها از طریق متن هم در دسترس‌اند.'
            };
        }
        if (ENV.isIOS && ENV.isStandalone) {
            return {
                status: 'limited',
                code: 'ios-standalone',
                title: 'محدودیت اپل در حالت نصب‌شده',
                message: 'اپل تشخیص صدا را در اپ‌های نصب‌شده روی صفحه اصلی iOS به‌طور کامل پشتیبانی نمی‌کند. برای استفاده کامل از دستیار صوتی، این صفحه را در Safari باز کنید — یا همینجا دستور را تایپ کنید.'
            };
        }
        if (ENV.isIOS) {
            return {
                status: 'ok',
                code: 'ios-safari',
                title: null,
                message: null
            };
        }
        return { status: 'ok', code: 'ok', title: null, message: null };
    }

    // ============================================
    // ERROR CLASSIFICATION
    // ============================================
    function classifyError(rawCode) {
        const map = {
            'not-allowed': {
                code: 'not-allowed',
                title: 'دسترسی میکروفون رد شد',
                message: 'لطفاً در تنظیمات مرورگر، دسترسی میکروفون را برای این سایت فعال کنید.'
            },
            'service-not-allowed': {
                code: 'service-not-allowed',
                title: 'سرویس تشخیص صدا در دسترس نیست',
                message: ENV.isIOS
                    ? 'در iOS مطمئن شوید از Safari استفاده می‌کنید (نه اپ نصب‌شده) و دسترسی میکروفون در تنظیمات فعال است.'
                    : 'سرویس تشخیص صدای مرورگر شما در دسترس نیست.'
            },
            'no-speech': {
                code: 'no-speech',
                title: 'صدایی شنیده نشد',
                message: 'چیزی متوجه نشدم. لطفاً دوباره و واضح‌تر صحبت کنید.'
            },
            'language-not-supported': {
                code: 'language-not-supported',
                title: 'زبان فارسی روی این دستگاه نصب نیست',
                message: 'گویا بسته تشخیص گفتار فارسی روی این گوشی نصب یا به‌روزرسانی نشده. در اپ Google، تنظیمات > صدا > Offline speech recognition را بررسی کنید، یا دستور را تایپ کنید.'
            },
            'audio-capture': {
                code: 'audio-capture',
                title: 'میکروفون در دسترس نیست',
                message: 'مطمئن شوید میکروفون به دستگاه متصل و توسط برنامه دیگری اشغال نشده است.'
            },
            'network': {
                code: 'network',
                title: 'اتصال اینترنت لازم است',
                message: 'تشخیص صدا برخلاف بقیه FoxiMed به اینترنت نیاز دارد. لطفاً اتصال خود را بررسی کنید یا دستور را تایپ کنید.'
            },
            'aborted': {
                code: 'aborted',
                title: null,
                message: null,
                silent: true
            },
            'timeout': {
                code: 'timeout',
                title: 'پاسخی دریافت نشد',
                message: 'به‌نظر می‌رسد تشخیص صدا پاسخ نداد. دوباره تلاش کنید یا دستور را تایپ کنید.'
            },
            'vosk-lib-failed': {
                code: 'vosk-lib-failed',
                title: 'بارگذاری موتور صوتی ناموفق بود',
                message: 'کتابخانه تشخیص گفتار آفلاین بارگذاری نشد. اتصال اینترنت را برای اولین بارگذاری بررسی کنید یا دستور را تایپ کنید.'
            },
            'vosk-model-failed': {
                code: 'vosk-model-failed',
                title: 'مدل صوتی آفلاین بارگذاری نشد',
                message: 'دانلود یا بارگذاری مدل تشخیص گفتار ناموفق بود. اتصال اینترنت را بررسی کنید یا دستور را تایپ کنید.'
            },
            'vosk-not-configured': {
                code: 'vosk-not-configured',
                title: null,
                message: null,
                silent: true
            },
            'vosk-runtime': {
                code: 'vosk-runtime',
                title: 'خطا در تشخیص گفتار آفلاین',
                message: 'مشکلی در پردازش صدا رخ داد. دوباره تلاش کنید یا دستور را تایپ کنید.'
            }
        };
        return map[rawCode] || {
            code: rawCode || 'unknown',
            title: 'خطا در تشخیص صدا',
            message: 'یک خطای ناشناخته رخ داد. می‌توانید دستور را تایپ کنید.'
        };
    }

    // ============================================
    // STATE
    // ============================================
    let recognition = null;
    let active = false;
    let startWatchdog = null;   // fires if `onstart` never happens (silent iOS hang)
    let silenceWatchdog = null; // fires if no interim/final result for too long
    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let rafId = null;
    const listeners = {};

    // --- Vosk backend state ---
    let voskActive = false;
    let voskLoading = false;
    let voskCancelRequested = false;
    let voskLibLoadPromise = null;
    let voskModel = null;
    let voskModelLoadPromise = null;
    let voskFailInfo = null;     // set if model/lib failed to load this session
    let voskRecognizer = null;
    let voskAudioCtx = null;
    let voskSource = null;
    let voskProcessor = null;
    let voskStream = null;
    let voskStopTimer = null;
    let voskSilenceWatchdog = null;
    let triedVoskFallback = false; // reset at the start of each fresh start() call

    function on(event, handler) { listeners[event] = handler; return api; }
    function emit(event, payload) { if (typeof listeners[event] === 'function') listeners[event](payload); }

    function clearWatchdogs() {
        if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
        if (silenceWatchdog) { clearTimeout(silenceWatchdog); silenceWatchdog = null; }
    }

    // If native recognition shows a clear sign of being broken on this
    // device — not just "didn't hear anything" — silently switch to the
    // Vosk backend instead of just reporting an error, IF it's configured.
    // This is what actually makes voice "certainly work" across the wide
    // variety of Android devices/OEM browsers out there: native speech
    // recognition quality and availability varies a lot by device (missing
    // language packs, OEM browser quirks, etc.), but Vosk doesn't depend on
    // any of that — it ships its own model, so it works the same way
    // everywhere once downloaded. Only one fallback attempt per start() —
    // this never ping-pongs between backends.
    function maybeFallbackToVosk(errorCode) {
        if (triedVoskFallback) return false;
        if (!voskConfigured()) return false;
        if (errorCode === 'network' && !voskModel) return false; // would just fail again with no model cached yet
        const FALLBACK_CODES = { 'service-not-allowed': 1, 'language-not-supported': 1, 'timeout': 1, 'network': 1 };
        if (!FALLBACK_CODES[errorCode]) return false;
        triedVoskFallback = true;
        stopWebSpeech();
        startVosk();
        return true;
    }

    function armSilenceWatchdog() {
        if (silenceWatchdog) clearTimeout(silenceWatchdog);
        silenceWatchdog = setTimeout(function () {
            if (active) {
                if (maybeFallbackToVosk('timeout')) return;
                emit('error', classifyError('timeout'));
                stopWebSpeech();
            }
        }, 8000);
    }

    // ============================================
    // AUDIO METERING (Web Audio API)
    // Purely cosmetic/feedback — independent of SpeechRecognition working.
    // ============================================
    function attachAudioMeter() {
        if (!ENV.hasGetUserMedia || !ENV.hasAudioContext) return;
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (stream) {
                micStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AC();
                const source = audioCtx.createMediaStreamSource(stream);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 64;
                analyser.smoothingTimeConstant = 0.7;
                source.connect(analyser);
                pumpAudioFrames();
            })
            .catch(function () {
                // No mic stream for visualization — UI falls back to a
                // gentle decorative animation. Not a fatal problem.
            });
    }

    function pumpAudioFrames() {
        if (!analyser || !active) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);

        // Down-sample the frequency bins into 12 bars for the UI.
        const bars = 12;
        const bins = [];
        const chunk = Math.floor(data.length / bars) || 1;
        let levelSum = 0;
        for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < chunk; j++) sum += data[i * chunk + j] || 0;
            const avg = sum / chunk / 255; // 0..1
            bins.push(avg);
            levelSum += avg;
        }
        const level = Math.min(1, levelSum / bars);
        emit('audio', { bins: bins, level: level });
        rafId = requestAnimationFrame(pumpAudioFrames);
    }

    function releaseAudioMeter() {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (micStream) {
            try { micStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
            micStream = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch (e) {}
            audioCtx = null;
        }
        analyser = null;
    }

    // ============================================
    // BACKEND 1: NATIVE WEB SPEECH API
    // ============================================
    function startWebSpeech(langOverride) {
        if (active) return;

        const support = getSupportInfo();
        if (support.status === 'blocked') {
            emit('error', { code: support.code, title: support.title, message: support.message });
            return;
        }
        if (!ENV.isOnline) {
            emit('error', classifyError('network'));
            return;
        }

        // A ?testlang=en-US URL parameter overrides the language for quick
        // diagnostics (e.g. checking whether a device's speech service
        // works at all in English when Persian silently produces nothing)
        // without needing to edit and redeploy code each time.
        let urlTestLang = null;
        try { urlTestLang = new URLSearchParams(window.location.search).get('testlang'); } catch (e) {}

        const langToUse = langOverride || urlTestLang || 'fa-IR';
        const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognitionImpl();
        recognition.lang = langToUse;
        // iOS WebKit has long-standing bugs with continuous mode (hangs /
        // never stops listening) — only enable continuous + auto-restart
        // on non-iOS platforms.
        recognition.continuous = !ENV.isIOS;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = function () {
            active = true;
            if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
            armSilenceWatchdog();
            emit('start');
            // Microphone level metering for the UI — requested only now,
            // after the recognition engine itself has confirmed it has the
            // mic. Some older Android/WebView combinations appear to
            // mis-arbitrate two near-simultaneous mic permission requests
            // (one implicit inside SpeechRecognition, one explicit from a
            // separate getUserMedia call), reporting the recognition's own
            // permission as denied even though the user never saw a second
            // prompt. Waiting for onstart removes that race entirely.
            attachAudioMeter();
        };

        recognition.onresult = function (event) {
            armSilenceWatchdog(); // we're getting signal — push the timeout back
            let interim = '';
            let final = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) final += transcript;
                else interim += transcript;
            }
            if (final.trim()) {
                emit('final', final.trim());
                stopWebSpeech();
            } else if (interim.trim()) {
                emit('interim', interim.trim());
            }
        };

        recognition.onerror = function (event) {
            // Some Android speech services are picky about the exact
            // locale tag — if "fa-IR" is reported as unsupported, silently
            // retry once with the bare "fa" before giving up on native
            // recognition entirely (and falling back further, below).
            if (event.error === 'language-not-supported' && langToUse === 'fa-IR') {
                active = false;
                clearWatchdogs();
                releaseAudioMeter();
                startWebSpeech('fa');
                return;
            }
            if (maybeFallbackToVosk(event.error)) return;
            const info = classifyError(event.error);
            if (!info.silent) emit('error', info);
            stopWebSpeech();
        };

        recognition.onend = function () {
            clearWatchdogs();
            // Android/Chrome sometimes ends a "continuous" session on its
            // own (e.g. brief silence) — restart transparently. iOS must
            // never auto-restart on its own (it can re-trigger permission
            // prompts and hang).
            if (active && !ENV.isIOS) {
                try { recognition.start(); return; } catch (e) { /* fall through */ }
            }
            active = false;
            releaseAudioMeter();
            emit('end');
        };

        // --- Critical for iOS: call start() synchronously, directly from
        // the user-gesture call stack. Do NOT await getUserMedia or any
        // other promise before this call — iOS WebKit only honors the
        // "real user activation" required by SpeechRecognition.start()
        // when nothing asynchronous has happened first. ---
        try {
            recognition.start();
        } catch (e) {
            emit('error', classifyError('start-failed'));
            return;
        }

        // Safety net: if onstart never fires (a known silent-hang on some
        // iOS versions), recover instead of leaving the UI stuck "listening".
        startWatchdog = setTimeout(function () {
            if (!active) {
                if (maybeFallbackToVosk('timeout')) return;
                emit('error', classifyError('timeout'));
                stopWebSpeech();
            }
        }, 5000);
    }

    function stopWebSpeech() {
        clearWatchdogs();
        const wasActive = active;
        active = false;
        if (recognition) {
            try { recognition.stop(); } catch (e) {}
            try { recognition.abort && recognition.abort(); } catch (e) {}
        }
        releaseAudioMeter();
        if (wasActive) emit('end');
    }

    // ============================================
    // BACKEND 2: VOSK (offline, on-device — used on iOS)
    // ============================================
    function loadScriptOnce(url) {
        const existing = document.querySelector('script[data-foximed-src="' + url + '"]');
        if (existing) {
            if (existing.dataset.loaded === 'true') return Promise.resolve();
            return new Promise(function (resolve, reject) {
                existing.addEventListener('load', resolve);
                existing.addEventListener('error', function () { reject(new Error('script-load-failed')); });
            });
        }
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.dataset.foximedSrc = url;
            s.onload = function () { s.dataset.loaded = 'true'; resolve(); };
            s.onerror = function () { reject(new Error('script-load-failed')); };
            document.head.appendChild(s);
        });
    }

    function ensureVoskLib() {
        if (window.Vosk) return Promise.resolve();
        if (!voskLibLoadPromise) voskLibLoadPromise = loadScriptOnce(VOSK_LIB_URL);
        return voskLibLoadPromise;
    }

    // Fetches the model with real byte-level progress, and — this is the
    // important part for unstable connections — automatically retries on
    // a stall or dropped connection by resuming from where it left off via
    // an HTTP Range request, instead of restarting the whole 53MB from
    // zero. Falls back to a full restart only if the server doesn't honor
    // Range requests. A single fixed timeout can't fix "the connection
    // drops partway through" — this is built specifically for that case.
    //
    // Uses XMLHttpRequest rather than fetch()+ReadableStream on purpose:
    // XHR's `progress` event is a much older, simpler mechanism that
    // doesn't depend on the Streams API being fully supported — fetch's
    // streaming response body (`response.body.getReader()`) has a less
    // consistent track record across Safari versions, which matters here
    // given everything else we've already run into on iOS specifically.
    //
    // responseType is 'arraybuffer', not 'blob' — confirmed via real
    // on-device testing that this is the more memory-predictable choice
    // on iOS WebKit. Letting the browser manage Blob materialization
    // internally during a large streamed response appears less reliable
    // than collecting raw bytes ourselves and constructing exactly one
    // Blob at the very end.
    function fetchModelWithProgress(url, onProgress) {
        const MAX_ATTEMPTS = 6;
        const STALL_TIMEOUT_MS = 25000; // no new data for 25s on one attempt -> abort & retry
        let chunks = [];
        let loaded = 0;
        let total = 0;

        function parseRangeTotal(rangeHeader) {
            const match = rangeHeader && rangeHeader.match(/\/(\d+)$/);
            return match ? parseInt(match[1], 10) : null;
        }

        function attempt(attemptNum) {
            return new Promise(function (resolve, reject) {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                if (loaded > 0) xhr.setRequestHeader('Range', 'bytes=' + loaded + '-');

                let stallTimer = null;
                function armStall() {
                    if (stallTimer) clearTimeout(stallTimer);
                    stallTimer = setTimeout(function () { xhr.abort(); }, STALL_TIMEOUT_MS);
                }
                armStall();

                xhr.onprogress = function (e) {
                    armStall();
                    if (!total) {
                        const isPartial = xhr.status === 206;
                        total = (isPartial ? parseRangeTotal(xhr.getResponseHeader('Content-Range')) : e.total) || 0;
                    }
                    const currentLoaded = loaded + e.loaded;
                    if (typeof onProgress === 'function') {
                        onProgress({ loaded: currentLoaded, total: total, percent: total ? Math.round(currentLoaded / total * 100) : null });
                    }
                };

                xhr.onload = function () {
                    clearTimeout(stallTimer);
                    if (xhr.status !== 200 && xhr.status !== 206) {
                        reject(new Error('http-' + xhr.status));
                        return;
                    }
                    const responseData = xhr.response;
                    if (!responseData) { reject(new Error('empty-response')); return; }
                    if (xhr.status === 206 && loaded > 0) {
                        chunks.push(new Uint8Array(responseData));
                        loaded += responseData.byteLength;
                    } else {
                        // Either the first attempt, or the server ignored
                        // our Range request and sent the whole file again.
                        chunks = [new Uint8Array(responseData)];
                        loaded = responseData.byteLength;
                    }
                    total = total || loaded;
                    resolve();
                };
                xhr.onerror = function () { clearTimeout(stallTimer); reject(new Error('xhr-network-error')); };
                xhr.onabort = function () { clearTimeout(stallTimer); reject(new Error('xhr-stalled')); };

                xhr.send();
            }).catch(function (err) {
                if (attemptNum >= MAX_ATTEMPTS) throw err;
                // Brief pause before retrying — resumes from `loaded` bytes
                // via the Range header above, not from scratch.
                return new Promise(function (resolve) { setTimeout(resolve, 1500); })
                    .then(function () { return attempt(attemptNum + 1); });
            });
        }

        return attempt(1).then(function () { return new Blob(chunks); });
    }

    function ensureVoskModel() {
        if (voskModel) return Promise.resolve(voskModel);
        if (voskModelLoadPromise) return voskModelLoadPromise;
        emit('model-loading');

        function loadBlob() {
            if (!window.caches) return fetchModelWithProgress(VOSK_MODEL_URL, onModelProgress);
            return caches.open(VOSK_CACHE_NAME).then(function (cache) {
                return cache.match(VOSK_MODEL_URL).then(function (cached) {
                    if (cached) {
                        emit('model-progress', { loaded: 1, total: 1, percent: 100, fromCache: true });
                        return cached.blob();
                    }
                    return fetchModelWithProgress(VOSK_MODEL_URL, onModelProgress).then(function (blob) {
                        try {
                            const putPromise = cache.put(VOSK_MODEL_URL, new Response(blob));
                            if (putPromise && typeof putPromise.catch === 'function') {
                                putPromise.catch(function () { /* quota or unsupported — non-fatal, model still works this session */ });
                            }
                        } catch (e) { /* synchronous failure — also non-fatal */ }
                        return blob;
                    });
                });
            }).catch(function () {
                // Cache API unavailable for some reason — fetch without it.
                return fetchModelWithProgress(VOSK_MODEL_URL, onModelProgress);
            });
        }
        function onModelProgress(progress) { emit('model-progress', progress); }

        const loadChain = ensureVoskLib()
            .catch(function () { throw classifyError('vosk-lib-failed'); })
            .then(loadBlob)
            .then(function (blob) {
                const blobUrl = URL.createObjectURL(blob);
                function releaseBlobUrl() { try { URL.revokeObjectURL(blobUrl); } catch (e) {} }
                return window.Vosk.createModel(blobUrl)
                    .then(function (model) { releaseBlobUrl(); return model; })
                    .catch(function () {
                        releaseBlobUrl();
                        // Not verifiable without a live device: some browsers'
                        // internal Worker may be unable to resolve a blob: URL
                        // created on the main thread. If creating the model
                        // from our pre-fetched blob fails, fall back to letting
                        // the library fetch the plain URL itself directly —
                        // by now it's likely sitting in the normal browser HTTP
                        // cache anyway from the fetch we just did.
                        return window.Vosk.createModel(VOSK_MODEL_URL);
                    });
            })
            .then(function (model) {
                voskModel = model;
                voskFailInfo = null;
                // Catch errors that occur *after* the initial load too
                // (e.g. a Worker crash mid-session), not just load failure.
                model.on('error', function () {
                    emit('error', classifyError('vosk-runtime'));
                });
                emit('model-ready');
                return model;
            });

        // The retry logic above already handles ordinary stalls/drops —
        // this outer cap only exists to eventually give up on something
        // truly stuck (e.g. eight straight Range-resume cycles still going
        // nowhere), so it's set generously rather than tuned tightly.
        const timeoutChain = new Promise(function (_, reject) {
            setTimeout(function () { reject(classifyError('vosk-model-failed')); }, VOSK_MODEL_TIMEOUT_MS);
        });

        voskModelLoadPromise = Promise.race([loadChain, timeoutChain])
            .catch(function (err) {
                voskModelLoadPromise = null;
                const info = (err && err.code) ? err : classifyError('vosk-model-failed');
                voskFailInfo = { status: 'limited', code: info.code, title: info.title, message: info.message };
                throw info;
            });
        return voskModelLoadPromise;
    }

    function startVosk() {
        if (voskActive || voskLoading) return;
        if (!voskConfigured()) {
            // Silent — getSupportInfo() already steered the UI toward the
            // native-API / banner path in this case, so this should not
            // normally be reachable.
            emit('error', classifyError('vosk-not-configured'));
            return;
        }

        voskLoading = true;
        voskCancelRequested = false;

        ensureVoskModel().then(function (model) {
            if (voskCancelRequested) { voskLoading = false; return; }
            let recognizer;
            // Bias the decoder toward FoxiMed's actual vocabulary (drug
            // names, command words, numbers, units) — it can still freely
            // combine these in whatever order someone speaks them, it's
            // not limited to exact pre-written phrases.
            //
            // OFF BY DEFAULT as of this version: real testing showed it
            // can force wrong output for anything outside the list rather
            // than just biasing toward known words — e.g. saying "سلام"
            // (not in the vocabulary at all) was heard as "صد تا", which
            // *is* built entirely from two words that ARE in the list
            // ("صد" and "تا"). That's the constrained grammar forcing a
            // best-fit substitution instead of recognizing normal speech.
            // Add ?grammar=1 to the URL to opt back in and experiment —
            // worth retrying once the vocabulary list covers more of what
            // people actually say, including casual speech, not just
            // clinical terms.
            let grammar = null;
            let forceGrammarOn = false;
            try { forceGrammarOn = new URLSearchParams(window.location.search).get('grammar') === '1'; } catch (e) {}
            if (forceGrammarOn) {
                try {
                    if (window.VoiceCommands && typeof window.VoiceCommands.getGrammar === 'function') {
                        grammar = window.VoiceCommands.getGrammar();
                    }
                } catch (e) { grammar = null; }
            }

            try {
                recognizer = grammar ? new model.KaldiRecognizer(16000, grammar) : new model.KaldiRecognizer(16000);
            } catch (e) {
                try {
                    recognizer = new model.KaldiRecognizer(16000); // retry without grammar
                } catch (e2) {
                    voskLoading = false;
                    emit('error', classifyError('vosk-runtime'));
                    return;
                }
            }
            voskRecognizer = recognizer;

            recognizer.on('partialresult', function (message) {
                const partial = message && message.result && message.result.partial;
                if (partial && partial.trim()) {
                    armVoskSilenceWatchdog();
                    emit('interim', partial.trim());
                }
            });
            recognizer.on('result', function (message) {
                const text = message && message.result && message.result.text;
                if (text && text.trim()) {
                    emit('final', text.trim());
                }
                finishVosk();
            });
            recognizer.on('error', function () {
                emit('error', classifyError('vosk-runtime'));
                finishVosk();
            });

            navigator.mediaDevices.getUserMedia({
                video: false,
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 16000 }
            }).then(function (stream) {
                voskLoading = false;
                if (voskCancelRequested || voskRecognizer !== recognizer) {
                    // stop() was called before the mic permission resolved
                    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                    try { recognizer.remove(); } catch (e) {}
                    if (voskRecognizer === recognizer) voskRecognizer = null;
                    return;
                }
                voskStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                voskAudioCtx = new AC();
                voskSource = voskAudioCtx.createMediaStreamSource(stream);
                // ScriptProcessorNode is deprecated but is what vosk-browser's
                // own documented example uses, and it's still broadly
                // supported (including current iOS Safari). It must be
                // connected through to a destination for onaudioprocess to
                // reliably fire in every browser, hence the (silent, since
                // echoCancellation is on) connection below.
                voskProcessor = voskAudioCtx.createScriptProcessor(4096, 1, 1);
                voskProcessor.onaudioprocess = function (event) {
                    try { recognizer.acceptWaveform(event.inputBuffer); } catch (e) {}
                    emitVoskAudioLevel(event.inputBuffer);
                };
                voskSource.connect(voskProcessor);
                voskProcessor.connect(voskAudioCtx.destination);

                voskActive = true;
                armVoskSilenceWatchdog();
                emit('start');
            }).catch(function (err) {
                voskLoading = false;
                const code = (err && err.name === 'NotAllowedError') ? 'not-allowed'
                    : (err && err.name === 'NotFoundError') ? 'audio-capture' : 'vosk-runtime';
                emit('error', classifyError(code));
                try { recognizer.remove(); } catch (e) {}
                voskRecognizer = null;
            });
        }).catch(function (info) {
            voskLoading = false;
            emit('error', info && info.code ? info : classifyError('vosk-model-failed'));
        });
    }

    function emitVoskAudioLevel(buffer) {
        const data = buffer.getChannelData(0);
        const bars = 12;
        const chunk = Math.floor(data.length / bars) || 1;
        const bins = [];
        let levelSum = 0;
        for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < chunk; j++) sum += Math.abs(data[i * chunk + j] || 0);
            const avg = Math.min(1, (sum / chunk) * 4); // crude gain so quiet speech still animates
            bins.push(avg);
            levelSum += avg;
        }
        emit('audio', { bins: bins, level: Math.min(1, levelSum / bars) });
    }

    function armVoskSilenceWatchdog() {
        if (voskSilenceWatchdog) clearTimeout(voskSilenceWatchdog);
        voskSilenceWatchdog = setTimeout(function () {
            if (voskActive) {
                emit('error', classifyError('timeout'));
                stopVosk();
            }
        }, 8000);
    }

    function stopVosk() {
        if (voskLoading) {
            voskCancelRequested = true; // unwound inside startVosk()'s pending chain
            return;
        }
        if (!voskActive && !voskRecognizer) return;
        if (voskSilenceWatchdog) { clearTimeout(voskSilenceWatchdog); voskSilenceWatchdog = null; }
        if (voskRecognizer) {
            // Ask for whatever was captured so far before tearing down, so a
            // manual stop mid-sentence doesn't just throw the words away.
            try { voskRecognizer.retrieveFinalResult(); } catch (e) {}
            voskStopTimer = setTimeout(finishVosk, 1200);
        } else {
            finishVosk();
        }
    }

    function finishVosk() {
        if (voskStopTimer) { clearTimeout(voskStopTimer); voskStopTimer = null; }
        const wasActive = voskActive;
        voskActive = false;
        if (voskProcessor) { try { voskProcessor.disconnect(); } catch (e) {} voskProcessor = null; }
        if (voskSource) { try { voskSource.disconnect(); } catch (e) {} voskSource = null; }
        if (voskAudioCtx) { try { voskAudioCtx.close(); } catch (e) {} voskAudioCtx = null; }
        if (voskStream) { try { voskStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} voskStream = null; }
        if (voskRecognizer) { try { voskRecognizer.remove(); } catch (e) {} voskRecognizer = null; }
        if (wasActive) emit('end');
    }

    // ============================================
    // UNIFIED DISPATCHER
    // ============================================
    function pickBackend() {
        return (ENV.isIOS && voskConfigured()) ? 'vosk' : 'webspeech';
    }

    function start() {
        if (active || voskActive || voskLoading) return;
        triedVoskFallback = false;
        if (pickBackend() === 'vosk') startVosk(); else startWebSpeech();
    }

    function stop() {
        // Check actual runtime state rather than just the static platform
        // choice — a session that fell back from webspeech to Vosk mid-
        // flight (see maybeFallbackToVosk) is now genuinely running Vosk
        // even on a platform where pickBackend() would normally say
        // "webspeech", so stopping the wrong one would leave it running.
        if (voskActive || voskLoading) { stopVosk(); return; }
        if (active) { stopWebSpeech(); return; }
        if (pickBackend() === 'vosk') stopVosk(); else stopWebSpeech();
    }

    // Stop listening if the app is backgrounded/locked — prevents a
    // recognition session (and an open mic) from lingering forever.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && (active || voskActive || voskLoading)) stop();
    });

    window.addEventListener('offline', function () {
        if (active) {
            emit('error', classifyError('network'));
            stop();
        }
        // Note: the Vosk backend deliberately keeps running when offline —
        // once its model is loaded it needs no network at all.
    });

    // ============================================
    // PUBLIC API
    // ============================================
    const api = {
        ENV: ENV,
        getSupportInfo: getSupportInfo,
        start: start,
        stop: stop,
        isActive: function () { return active || voskActive || voskLoading; },
        on: on,
        openInSafari: function () {
            // Standalone PWAs on iOS have no tabs/windows of their own, so
            // opening the current URL via window.open kicks the user out
            // into a real Safari tab — this is the standard workaround for
            // APIs (like full SpeechRecognition support) that only behave
            // correctly outside of "Add to Home Screen" mode.
            try { window.open(window.location.href, '_blank'); }
            catch (e) { window.location.href = window.location.href; }
        }
    };

    window.VoiceEngine = api;
})(window);
