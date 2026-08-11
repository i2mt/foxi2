/* ============================================
   FoxiMed — Voice Engine
   ============================================
   Low-level speech capture layer with TWO interchangeable backends:

     1. "koochik" — the primary backend on ALL supported devices: an
        on-device ONNX speech engine (Shenava Koochik v1.0, Persian
        FastConformer CTC) running in-browser via onnxruntime-web.

     2. "webspeech" — retained only as a fallback if Koochik is deliberately
        deconfigured. Normal FoxiMed voice recognition now uses the same
        Koochik model on iOS, Android, desktop and installed PWAs.

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

   --- KOOCHIK BACKEND (ALL DEVICES) ---
   The model and its two official sidecars are loaded directly from the
   Shenava Koochik Hugging Face export and cached after the first successful
   load. This keeps the large ~230 MB ONNX file out of the normal Git repo
   and avoids hand-copying the token/filter JSON files.

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

    // Official Shenava Koochik v1.0 FP16 export. The ~230 MB embedded
    // ONNX stays on Hugging Face instead of the normal Git repository.
    // The official tokens and mel-filter sidecars come from the same repo
    // and are cached by koochik-asr.js after first successful use.
    const KOOCHIK_MODEL_URL = 'https://huggingface.co/Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16/resolve/main/shenava_koochik_1_0_ctc_fixed2005_len_att70_13_fp16_full_io_embedded.onnx';
    const KOOCHIK_TOKENS_URL = 'https://huggingface.co/Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16/resolve/main/tokens.json';
    const KOOCHIK_MEL_FILTERS_URL = 'https://huggingface.co/Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16/resolve/main/mel_filters_slaney_80x257.json';
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
    // Shared by both backends' audio-level metering (used to throttle how
    // often the 'audio' visualizer event fires). This lived inside the old
    // Vosk backend block and got dropped when that block was replaced —
    // both startWebSpeech()'s and startKoochik()'s meter functions
    // reference it, so it needs to live at module scope, not inside
    // either backend section.
    const AUDIO_LEVEL_THROTTLE_MS = 125;
    const KOOCHIK_SILENCE_FINALIZE_MS = 900;
    const KOOCHIK_MAX_UTTERANCE_MS = 19500; // fixed model window is ~20.04s
    const KOOCHIK_MIN_SPEECH_RMS = 0.008;

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
                message: 'برای اولین بارگذاری موتور صوتی اتصال اینترنت لازم است. پس از ذخیره‌شدن مدل، پردازش صدا روی خود دستگاه انجام می‌شود.'
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
    let koochikDecodePromise = null;
    let koochikLastEmitted = '';
    let koochikStopping = false;
    let koochikSpeechSeen = false;
    let koochikLastVoiceAt = 0;
    let koochikNoiseFloor = 0.004;
    let koochikLoadAbortController = null;
    let koochikLoadGeneration = 0;
    let triedKoochikFallback = false; // reset at the start of each fresh start() call

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
    // BACKEND 1: KOOCHIK (primary on-device CTC ASR — all devices)
    // Driven by koochik-asr.js, which owns feature extraction, ONNX
    // inference (via onnxruntime-web), and greedy CTC decoding. This
    // file only owns: mic capture, buffering audio into the engine,
    // deciding when to ask for a partial vs. final decode, and mapping
    // engine output onto the same event contract webspeech/vosk used.
    // ============================================
    function ensureKoochikEngine() {
        if (koochikEngine) return Promise.resolve(koochikEngine);
        if (koochikEngineLoadPromise) return koochikEngineLoadPromise;

        const generation = ++koochikLoadGeneration;
        const controller = new AbortController();
        koochikLoadAbortController = controller;
        emit('model-loading');

        const loadChain = window.KoochikASR
            ? window.KoochikASR.load({
                modelUrl: KOOCHIK_MODEL_URL,
                tokensUrl: KOOCHIK_TOKENS_URL,
                melFiltersUrl: KOOCHIK_MEL_FILTERS_URL,
                ortLibUrl: KOOCHIK_ORT_LIB_URL,
                ortWasmBaseUrl: KOOCHIK_ORT_WASM_BASE_URL,
                cacheName: KOOCHIK_CACHE_NAME,
                signal: controller.signal
            }, function (progress) {
                if (generation !== koochikLoadGeneration || controller.signal.aborted) return;
                emit('model-progress', progress);
            })
            : Promise.reject(classifyError('koochik-lib-failed'));

        let timeoutId = null;
        const timeoutChain = new Promise(function (_, reject) {
            timeoutId = setTimeout(function () {
                if (generation === koochikLoadGeneration) controller.abort();
                reject(classifyError('koochik-model-failed'));
            }, KOOCHIK_MODEL_TIMEOUT_MS);
        });

        const promise = Promise.race([loadChain, timeoutChain])
            .then(function (engine) {
                if (timeoutId) clearTimeout(timeoutId);
                if (generation !== koochikLoadGeneration || controller.signal.aborted) {
                    try { engine && engine.destroy && engine.destroy(); } catch (e) {}
                    const cancelled = new Error('cancelled');
                    cancelled.code = 'cancelled';
                    throw cancelled;
                }
                koochikEngine = engine;
                koochikFailInfo = null;
                emit('model-ready');
                return engine;
            })
            .catch(function (err) {
                if (timeoutId) clearTimeout(timeoutId);
                if (generation === koochikLoadGeneration) {
                    koochikEngineLoadPromise = null;
                    koochikLoadAbortController = null;
                }

                const wasCancelled = err && (err.name === 'AbortError' || err.message === 'cancelled' || err.code === 'cancelled');
                if (wasCancelled) {
                    const cancelled = classifyError('aborted');
                    throw cancelled;
                }

                const info = (err && err.code) ? err : classifyError('koochik-model-failed');
                if (!info.silent) console.error('[KoochikASR] engine load failed:', err);
                if (generation === koochikLoadGeneration) {
                    koochikFailInfo = { status: 'limited', code: info.code, title: info.title, message: info.message };
                }
                throw info;
            });

        koochikEngineLoadPromise = promise;
        return promise;
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
            koochikStopping = false;
            koochikSpeechSeen = false;
            koochikLastVoiceAt = 0;
            koochikNoiseFloor = 0.004;

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
                            const samples = event.inputBuffer.getChannelData(0);
                            if (!koochikStopping) {
                                engine.feed(samples, koochikAudioCtx.sampleRate);
                                updateKoochikVad(samples);
                            }
                        }
                    } catch (e) {
                        emit('error', classifyError('koochik-runtime'));
                    }
                    emitKoochikAudioLevel(event.inputBuffer);
                };
                koochikSource.connect(koochikProcessor);
                koochikProcessor.connect(koochikAudioCtx.destination);

                koochikActive = true;
                armKoochikSessionLimit();
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
    let koochikConsecutiveDecodeFailures = 0;

    function schedulePartialDecode(engine) {
        if (koochikPartialTimer) clearTimeout(koochikPartialTimer);
        koochikPartialTimer = setTimeout(function () {
            if (!koochikActive) return;
            if (koochikDecodeInFlight || engine.bufferedSeconds() < 0.4) {
                schedulePartialDecode(engine);
                return;
            }
            koochikDecodeInFlight = true;
            koochikDecodePromise = engine.decode();
            koochikDecodePromise.then(function (text) {
                koochikDecodeInFlight = false;
                koochikDecodePromise = null;
                koochikConsecutiveDecodeFailures = 0;
                if (!koochikActive || koochikStopping) return;
                if (text && text !== koochikLastEmitted) {
                    koochikLastEmitted = text;
                    emit('interim', text);
                }
                schedulePartialDecode(engine);
            }).catch(function (err) {
                koochikDecodeInFlight = false;
                koochikDecodePromise = null;
                // This was previously swallowed with no logging at all — if
                // decode is failing on every call (a shape mismatch, an
                // unsupported fp16 op on the wasm backend, etc.), the old
                // behavior looked EXACTLY like "recognized nothing, no
                // error, just silence" from the user's side, because it
                // retried forever without ever telling anyone why. Surface
                // it now: always to the console (so it's diagnosable from
                // devtools), and to the UI after a few repeats in a row so
                // it isn't just a single transient hiccup.
                console.error('[KoochikASR] decode failed:', err);
                koochikConsecutiveDecodeFailures++;
                if (koochikActive && !koochikStopping) {
                    if (koochikConsecutiveDecodeFailures >= 3) {
                        emit('error', classifyError('koochik-runtime'));
                        stopKoochik();
                        return;
                    }
                    schedulePartialDecode(engine);
                }
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

    function updateKoochikVad(samples) {
        if (!koochikActive || koochikStopping || !samples || !samples.length) return;

        let sumSq = 0;
        for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
        const rms = Math.sqrt(sumSq / samples.length);
        const now = Date.now();
        const threshold = Math.max(KOOCHIK_MIN_SPEECH_RMS, koochikNoiseFloor * 2.5);

        if (rms >= threshold) {
            koochikSpeechSeen = true;
            koochikLastVoiceAt = now;
        } else {
            // Track background noise only while this block looks non-speech.
            // The slow adaptation keeps the threshold useful across quiet
            // rooms and noisier mobile microphones without a fixed dB guess.
            koochikNoiseFloor = Math.max(0.001, Math.min(0.03, koochikNoiseFloor * 0.97 + rms * 0.03));
            if (koochikSpeechSeen && koochikLastVoiceAt && (now - koochikLastVoiceAt) >= KOOCHIK_SILENCE_FINALIZE_MS) {
                stopKoochik();
            }
        }
    }

    function armKoochikSessionLimit() {
        if (koochikSilenceWatchdog) clearTimeout(koochikSilenceWatchdog);
        koochikSilenceWatchdog = setTimeout(function () {
            // Koochik only retains ~20 seconds. Finalize before the fixed
            // window rolls over instead of silently dropping the beginning.
            if (koochikActive) stopKoochik();
        }, KOOCHIK_MAX_UTTERANCE_MS);
    }

    function stopKoochik() {
        if (koochikStopping) return;
        if (koochikLoading) {
            koochikCancelRequested = true;
            koochikLoadGeneration++;
            if (koochikLoadAbortController) {
                try { koochikLoadAbortController.abort(); } catch (e) {}
            }
            koochikLoadAbortController = null;
            koochikEngineLoadPromise = null;
            koochikLoading = false;
            return;
        }
        if (!koochikActive) return;
        koochikStopping = true;
        if (koochikSilenceWatchdog) { clearTimeout(koochikSilenceWatchdog); koochikSilenceWatchdog = null; }
        if (koochikPartialTimer) { clearTimeout(koochikPartialTimer); koochikPartialTimer = null; }
        // Run one last decode over whatever was captured before tearing
        // down, so a manual stop mid-sentence doesn't just throw the
        // words away — mirrors the old Vosk retrieveFinalResult() step.
        const engine = koochikEngine;
        if (engine && engine.bufferedSeconds() > 0.15) {
            koochikStopTimer = setTimeout(finishKoochik, 1800);

            const waitForPartial = koochikDecodePromise
                ? koochikDecodePromise.catch(function () { return ''; })
                : Promise.resolve('');

            waitForPartial.then(function () {
                if (!koochikStopping || !engine) return '';
                return engine.decode();
            }).then(function (text) {
                if (!koochikStopping) return;
                if (koochikStopTimer) { clearTimeout(koochikStopTimer); koochikStopTimer = null; }
                if (text && text.trim()) emit('final', text.trim());
                finishKoochik();
            }).catch(function (err) {
                console.error('[KoochikASR] final decode failed:', err);
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
        koochikStopping = false;
        koochikDecodeInFlight = false;
        koochikDecodePromise = null;
        koochikSpeechSeen = false;
        koochikLastVoiceAt = 0;
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
        // Koochik is intentionally the default backend on every device.
        // It runs locally in the browser through ONNX Runtime Web.
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
        // Abort an opportunistic model load/download. The AbortController
        // is passed all the way into fetch(), so this now stops the large
        // Hugging Face transfer instead of merely ignoring its result.
        cancelPreload: function () {
            if (koochikEngine) return;
            koochikCancelRequested = true;
            koochikLoadGeneration++;
            if (koochikLoadAbortController) {
                try { koochikLoadAbortController.abort(); } catch (e) {}
            }
            koochikLoadAbortController = null;
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

            // Low-power mode may call this while an opportunistic preload
            // is still downloading. Abort that transfer before dropping the
            // promise so it cannot continue consuming bandwidth/RAM unseen.
            if (koochikEngineLoadPromise && !koochikEngine) {
                koochikLoadGeneration++;
                if (koochikLoadAbortController) {
                    try { koochikLoadAbortController.abort(); } catch (e) {}
                }
            }

            if (koochikEngine) {
                try { koochikEngine.destroy(); } catch (e) { /* best-effort cleanup */ }
                koochikEngine = null;
            }
            koochikEngineLoadPromise = null;
            koochikLoadAbortController = null;
            koochikFailInfo = null;
        }
    };

    window.VoiceEngine = api;
})(window);
