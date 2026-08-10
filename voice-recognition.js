/* ============================================
   FoxiMed — Voice Engine
   ============================================
   Low-level speech capture layer with TWO interchangeable backends:

     1. "webspeech" — the native browser SpeechRecognition API. Used on
        Android / desktop / macOS Safari, where it's fast and needs no
        download.

     2. "koochik" — an offline, on-device ONNX speech engine (Shenava
        Koochik v1.0, a Persian FastConformer CTC model, run in-browser
        via onnxruntime-web — see koochik-asr.js). Used on iOS, because
        Apple's WebKit SpeechRecognition implementation is unreliable —
        especially once the PWA is installed to the Home Screen, where it
        frequently fails outright. Koochik never touches that API at all,
        so it works the same whether the app is in a Safari tab or
        installed. (This replaced an earlier Vosk-based backend — Koochik
        benchmarked meaningfully more accurate on Persian, at ~70x faster
        decode.)

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

   --- SETUP REQUIRED FOR THE KOOCHIK (iOS) BACKEND ---
   Set KOOCHIK_MODEL_URL / KOOCHIK_TOKENS_URL / KOOCHIK_MEL_FILTERS_URL
   below to your own hosted copies of the three Koochik assets. Until
   those are set, iOS falls back to the native API + the existing
   "open in Safari / type instead" guidance, so nothing breaks if you
   deploy before the model is ready.

   WHICH MODEL: Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16 — the 114M-param
   FastConformer CTC export (NOT the v1.5 RNNT export, which is a
   different encoder/decoder/joiner split this engine doesn't use).

   You need three files, hosted same-origin (no CORS step) with a long
   Cache-Control (e.g. max-age=31536000, immutable) so repeat visits
   don't re-download:
     1. The Koochik ONNX model file (fp16) — this is likely well over
        100MB; confirm the real download size before shipping and
        decide if that's acceptable on your users' connections. This
        is bigger than the old Vosk model (53MB) even though it
        decodes far faster once loaded.
     2. tokens.json — array of 1025 token strings indexed by id
        (id 1024 is the CTC blank).
     3. mel_filters_slaney_80x257.json — Koochik's own exported Slaney
        mel filterbank. Use their file as-is; don't re-derive it.

   This integration could not be end-to-end tested here (no iOS device,
   no microphone, no real model download in this sandbox, and the exact
   asset URLs are placeholders below) — the code follows the model's
   documented tensor contract and preprocessing spec exactly, but please
   test for real on-device before relying on it.
   ============================================ */
