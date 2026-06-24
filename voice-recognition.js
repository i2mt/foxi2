/* ============================================
   FoxiMed — Voice Engine
   ============================================
   Based on the original working version (voice detection intact).
   Model is loaded directly via URL – no Blob, no Cache API,
   no memory pressure. iOS reload fixed.
   ============================================ */
(function (window) {
    'use strict';

    // Mehdi: put your hosted, same-origin .tar.gz model URL here.
    const VOSK_MODEL_URL = 'https://raw.githubusercontent.com/i2mt/foxi2/refs/heads/main/icons/vosk-model-small-fa-0.5.tar.gz';
    const VOSK_LIB_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';

    function voskConfigured() { return !!VOSK_MODEL_URL; }

    // ============================================
    // ENVIRONMENT DETECTION
    // ============================================
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

    // ============================================
    // SUPPORT / LIMITATION REPORT
    // ============================================
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
    let startWatchdog = null;
    let silenceWatchdog = null;
    let micStream = null;
    let audioCtx = null;
    let analyser = null;
    let rafId = null;
    const listeners = {};

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

    function maybeFallbackToVosk(errorCode) {
        if (triedVoskFallback) return false;
        if (!voskConfigured()) return false;
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

    // ============================================
    // AUDIO METERING (Web Audio API)
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
            .catch(function () { /* no mic stream for visualization */ });
    }

    function pumpAudioFrames() {
        if (!analyser || !active) return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const bars = 12;
        const chunk = Math.floor(data.length / bars) || 1;
        let levelSum = 0;
        const bins = [];
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

    // ============================================
    // BACKEND 2: VOSK (offline, on‑device)
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

    // ----- Resampling helper (linear interpolation) -----
    function resampleAudio(inputBuffer, sourceRate) {
        const targetRate = 16000;
        if (sourceRate === targetRate) return inputBuffer.getChannelData(0);

        const input = inputBuffer.getChannelData(0);
        const ratio = sourceRate / targetRate;
        const outputLength = Math.round(input.length / ratio);
        const output = new Float32Array(outputLength);

        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1);
            const frac = srcIndex - srcIndexFloor;
            output[i] = input[srcIndexFloor] * (1 - frac) + input[srcIndexCeil] * frac;
        }
        return output;
    }

    // ============================================
    // ★★★ THE FIX: no Blob, no Cache API – URL only ★★★
    // ============================================
    function ensureVoskModel() {
        if (voskModel) return Promise.resolve(voskModel);
        if (voskModelLoadPromise) return voskModelLoadPromise;

        emit('model-loading');

        voskModelLoadPromise = ensureVoskLib()
            .catch(function () { throw classifyError('vosk-lib-failed'); })
            .then(function () {
                // Pass the URL directly – the library fetches it.
                // The browser's HTTP cache will store it on disk.
                return window.Vosk.createModel(VOSK_MODEL_URL);
            })
            .then(function (model) {
                voskModel = model;
                voskFailInfo = null;
                model.on('error', function () {
                    emit('error', classifyError('vosk-runtime'));
                });
                emit('model-ready');
                return model;
            })
            .catch(function (err) {
                voskModelLoadPromise = null;
                const info = (err && err.code) ? err : classifyError('vosk-model-failed');
                voskFailInfo = { status: 'limited', code: info.code, title: info.title, message: info.message };
                throw info;
            });

        return voskModelLoadPromise;
    }

    // ============================================
    // SAFE AUDIO LEVEL EXTRACTOR (no errors)
    // ============================================
    let _levelCounter = 0;
    function emitVoskAudioLevel(buffer) {
        _levelCounter++;
        if (_levelCounter % 4 !== 0) return;

        let data;
        if (buffer && typeof buffer.getChannelData === 'function') {
            data = buffer.getChannelData(0);
        } else if (buffer && buffer.constructor === Float32Array) {
            data = buffer;
        } else {
            return;
        }

        const bars = 12;
        const chunk = Math.floor(data.length / bars) || 1;
        let levelSum = 0;
        for (let i = 0; i < bars; i++) {
            let sum = 0;
            for (let j = 0; j < chunk; j++) sum += Math.abs(data[i * chunk + j] || 0);
            levelSum += sum / chunk;
        }
        const level = Math.min(1, (levelSum / bars) * 4);
        emit('audio', { bins: [], level: level });
    }

    // ============================================
    // START VOSK — Performance-optimized (unchanged)
    // ============================================
    function startVosk() {
        if (voskActive || voskLoading) return;
        if (!voskConfigured()) {
            emit('error', classifyError('vosk-not-configured'));
            return;
        }

        voskLoading = true;
        voskCancelRequested = false;

        // Create AudioContext NOW (during user gesture)
        const AC = window.AudioContext || window.webkitAudioContext;
        voskAudioCtx = new AC({ sampleRate: 16000 });

        ensureVoskModel().then(function (model) {
            if (voskCancelRequested) { voskLoading = false; return; }
            let recognizer;
            // Optional grammar (off by default – add ?grammar=1 to URL to enable)
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
                    try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                    try { recognizer.remove(); } catch (e) {}
                    if (voskRecognizer === recognizer) voskRecognizer = null;
                    return;
                }
                voskStream = stream;
                voskSource = voskAudioCtx.createMediaStreamSource(stream);
                voskProcessor = voskAudioCtx.createScriptProcessor(2048, 1, 1);
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
            try { window.open(window.location.href, '_blank'); }
            catch (e) { window.location.href = window.location.href; }
        }
    };

    window.VoiceEngine = api;
})(window);
