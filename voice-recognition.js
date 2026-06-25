/* ============================================
   FoxiMed — Voice Engine (Enhanced)
   ============================================ */
(function (window) {
    'use strict';

    // ------------------------------------------------------------
    // CONFIGURATION
    // ------------------------------------------------------------
    const VOSK_MODEL_URL = 'https://raw.githubusercontent.com/i2mt/foxi2/refs/heads/main/icons/vosk-model-small-fa-0.5.tar.gz';
    const VOSK_LIB_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
    const VOSK_MODEL_TIMEOUT_MS = 15 * 60 * 1000;
    const VOSK_CACHE_NAME = 'foximed-vosk-model-v1';

    function voskConfigured() { return !!VOSK_MODEL_URL; }
    function voskForcedOff() {
        try { return new URLSearchParams(window.location.search).get('novosk') === '1'; } catch (e) { return false; }
    }

    // ------------------------------------------------------------
    // ENVIRONMENT DETECTION
    // ------------------------------------------------------------
    function detectIOS() {
        const ua = navigator.userAgent || '';
        const isClassicIOS = /iPad|iPhone|iPod/.test(ua);
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

    // ------------------------------------------------------------
    // SUPPORT / LIMITATION REPORT
    // ------------------------------------------------------------
    function getSupportInfo() {
        if (!ENV.isSecureContext) {
            return {
                status: 'blocked',
                code: 'insecure',
                title: 'اتصال امن لازم است',
                message: 'دسترسی به میکروفون فقط روی HTTPS کار می‌کند. آدرس سایت را بررسی کنید.'
            };
        }
        if (ENV.isIOS && voskConfigured() && !voskForcedOff()) {
            if (voskFailInfo) return voskFailInfo;
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
            return { status: 'ok', code: 'ios-safari', title: null, message: null };
        }
        return { status: 'ok', code: 'ok', title: null, message: null };
    }

    // ------------------------------------------------------------
    // ERROR CLASSIFICATION
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // STATE & LISTENERS
    // ------------------------------------------------------------
    let recognition = null;
    let active = false;
    let startWatchdog = null;
    let silenceWatchdog = null;
    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let rafId = null;
    const listeners = {};

    // Vosk state
    let voskActive = false;
    let voskLoading = false;
    let voskCancelRequested = false;
    let voskLibLoadPromise = null;
    let voskModel = null;
    let voskModelLoadPromise = null;
    let voskFailInfo = null;
    let voskRecognizer = null;
    let voskAudioCtx = null;
    let voskSource = null;
    let voskProcessor = null;
    let voskStream = null;
    let voskStopTimer = null;
    let voskSilenceWatchdog = null;
    let triedVoskFallback = false;

    function on(event, handler) { listeners[event] = handler; return api; }
    function emit(event, payload) { if (typeof listeners[event] === 'function') listeners[event](payload); }

    function clearWatchdogs() {
        if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
        if (silenceWatchdog) { clearTimeout(silenceWatchdog); silenceWatchdog = null; }
    }

    // ------------------------------------------------------------
    // NATIVE WEB SPEECH BACKEND
    // ------------------------------------------------------------
    function maybeFallbackToVosk(errorCode) {
        if (triedVoskFallback) return false;
        if (!voskConfigured() || voskForcedOff()) return false;
        if (errorCode === 'network' && !voskModel) return false;
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
            .catch(function () { /* no mic for visualization */ });
    }

    function pumpAudioFrames() {
        if (!analyser || !active) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = 12;
        const chunk = Math.floor(data.length / bars) || 1;
        const bins = [];
        let levelSum = 0;
        for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < chunk; j++) sum += data[i * chunk + j] || 0;
            const avg = sum / chunk / 255;
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

        let urlTestLang = null;
        try { urlTestLang = new URLSearchParams(window.location.search).get('testlang'); } catch (e) {}

        const langToUse = langOverride || urlTestLang || 'fa-IR';
        const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognitionImpl();
        recognition.lang = langToUse;
        recognition.continuous = !ENV.isIOS;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onstart = function () {
            active = true;
            if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
            armSilenceWatchdog();
            emit('start');
            attachAudioMeter();
        };

        recognition.onresult = function (event) {
            armSilenceWatchdog();
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
            if (active && !ENV.isIOS) {
                try { recognition.start(); return; } catch (e) { /* fall through */ }
            }
            active = false;
            releaseAudioMeter();
            emit('end');
        };

        try {
            recognition.start();
        } catch (e) {
            emit('error', classifyError('start-failed'));
            return;
        }

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

    // ------------------------------------------------------------
    // VOSK BACKEND (with N-best alternatives)
    // ------------------------------------------------------------
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

    function fetchModelWithProgress(url, onProgress) {
        const MAX_ATTEMPTS = 6;
        const STALL_TIMEOUT_MS = 25000;
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
                                putPromise.catch(function () { /* quota or unsupported */ });
                            }
                        } catch (e) { /* non-fatal */ }
                        return blob;
                    });
                });
            }).catch(function () {
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
                        return window.Vosk.createModel(VOSK_MODEL_URL);
                    });
            })
            .then(function (model) {
                voskModel = model;
                voskFailInfo = null;
                model.on('error', function () {
                    emit('error', classifyError('vosk-runtime'));
                });
                emit('model-ready');
                return model;
            });

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
        if (!voskConfigured() || voskForcedOff()) {
            emit('error', classifyError('vosk-not-configured'));
            return;
        }

        voskLoading = true;
        voskCancelRequested = false;

        ensureVoskModel().then(function (model) {
            if (voskCancelRequested) { voskLoading = false; return; }
            let recognizer;
            // Grammar is OFF by default — enable with ?grammar=1
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
                    recognizer = new model.KaldiRecognizer(16000);
                } catch (e2) {
                    voskLoading = false;
                    emit('error', classifyError('vosk-runtime'));
                    return;
                }
            }
            // Enable word timings and alternatives
            try { recognizer.setWords(true); } catch (e) {}
            voskRecognizer = recognizer;

            recognizer.on('partialresult', function (message) {
                const partial = message && message.result && message.result.partial;
                if (partial && partial.trim()) {
                    armVoskSilenceWatchdog();
                    emit('interim', partial.trim());
                }
            });

            recognizer.on('result', function (message) {
                const result = message && message.result;
                if (!result) return;

                // Get alternatives (N-best)
                const alternatives = result.alternatives || [];
                let bestText = null;
                let bestConfidence = -1;
                for (const alt of alternatives) {
                    if (alt.confidence > bestConfidence) {
                        bestConfidence = alt.confidence;
                        bestText = alt.text;
                    }
                }
                // Fallback to 'text' field if alternatives empty
                if (!bestText && result.text) bestText = result.text;

                if (bestText && bestText.trim()) {
                    emit('final', bestText.trim());
                    // Also emit all hypotheses for potential ranking in VoiceCommands
                    if (alternatives.length > 1) {
                        emit('hypotheses', alternatives.map(a => ({ text: a.text, confidence: a.confidence })));
                    }
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
                    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                    try { recognizer.remove(); } catch (e) {}
                    if (voskRecognizer === recognizer) voskRecognizer = null;
                    return;
                }
                voskStream = stream;
                const AC = window.AudioContext || window.webkitAudioContext;
                voskAudioCtx = new AC();
                voskSource = voskAudioCtx.createMediaStreamSource(stream);
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
            const avg = Math.min(1, (sum / chunk) * 4);
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
            voskCancelRequested = true;
            return;
        }
        if (!voskActive && !voskRecognizer) return;
        if (voskSilenceWatchdog) { clearTimeout(voskSilenceWatchdog); voskSilenceWatchdog = null; }
        if (voskRecognizer) {
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

    // ------------------------------------------------------------
    // UNIFIED DISPATCHER
    // ------------------------------------------------------------
    function pickBackend() {
        if (voskForcedOff()) return 'webspeech';
        return (ENV.isIOS && voskConfigured()) ? 'vosk' : 'webspeech';
    }

    function start() {
        if (active || voskActive || voskLoading) return;
        triedVoskFallback = false;
        if (pickBackend() === 'vosk') startVosk(); else startWebSpeech();
    }

    function stop() {
        if (voskActive || voskLoading) { stopVosk(); return; }
        if (active) { stopWebSpeech(); return; }
        if (pickBackend() === 'vosk') stopVosk(); else stopWebSpeech();
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden && (active || voskActive || voskLoading)) stop();
    });

    window.addEventListener('offline', function () {
        if (active) {
            emit('error', classifyError('network'));
            stop();
        }
    });

    // ------------------------------------------------------------
    // PUBLIC API
    // ------------------------------------------------------------
    const api = {
        ENV: ENV,
        getSupportInfo: getSupportInfo,
        start: start,
        stop: stop,
        isActive: function () { return active || voskActive || voskLoading; },
        on: on,
        openInSafari: function () {
            try { window.open(window.location.href, '_blank'); }
            catch (e) { window.location.href = window.location.href; }
        }
    };

    window.VoiceEngine = api;
})(window);
