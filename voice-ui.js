/* ============================================
   FoxiMed — Voice Assistant UI
   ============================================
   Everything that touches the DOM of the Voice tab itself: the orb,
   the reactive waveform, status text, transcript, result card, example
   chips, history, the text-input fallback, and the environment banner
   that explains iOS/browser limitations instead of silently failing.

   Talks to:
     - window.VoiceEngine    (start/stop listening, audio levels, errors)
     - window.VoiceCommands  (process a transcript into an action)

   Public API used by voice-commands.js:
     window.VoiceUI.showResult(message, type)
     window.VoiceUI.appendTip(html)

   © Mohammad Mahdi Taghavi — FoxiMed
   ============================================ */
(function (window, document) {
    'use strict';

    let voiceHistory = [];
    try { voiceHistory = JSON.parse(localStorage.getItem('voiceHistory') || '[]'); } catch (e) { voiceHistory = []; }

    let els = {};
    let resultClearTimer = null;

    function qs(id) { return document.getElementById(id); }

    function cacheEls() {
        els = {
            orb: qs('voiceOrb'),
            orbContainer: qs('voiceOrbContainer'),
            status: qs('voiceStatus'),
            transcript: qs('voiceTranscript'),
            transcriptArea: qs('voiceTranscriptArea'),
            result: qs('voiceResult'),
            embers: qs('voiceEmbers'),
            banner: qs('voiceEnvBanner'),
            bannerText: qs('voiceEnvBannerText'),
            bannerAction: qs('voiceEnvBannerAction'),
            textInput: qs('voiceTextInput'),
            textSend: qs('voiceTextSend'),
            historySection: qs('voiceHistory'),
            historyList: qs('voiceHistoryList'),
            clearHistoryBtn: qs('voiceClearHistoryBtn'),
            ttsToggle: qs('voiceTtsToggle'),
            headerSpacer: document.querySelector('.voice-header-spacer'),
            modelProgress: qs('voiceModelProgress'),
            modelProgressFill: qs('voiceModelProgressFill'),
            modelProgressLabel: qs('voiceModelProgressLabel'),
            examples: qs('voiceExamples')
        };
    }

    // ============================================
    // STATUS / RESULT RENDERING
    // ============================================
    function setStatus(text, state) {
        if (!els.status) return;
        els.status.textContent = text;
        els.status.className = 'voice-status' + (state ? ' ' + state : '');
    }

    function setOrbState(state) {
        if (els.orbContainer) {
            els.orbContainer.classList.remove('is-idle', 'is-listening', 'is-processing', 'is-success', 'is-error', 'is-loading-model');
            els.orbContainer.classList.add('is-' + state);
        }
        if (els.orbContainer) {
            els.orbContainer.classList.toggle('recording', state === 'listening');
        }
        if (els.transcriptArea) {
            els.transcriptArea.style.display = (state === 'listening' || state === 'processing') ? '' : 'none';
        }
        if (els.examples) {
            els.examples.style.display = (state === 'idle') ? '' : 'none';
        }
    }

    function setTranscript(text, active) {
        if (!els.transcript) return;
        els.transcript.textContent = text || '…';
        els.transcript.classList.toggle('active', !!active);
    }

    function showResult(message, type) {
        if (!els.result) return;
        clearTimeout(resultClearTimer);
        els.result.style.display = 'block';
        els.result.className = 'voice-result' + (type === 'error' ? ' error' : type === 'info' ? ' info' : ' success');
        els.result.innerHTML = '<span class="voice-result-text">' + message + '</span>';
        setStatus(type === 'error' ? 'خطا' : 'انجام شد', type === 'error' ? 'error' : 'success');
        setOrbState(type === 'error' ? 'error' : 'success');
        speak(message);
        resultClearTimer = setTimeout(function () {
            els.result.style.display = 'none';
            setOrbState('idle');
            setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
        }, 12000);
    }

    function appendTip(html) {
        if (!els.result || els.result.style.display === 'none') return;
        const tip = document.createElement('div');
        tip.className = 'voice-tip';
        tip.innerHTML = html;
        els.result.appendChild(tip);
    }

    // ============================================
    // VOICE OUTPUT (text-to-speech)
    // ============================================
    let cachedVoices = [];
    function refreshVoices() {
        if (!window.speechSynthesis) return;
        cachedVoices = window.speechSynthesis.getVoices() || [];
        updateTtsAvailability();
    }
    if (window.speechSynthesis) {
        refreshVoices();
        window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
    function pickPersianVoice() {
        if (!cachedVoices.length) refreshVoices();
        for (let i = 0; i < cachedVoices.length; i++) {
            if (cachedVoices[i].lang && cachedVoices[i].lang.toLowerCase().indexOf('fa') === 0) return cachedVoices[i];
        }
        return null;
    }
    function updateTtsAvailability() {
        if (!els.ttsToggle) return;
        const available = !!pickPersianVoice();
        els.ttsToggle.style.display = available ? '' : 'none';
        if (els.headerSpacer) els.headerSpacer.style.display = available ? '' : 'none';
        if (!available && window.AppState && window.AppState.settings) {
            window.AppState.settings.voiceOutput = false;
        }
    }
    function stripForSpeech(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        let text = tmp.textContent || tmp.innerText || '';
        text = text.replace(/\p{Extended_Pictographic}/gu, '');
        text = text.replace(/[\u200D\uFE0F]/g, '');
        return text.replace(/\s+/g, ' ').trim();
    }
    function isVoiceOutputOn() {
        return typeof AppState !== 'undefined' && !!(AppState && AppState.settings && AppState.settings.voiceOutput);
    }
    function speak(message) {
        if (!window.speechSynthesis || !isVoiceOutputOn()) return;
        const voice = pickPersianVoice();
        if (!voice) return;
        const plain = stripForSpeech(message);
        if (!plain) return;
        try {
            window.speechSynthesis.cancel();
            const utter = new SpeechSynthesisUtterance(plain);
            utter.lang = 'fa-IR';
            utter.voice = voice;
            utter.rate = 1;
            window.speechSynthesis.speak(utter);
        } catch (e) {}
    }
    function updateTtsToggleIcon() {
        if (!els.ttsToggle) return;
        const on = isVoiceOutputOn();
        els.ttsToggle.classList.toggle('is-on', on);
        els.ttsToggle.innerHTML = '<i class="fas fa-' + (on ? 'volume-high' : 'volume-xmark') + '"></i>';
        els.ttsToggle.setAttribute('aria-label', on ? 'پاسخ صوتی روشن است' : 'پاسخ صوتی خاموش است');
    }
    function toggleVoiceOutput() {
        if (typeof AppState === 'undefined' || !AppState.settings) return;
        AppState.settings.voiceOutput = !AppState.settings.voiceOutput;
        if (typeof saveSettings === 'function') saveSettings();
        updateTtsToggleIcon();
        if (typeof haptic === 'function') haptic(15);
        showResult(AppState.settings.voiceOutput ? 'پاسخ صوتی فعال شد 🔊' : 'پاسخ صوتی غیرفعال شد', 'info');
    }

    // ============================================
    // HISTORY
    // ============================================
    function addToHistory(text) {
        voiceHistory = voiceHistory.filter(function (c) { return c !== text; });
        voiceHistory.unshift(text);
        if (voiceHistory.length > 10) voiceHistory.pop();
        try { localStorage.setItem('voiceHistory', JSON.stringify(voiceHistory)); } catch (e) {}
        renderHistory();
    }

    function renderHistory() {
        if (!els.historyList) return;
        const display = voiceHistory.slice(0, 3);
        if (display.length === 0) {
            if (els.historySection) els.historySection.style.display = 'none';
            return;
        }
        if (els.historySection) els.historySection.style.display = 'block';
        els.historyList.innerHTML = display.map(function (cmd) {
            return '<button type="button" class="voice-history-chip" data-cmd="' + cmd.replace(/"/g, '&quot;') + '">' + cmd + '</button>';
        }).join('');
        els.historyList.querySelectorAll('.voice-history-chip').forEach(function (chip) {
            chip.addEventListener('click', function () { handleTranscript(this.dataset.cmd, 'history'); });
        });
    }

    // ============================================
    // FOX MARK AUDIO REACTIVITY
    // ============================================
    function onAudioData(data) {
        if (els.orbContainer) {
            els.orbContainer.style.setProperty('--audio-level', String(0.15 + (data.level || 0) * 0.85));
        }
    }

    function spawnEmbers() {
        if (!els.embers || els.embers.dataset.spawned) return;
        els.embers.dataset.spawned = 'true';
        const count = 9;
        for (let i = 0; i < count; i++) {
            const e = document.createElement('span');
            e.className = 'voice-ember';
            const left = 20 + Math.random() * 60;
            const size = (2 + Math.random() * 3.2).toFixed(1);
            const dur = (4 + Math.random() * 4).toFixed(2);
            const delay = (Math.random() * dur).toFixed(2);
            const dx = (Math.random() * 36 - 18).toFixed(0) + 'px';
            e.style.left = left + '%';
            e.style.setProperty('--s', size + 'px');
            e.style.setProperty('--dur', dur + 's');
            e.style.setProperty('--delay', delay + 's');
            e.style.setProperty('--dx', dx);
            els.embers.appendChild(e);
        }
    }

    // ============================================
    // ENVIRONMENT BANNER
    // ============================================
    function renderEnvironmentBanner() {
        if (!els.banner || !window.VoiceEngine) return;
        const info = window.VoiceEngine.getSupportInfo();

        if (info.status === 'ok') {
            els.banner.style.display = 'none';
            return;
        }

        els.banner.style.display = 'flex';
        els.banner.className = 'voice-env-banner ' + (info.status === 'blocked' ? 'is-blocked' : 'is-limited');
        if (els.bannerText) {
            els.bannerText.innerHTML = '<strong>' + info.title + '</strong><span>' + info.message + '</span>';
        }
        if (els.bannerAction) {
            if (info.code === 'ios-standalone') {
                els.bannerAction.style.display = 'inline-flex';
                els.bannerAction.textContent = 'باز کردن در Safari';
                els.bannerAction.onclick = function () { window.VoiceEngine.openInSafari(); };
            } else {
                els.bannerAction.style.display = 'none';
            }
        }
    }

    // ============================================
    // MIC FLOW
    // ============================================
    function onMicClick() {
        if (!window.VoiceEngine) return;
        if (window.VoiceEngine.isActive()) {
            window.VoiceEngine.stop();
        } else {
            haptic(15);
            window.VoiceEngine.start();
        }
    }

    function handleTranscript(text, source) {
        if (!text) return;
        addToHistory(text);
        setTranscript(text, true);
        setStatus('در حال پردازش...', 'processing');
        setOrbState('processing');
        if (els.result) els.result.style.display = 'none';
        if (window.VoiceCommands) window.VoiceCommands.process(text);
    }

    function wireVoiceEngineEvents() {
        if (!window.VoiceEngine) return;
        window.VoiceEngine.on('start', function () {
            setOrbState('listening');
            setStatus('گوش می‌کنم...', 'recording');
            setTranscript('', false);
            if (els.result) els.result.style.display = 'none';
            if (window.speechSynthesis) { try { window.speechSynthesis.cancel(); } catch (e) {} }
        });
        window.VoiceEngine.on('model-loading', function () {
            setOrbState('loading-model');
            setStatus('آماده‌سازی موتور آفلاین...', 'processing');
            if (els.modelProgress) {
                els.modelProgress.style.display = 'flex';
                if (els.modelProgressFill) els.modelProgressFill.classList.add('is-indeterminate');
                if (els.modelProgressLabel) els.modelProgressLabel.textContent = 'در حال شروع دانلود (حدود ۵۳ مگابایت)...';
            }
        });
        window.VoiceEngine.on('model-progress', function (p) {
            if (!els.modelProgressFill) return;
            if (p.fromCache) {
                els.modelProgressFill.classList.remove('is-indeterminate');
                els.modelProgressFill.style.width = '100%';
                if (els.modelProgressLabel) els.modelProgressLabel.textContent = 'بارگذاری از حافظه ذخیره‌شده...';
                return;
            }
            if (p.percent === null || p.percent === undefined) {
                els.modelProgressFill.classList.add('is-indeterminate');
                if (els.modelProgressLabel) {
                    els.modelProgressLabel.textContent = 'دانلود شده: ' + (Math.round(p.loaded / 1024 / 1024 * 10) / 10) + ' مگابایت';
                }
                return;
            }
            els.modelProgressFill.classList.remove('is-indeterminate');
            els.modelProgressFill.style.width = Math.max(2, p.percent) + '%';
            if (els.modelProgressLabel) els.modelProgressLabel.textContent = p.percent + '٪ دانلود شده';
        });
        window.VoiceEngine.on('model-ready', function () {
            if (els.modelProgress) els.modelProgress.style.display = 'none';
            if (els.orbContainer && els.orbContainer.classList.contains('is-loading-model')) {
                setOrbState('idle');
                setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
            }
        });
        window.VoiceEngine.on('interim', function (text) {
            setTranscript(text, true);
        });
        window.VoiceEngine.on('final', function (text) {
            handleTranscript(text, 'voice');
        });
        window.VoiceEngine.on('audio', onAudioData);
        window.VoiceEngine.on('end', function () {
            if (els.orbContainer) els.orbContainer.classList.remove('recording');
            if (els.orbContainer) els.orbContainer.style.setProperty('--audio-level', '0.15');
            const cur = els.orbContainer && els.orbContainer.classList;
            if (cur && !cur.contains('is-processing') && !cur.contains('is-success') && !cur.contains('is-error')) {
                setOrbState('idle');
                setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
            }
        });
        window.VoiceEngine.on('error', function (info) {
            if (els.modelProgress) els.modelProgress.style.display = 'none';
            setOrbState('error');
            setStatus(info.title || 'خطا', 'error');
            showResult((info.title ? '<strong>' + info.title + '</strong><br>' : '') + (info.message || ''), 'error');
            renderEnvironmentBanner();
        });
    }

    // ============================================
    // INIT
    // ============================================
    function init() {
        cacheEls();
        renderEnvironmentBanner();
        wireVoiceEngineEvents();
        renderHistory();
        spawnEmbers();

        setOrbState('idle');
        setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
        setTranscript('', false);
        if (els.result) els.result.style.display = 'none';

        if (els.orbContainer) els.orbContainer.addEventListener('click', onMicClick);

        if (els.ttsToggle) {
            updateTtsToggleIcon();
            updateTtsAvailability();
            els.ttsToggle.addEventListener('click', toggleVoiceOutput);
        }

        document.querySelectorAll('.voice-example-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                const cmd = this.dataset.command;
                if (cmd) handleTranscript(cmd, 'chip');
            });
        });

        if (els.textSend && els.textInput) {
            const send = function () {
                const val = els.textInput.value.trim();
                if (val) { handleTranscript(val, 'text'); els.textInput.value = ''; }
            };
            els.textSend.addEventListener('click', send);
            els.textInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); send(); }
            });
        }

        if (els.clearHistoryBtn) {
            els.clearHistoryBtn.addEventListener('click', function () {
                voiceHistory = [];
                try { localStorage.removeItem('voiceHistory'); } catch (e) {}
                renderHistory();
                showResult('تاریخچه پاک شد', 'info');
            });
        }

        // ============================================
        // DEBUG PANEL
        // ============================================
        const debugDiv = document.createElement('div');
        debugDiv.id = 'voiceDebug';
        debugDiv.style.cssText = 'display:none; background:#1e293b; color:#e2e8f0; padding:10px; border-radius:8px; margin-top:10px; font-size:12px; direction:ltr; text-align:left; font-family:monospace; overflow-wrap:break-word;';
        document.querySelector('.voice-container').appendChild(debugDiv);

        // Toggle debug by clicking status text 3 times
        let clickCount = 0;
        let clickTimer = null;
        if (els.status) {
            els.status.addEventListener('click', function() {
                clickCount++;
                if (clickCount === 3) {
                    debugDiv.style.display = debugDiv.style.display === 'none' ? 'block' : 'none';
                    clickCount = 0;
                }
                clearTimeout(clickTimer);
                clickTimer = setTimeout(() => { clickCount = 0; }, 800);
            });
        }

        // Enable debug via URL parameter
        try {
            if (new URLSearchParams(window.location.search).get('debug') === '1') {
                debugDiv.style.display = 'block';
            }
        } catch (e) {}
    }

    window.VoiceUI = { showResult: showResult, appendTip: appendTip };
    window.initVoiceTab = init;
})(window, document);