(function (window) {
    'use strict';

    // Mehdi: put your asset URLs here.
    //
    // MODEL: the ~230MB fp16 file is too big for a normal GitHub push
    // (GitHub blocks non-LFS files over 100MB), so this points at Hugging
    // Face's own CDN directly rather than self-hosting it — that CDN is
    // built for exactly this (it's what transformers.js-style browser ML
    // apps do), has proper CORS, and no meaningful bandwidth cap. Use the
    // "_embedded.onnx" single-file export, not the split
    // ".onnx" + ".onnx.data" pair — one URL, one fetch, no external-data
    // loading to wire up.
    //   IMPORTANT: verify this exact filename against the repo's own file
    //   listing (huggingface.co/Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16/
    //   tree/main) before relying on it — I couldn't independently
    //   confirm it from here, only cross-check what you were told
    //   elsewhere, so a typo or a renamed file would fail silently as a
    //   404 without this being caught first.
    // TOKENS / MEL FILTERS: these are tiny (~15KB / ~91KB) — bundle them
    // with the rest of the app instead (e.g. an icons/ subfolder like
    // your other static assets), so they ship with your normal deploy
    // and get precached by the service worker like everything else. No
    // reason to fetch these from a different origin.
    // Leave KOOCHIK_MODEL_URL empty to keep the current native-API/banner
    // behavior on iOS.
    const KOOCHIK_MODEL_URL = 'https://huggingface.co/Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16/resolve/main/shenava_koochik_1_0_ctc_fixed2005_len_att70_13_fp16_full_io_embedded.onnx';
    const KOOCHIK_TOKENS_URL = './icons/koochik-tokens.json';
    const KOOCHIK_MEL_FILTERS_URL = './icons/mel_filters_slaney_80x257.json';
    const KOOCHIK_ORT_LIB_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/ort.min.js';
    const KOOCHIK_ORT_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/';
    // How long to wait for the model download before giving up. Raise this
    // further if your users are on consistently slow connections — there's
    // no real downside to being patient here, it only delays the *failure*
    // message on a genuinely dead connection, it doesn't block anything
    // else in the app.
    const KOOCHIK_MODEL_TIMEOUT_MS = 15 * 60 * 1000; // generous outer backstop; a ~230MB fetch legitimately needs more headroom than the old 53MB Vosk model did
    const KOOCHIK_CACHE_NAME = 'foximed-koochik-model-v1';
    // How often to re-run inference on the buffered audio to produce a
    // live-feeling partial result. Koochik is an offline (non-streaming)
    // CTC model under the hood — "streaming" here means periodically
    // re-decoding the growing buffer, the same approach Shenava's own
    // browser demo uses. Kept modest since each decode is ~10ms of
    // compute but there's still buffer-materialization overhead.
    const KOOCHIK_PARTIAL_INTERVAL_MS = 700;

    function koochikConfigured() { return !!(KOOCHIK_MODEL_URL && KOOCHIK_TOKENS_URL && KOOCHIK_MEL_FILTERS_URL); }

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
        if (koochikConfigured()) {
            if (koochikFailInfo) return koochikFailInfo;
            // Koochik doesn't touch WebKit's SpeechRecognition at all, so
            // the standalone-PWA restriction simply doesn't apply here.
            return { status: 'ok', code: 'koochik', title: null, message: null };
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
            'koochik-lib-failed': {
                code: 'koochik-lib-failed',
                title: 'بارگذاری موتور صوتی ناموفق بود',
                message: 'کتابخانه تشخیص گفتار آفلاین بارگذاری نشد. اتصال اینترنت را برای اولین بارگذاری بررسی کنید یا دستور را تایپ کنید.'
            },
            'koochik-model-failed': {
                code: 'koochik-model-failed',
                title: 'مدل صوتی آفلاین بارگذاری نشد',
                message: 'دانلود یا بارگذاری مدل تشخیص گفتار ناموفق بود. اتصال اینترنت را بررسی کنید یا دستور را تایپ کنید.'
            },
            'koochik-not-configured': {
                code: 'koochik-not-configured',
                title: null,
                message: null,
                silent: true
            },
            'koochik-runtime': {
                code: 'koochik-runtime',
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

    // --- Koochik backend state ---
    let koochikActive = false;
    let koochikLoading = false;
    let koochikCancelRequested = false;
    let koochikEngine = null;
    let koochikEngineLoadPromise = null;
    let koochikFailInfo = null;     // set if model/lib failed to load this session
    let koochikAudioCtx = null;
    let koochikSource = null;
    let koochikProcessor = null;
    let koochikStream = null;
    let koochikStopTimer = null;
    let koochikSilenceWatchdog = null;
    let koochikPartialTimer = null;
    let koochikDecodeInFlight = false;
    let koochikLastEmitted = '';
    let triedKoochikFallback = false; // reset at the start of each fresh start() call
    let modelLoadCancelled = false; // set by cancelPreload() below — lets the loading screen actually STOP a background model download/instantiation instead of just walking away from it

    function on(event, handler) { listeners[event] = handler; return api; }
    function emit(event, payload) { if (typeof listeners[event] === 'function') listeners[event](payload); }

    function clearWatchdogs() {
        if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
        if (silenceWatchdog) { clearTimeout(silenceWatchdog); silenceWatchdog = null; }
    }

    // If native recognition shows a clear sign of being broken on this
    // device — not just "didn't hear anything" — silently switch to the
    // Koochik backend instead of just reporting an error, IF it's
    // configured. This is what actually makes voice "certainly work"
    // across the wide variety of Android devices/OEM browsers out there:
    // native speech recognition quality and availability varies a lot by
    // device (missing language packs, OEM browser quirks, etc.), but
    // Koochik doesn't depend on any of that — it ships its own model, so
    // it works the same way everywhere once downloaded. Only one fallback
    // attempt per start() — this never ping-pongs between backends.
    function maybeFallbackToKoochik(errorCode) {
        if (triedKoochikFallback) return false;
        if (!koochikConfigured()) return false;
        if (errorCode === 'network' && !koochikEngine) return false; // would just fail again with no model cached yet
        const FALLBACK_CODES = { 'service-not-allowed': 1, 'language-not-supported': 1, 'timeout': 1, 'network': 1 };
        if (!FALLBACK_CODES[errorCode]) return false;
        triedKoochikFallback = true;
        stopWebSpeech();
        startKoochik();
        return true;
    }

    function armSilenceWatchdog() {
        if (silenceWatchdog) clearTimeout(silenceWatchdog);
        silenceWatchdog = setTimeout(function () {
            if (active) {
                if (maybeFallbackToKoochik('timeout')) return;
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

    let lastWebSpeechAudioEmit = 0;
    let analyserDataBuffer = null;

    function pumpAudioFrames() {
        if (!analyser || !active) return;
        if (Date.now() - lastWebSpeechAudioEmit < AUDIO_LEVEL_THROTTLE_MS) {
            rafId = requestAnimationFrame(pumpAudioFrames);
            return;
        }
        lastWebSpeechAudioEmit = Date.now();
        if (!analyserDataBuffer || analyserDataBuffer.length !== analyser.frequencyBinCount) {
            analyserDataBuffer = new Uint8Array(analyser.frequencyBinCount);
        }
        const data = analyserDataBuffer;
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
            if (maybeFallbackToKoochik(event.error)) return;
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
                if (maybeFallbackToKoochik('timeout')) return;
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
    // BACKEND 2: KOOCHIK (offline, on-device CTC ASR — used on iOS)
    // Driven by koochik-asr.js, which owns feature extraction, ONNX
    // inference (via onnxruntime-web), and greedy CTC decoding. This
    // file only owns: mic capture, buffering audio into the engine,
    // deciding when to ask for a partial vs. final decode, and mapping
    // engine output onto the same event contract webspeech/vosk used.
    // ============================================
    function ensureKoochikEngine() {
        if (koochikEngine) return Promise.resolve(koochikEngine);
        if (koochikEngineLoadPromise) return koochikEngineLoadPromise;

        modelLoadCancelled = false; // fresh load attempt — clear any earlier cancellation

        const loadChain = window.KoochikASR
            ? Promise.resolve()
            : Promise.reject(classifyError('koochik-lib-failed'));

        koochikEngineLoadPromise = loadChain
            .then(function () {
                return window.KoochikASR.load({
                    modelUrl: KOOCHIK_MODEL_URL,
                    tokensUrl: KOOCHIK_TOKENS_URL,
                    melFiltersUrl: KOOCHIK_MEL_FILTERS_URL,
                    ortLibUrl: KOOCHIK_ORT_LIB_URL,
                    ortWasmBaseUrl: KOOCHIK_ORT_WASM_BASE_URL,
                    cacheName: KOOCHIK_CACHE_NAME
                }, function (progress) {
                    if (modelLoadCancelled) return;
                    emit('model-progress', progress);
                });
            })
            .then(function (engine) {
                if (modelLoadCancelled) { throw new Error('cancelled'); }
                koochikEngine = engine;
                koochikFailInfo = null;
                emit('model-ready');
                return engine;
            })
            .catch(function (err) {
                koochikEngineLoadPromise = null;
                const info = (err && err.code) ? err : classifyError('koochik-model-failed');
                if (!(err && err.message === 'cancelled')) {
                    koochikFailInfo = { status: 'limited', code: info.code, title: info.title, message: info.message };
                }
                throw info;
            });

        // Outer backstop, same role as the old Vosk timeout — the model
        // file is fetched with browser-native fetch() (which the browser
        // itself already retries/resumes reasonably well via HTTP cache),
        // so this exists purely to eventually give up on something truly
        // stuck rather than to drive retries itself.
        const timeoutChain = new Promise(function (_, reject) {
            setTimeout(function () { reject(classifyError('koochik-model-failed')); }, KOOCHIK_MODEL_TIMEOUT_MS);
        });
        return Promise.race([koochikEngineLoadPromise, timeoutChain]);
    }

    function startKoochik() {
        if (koochikActive || koochikLoading) return;
        if (!koochikConfigured()) {
            // Silent — getSupportInfo() already steered the UI toward the
            // native-API / banner path in this case, so this should not
            // normally be reachable.
            emit('error', classifyError('koochik-not-configured'));
            return;
        }

        koochikLoading = true;
        koochikCancelRequested = false;

        ensureKoochikEngine().then(function (engine) {
            if (koochikCancelRequested) { koochikLoading = false; return; }
            engine.reset();
            koochikLastEmitted = '';

            navigator.mediaDevices.getUserMedia({
                video: false,
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
            }).then(function (stream) {
                koochikLoading = false;
                if (koochikCancelRequested) {
                    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                    return;
                }
                koochikStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                koochikAudioCtx = new AC();
                koochikSource = koochikAudioCtx.createMediaStreamSource(stream);
                // ScriptProcessorNode is deprecated but broadly supported,
                // including current iOS Safari — same choice the Vosk
                // backend made, kept for the same reason. Must be
                // connected through to a destination for onaudioprocess
                // to reliably fire in every browser.
                koochikProcessor = koochikAudioCtx.createScriptProcessor(4096, 1, 1);
                const streamStartTime = Date.now();
                koochikProcessor.onaudioprocess = function (event) {
                    try {
                        // Same 350ms warm-up guard as the old Vosk path —
                        // Android's audio subsystem delivers silence/
                        // garbage right after a stream opens.
                        if (Date.now() - streamStartTime >= 350) {
                            engine.feed(event.inputBuffer.getChannelData(0), koochikAudioCtx.sampleRate);
                        }
                    } catch (e) {
                        emit('error', classifyError('koochik-runtime'));
                    }
                    emitKoochikAudioLevel(event.inputBuffer);
                };
                koochikSource.connect(koochikProcessor);
                koochikProcessor.connect(koochikAudioCtx.destination);

                koochikActive = true;
                armKoochikSilenceWatchdog();
                emit('start');
                schedulePartialDecode(engine);
            }).catch(function (err) {
                koochikLoading = false;
                const code = (err && err.name === 'NotAllowedError') ? 'not-allowed'
                    : (err && err.name === 'NotFoundError') ? 'audio-capture' : 'koochik-runtime';
                emit('error', classifyError(code));
            });
        }).catch(function (info) {
            koochikLoading = false;
            emit('error', info && info.code ? info : classifyError('koochik-model-failed'));
        });
    }

    // Periodically re-decodes the buffered audio so far to produce a
    // live-feeling "interim" result — Koochik is a fixed-window offline
    // CTC model under the hood, not a truly incremental streaming model,
    // so "streaming" here means re-running the (very fast, ~10ms) forward
    // pass on the growing buffer at a modest interval. Skips overlapping
    // itself if a decode is still in flight.
    function schedulePartialDecode(engine) {
        if (koochikPartialTimer) clearTimeout(koochikPartialTimer);
        koochikPartialTimer = setTimeout(function () {
            if (!koochikActive) return;
            if (koochikDecodeInFlight || engine.bufferedSeconds() < 0.4) {
                schedulePartialDecode(engine);
                return;
            }
            koochikDecodeInFlight = true;
            engine.decode().then(function (text) {
                koochikDecodeInFlight = false;
                if (!koochikActive) return;
                if (text && text !== koochikLastEmitted) {
                    koochikLastEmitted = text;
                    armKoochikSilenceWatchdog();
                    emit('interim', text);
                }
                schedulePartialDecode(engine);
            }).catch(function () {
                koochikDecodeInFlight = false;
                if (koochikActive) schedulePartialDecode(engine);
            });
        }, KOOCHIK_PARTIAL_INTERVAL_MS);
    }

    let lastKoochikAudioLevelEmit = 0;

    function emitKoochikAudioLevel(buffer) {
        if (Date.now() - lastKoochikAudioLevelEmit < AUDIO_LEVEL_THROTTLE_MS) return;
        lastKoochikAudioLevelEmit = Date.now();
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

    function armKoochikSilenceWatchdog() {
        if (koochikSilenceWatchdog) clearTimeout(koochikSilenceWatchdog);
        koochikSilenceWatchdog = setTimeout(function () {
            if (koochikActive) {
                emit('error', classifyError('timeout'));
                stopKoochik();
            }
        }, 8000);
    }

    function stopKoochik() {
        if (koochikLoading) {
            koochikCancelRequested = true; // unwound inside startKoochik()'s pending chain
            return;
        }
        if (!koochikActive) return;
        if (koochikSilenceWatchdog) { clearTimeout(koochikSilenceWatchdog); koochikSilenceWatchdog = null; }
        if (koochikPartialTimer) { clearTimeout(koochikPartialTimer); koochikPartialTimer = null; }
        // Run one last decode over whatever was captured before tearing
        // down, so a manual stop mid-sentence doesn't just throw the
        // words away — mirrors the old Vosk retrieveFinalResult() step.
        const engine = koochikEngine;
        if (engine && engine.bufferedSeconds() > 0.15) {
            koochikStopTimer = setTimeout(finishKoochik, 1200);
            engine.decode().then(function (text) {
                if (koochikStopTimer) { clearTimeout(koochikStopTimer); koochikStopTimer = null; }
                if (text && text.trim()) emit('final', text.trim());
                finishKoochik();
            }).catch(function () {
                if (koochikStopTimer) { clearTimeout(koochikStopTimer); koochikStopTimer = null; }
                finishKoochik();
            });
        } else {
            finishKoochik();
        }
    }

    function finishKoochik() {
        if (koochikStopTimer) { clearTimeout(koochikStopTimer); koochikStopTimer = null; }
        if (koochikPartialTimer) { clearTimeout(koochikPartialTimer); koochikPartialTimer = null; }
        const wasActive = koochikActive;
        koochikActive = false;
        koochikDecodeInFlight = false;
        if (koochikProcessor) { try { koochikProcessor.disconnect(); } catch (e) {} koochikProcessor = null; }
        if (koochikSource) { try { koochikSource.disconnect(); } catch (e) {} koochikSource = null; }
        if (koochikAudioCtx) { try { koochikAudioCtx.close(); } catch (e) {} koochikAudioCtx = null; }
        if (koochikStream) { try { koochikStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {} koochikStream = null; }
        if (koochikEngine) { try { koochikEngine.reset(); } catch (e) {} }
        if (wasActive) emit('end');
    }

    // ============================================
    // UNIFIED DISPATCHER
    // ============================================
    function pickBackend() {
        return koochikConfigured() ? 'koochik' : 'webspeech';
    }

    function start() {
        if (active || koochikActive || koochikLoading) return;
        triedKoochikFallback = false;
        if (pickBackend() === 'koochik') startKoochik(); else startWebSpeech();
    }

    function stop() {
        // Check actual runtime state rather than just the static platform
        // choice — a session that fell back from webspeech to Koochik mid-
        // flight (see maybeFallbackToKoochik) is now genuinely running
        // Koochik even on a platform where pickBackend() would normally
        // say "webspeech", so stopping the wrong one would leave it running.
        if (koochikActive || koochikLoading) { stopKoochik(); return; }
        if (active) { stopWebSpeech(); return; }
        if (pickBackend() === 'koochik') stopKoochik(); else stopWebSpeech();
    }

    // Stop listening if the app is backgrounded/locked — prevents a
    // recognition session (and an open mic) from lingering forever.
    document.addEventListener('visibilitychange', function () {
        if (document.hidden && (active || koochikActive || koochikLoading)) stop();
    });

    window.addEventListener('offline', function () {
        if (active) {
            emit('error', classifyError('network'));
            stop();
        }
        // Note: the Koochik backend deliberately keeps running when
        // offline — once its model is loaded it needs no network at all.
    });

    // ============================================
    // PUBLIC API
    // ============================================
    const api = {
        ENV: ENV,
        getSupportInfo: getSupportInfo,
        start: start,
        stop: stop,
        isActive: function () { return active || koochikActive || koochikLoading; },
        on: on,
        openInSafari: function () {
            // Standalone PWAs on iOS have no tabs/windows of their own, so
            // opening the current URL via window.open kicks the user out
            // into a real Safari tab — this is the standard workaround for
            // APIs (like full SpeechRecognition support) that only behave
            // correctly outside of "Add to Home Screen" mode.
            try { window.open(window.location.href, '_blank'); }
            catch (e) { window.location.href = window.location.href; }
        },
        // Silently kick off the Koochik model download/instantiation in
        // the background — called from script.js when the person actually
        // opens the Voice tab, ahead of them tapping the mic itself. Uses
        // the exact same ensureKoochikEngine()/koochikEngineLoadPromise
        // caching as the normal on-demand path, so this is fully safe to
        // call proactively: if the person taps the mic before this
        // finishes, that call reuses this same in-flight promise rather
        // than starting a second, duplicate download. If it fails
        // silently in the background (offline, etc.), nothing is shown to
        // the person here — the normal on-demand path will surface a real
        // error only if they actually try to use voice and it's genuinely
        // unavailable. Deliberately NOT triggered unconditionally at app
        // startup — downloading a large model plus running heavy WASM
        // instantiation automatically on every single app launch (even
        // sessions that never touch voice at all) is a real cause of lag/
        // hangs, competing with the rest of the app's own startup work at
        // exactly the most resource-contended moment. Tying it to an
        // actual Voice-tab visit keeps the "get ahead of the mic tap"
        // benefit without that cost. Returns the underlying promise so
        // callers (e.g. the loading screen — see isModelCached() below)
        // can await/race it directly.
        preload: function () {
            if (!koochikConfigured()) return Promise.resolve();
            return ensureKoochikEngine().catch(function () { /* silent — this is opportunistic, not a user-initiated action */ });
        },
        // Actually stops an opportunistic preload in progress — called by
        // the loading screen when it gives up waiting (see script.js).
        // Note: unlike the old Vosk path, this does NOT abort an in-flight
        // fetch() — the underlying asset fetches in koochik-asr.js aren't
        // wired to an AbortController, so a preload already in flight will
        // finish downloading in the background even after this is called;
        // it just stops this module from awaiting or acting on the
        // result. Worth adding an AbortController if that background
        // download turns out to be a real cost in practice. Safe to call
        // even if nothing is in flight (no-op then). A later genuine load
        // — the person actually opening the Voice tab — starts clean via
        // the modelLoadCancelled reset in ensureKoochikEngine() above.
        cancelPreload: function () {
            if (koochikEngine) return; // already finished loading — nothing to cancel, and definitely don't throw away a ready engine
            modelLoadCancelled = true;
            koochikEngineLoadPromise = null;
        },
        // Cheap, fast check for whether the model FILE is already sitting
        // in the Cache API from a previous session — this is NOT the same
        // as the model being loaded/ready; it only tells you whether the
        // slow network download can be skipped. Used by the loading screen
        // to decide whether it's worth folding a real (bounded, timed-out)
        // wait for full model initialization into the existing loading
        // sequence: if this resolves true, the person has clearly used
        // voice before, so getting it ready during a wait they're already
        // seeing is a better trade than making them wait again later.
        isModelCached: function () {
            if (!koochikConfigured() || !window.caches) return Promise.resolve(false);
            return caches.open(KOOCHIK_CACHE_NAME)
                .then(function (cache) { return cache.match(KOOCHIK_MODEL_URL); })
                .then(function (match) { return !!match; })
                .catch(function () { return false; });
        },
        // Frees the loaded Koochik engine (ONNX session) from memory.
        // Not called unconditionally — keeping the model warm after
        // leaving the Voice tab is the normal default, since it makes
        // returning to voice instant. But that resident session competes
        // with the rest of the app for RAM even on pages that have
        // nothing to do with voice, which matters on low-memory devices.
        // Intended to be called from script.js only when Settings >
        // "حالت کم‌مصرف" (low power mode) is on, right after the person
        // leaves the Voice tab.
        // Safe to call any time: no-ops while actively listening or
        // mid-load. The next start()/preload() call transparently
        // re-initializes from the model file already sitting in the
        // Cache API (no re-download — just session creation again).
        releaseModel: function () {
            if (koochikActive || koochikLoading) return;
            if (koochikEngine) {
                try { koochikEngine.destroy(); } catch (e) { /* best-effort cleanup */ }
                koochikEngine = null;
            }
            koochikEngineLoadPromise = null;
            koochikFailInfo = null;
        }
    };

    window.VoiceEngine = api;
})(window);
