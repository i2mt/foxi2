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
     window.VoiceUI.showConfirmation(message, onConfirm, onCancel)
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
            autocomplete: qs('voiceAutocomplete'),
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
        // The transcript only matters while something is actively being
        // heard/handled — keep it out of the layout otherwise.
        if (els.transcriptArea) {
            els.transcriptArea.style.display = (state === 'listening' || state === 'processing') ? '' : 'none';
        }
        // Hide the example chips while busy so the page stays compact and
        // doesn't compete with the live transcript/result for attention.
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

    function showConfirmation(message, onConfirm, onCancel) {
        if (!els.result) return;
        clearTimeout(resultClearTimer);
        els.result.style.display = 'block';
        els.result.className = 'voice-result info voice-confirmation';
        while (els.result.firstChild) els.result.removeChild(els.result.firstChild);

        const title = document.createElement('strong');
        title.className = 'voice-confirm-title';
        title.textContent = 'تأیید دستور بالینی';

        const text = document.createElement('span');
        text.className = 'voice-result-text voice-confirm-text';
        text.textContent = message;

        const actions = document.createElement('div');
        actions.className = 'voice-confirm-actions';
        const approve = document.createElement('button');
        approve.type = 'button';
        approve.className = 'voice-confirm-button approve';
        approve.textContent = 'تأیید و اجرا';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'voice-confirm-button cancel';
        cancel.textContent = 'لغو';
        actions.appendChild(approve);
        actions.appendChild(cancel);

        els.result.appendChild(title);
        els.result.appendChild(text);
        els.result.appendChild(actions);
        setStatus('مقادیر را بررسی و تأیید کنید', 'processing');
        setOrbState('processing');

        let settled = false;
        function finish(callback) {
            if (settled) return;
            settled = true;
            approve.disabled = true;
            cancel.disabled = true;
            els.result.style.display = 'none';
            if (typeof callback === 'function') callback();
        }
        approve.addEventListener('click', function () { finish(onConfirm); });
        cancel.addEventListener('click', function () { finish(onCancel); });
    }

    function showOnlineFallback(info) {
        if (!els.result) return;
        clearTimeout(resultClearTimer);
        els.result.style.display = 'block';
        els.result.className = 'voice-result info voice-confirmation';
        while (els.result.firstChild) els.result.removeChild(els.result.firstChild);

        const title = document.createElement('strong');
        title.className = 'voice-confirm-title';
        title.textContent = info.title || 'موتور آفلاین آماده نشد';

        const text = document.createElement('span');
        text.className = 'voice-result-text voice-confirm-text';
        text.textContent = (info.message || '') + ' می‌توانید این بار از سرویس آنلاین مرورگر استفاده کنید؛ صدا برای تشخیص به سرویس مرورگر فرستاده می‌شود.';

        const actions = document.createElement('div');
        actions.className = 'voice-confirm-actions';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'voice-confirm-button approve';
        retry.textContent = 'تلاش آنلاین';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'voice-confirm-button cancel';
        cancel.textContent = 'فعلاً نه';
        actions.appendChild(retry);
        actions.appendChild(cancel);

        els.result.appendChild(title);
        els.result.appendChild(text);
        els.result.appendChild(actions);
        setOrbState('error');
        setStatus('موتور آفلاین در دسترس نیست', 'error');

        retry.addEventListener('click', function () {
            retry.disabled = true;
            cancel.disabled = true;
            els.result.style.display = 'none';
            if (window.VoiceEngine) window.VoiceEngine.startOnline();
        });
        cancel.addEventListener('click', function () {
            els.result.style.display = 'none';
            setOrbState('idle');
            setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
        });
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
    // Off by default — an ICU floor isn't always the place for a phone to
    // talk back out loud — but one tap turns it on, and it's a separate,
    // much simpler API than SpeechRecognition so it isn't affected by any
    // of the iOS limitations above.
    //
    // Important limitation: this only sounds decent if the device has an
    // actual Persian (fa-IR) system voice installed. Many platforms don't
    // ship one at all — iOS in particular appears to fall back to an
    // Arabic-ish voice that mispronounces Persian badly. Rather than ever
    // produce that, this checks for a real fa-* voice and simply hides the
    // toggle (and refuses to speak) if none exists, on any platform.
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
        // Spoken output has been disabled — it wasn't reading results back
        // in a clear, natural way. Keeping this function (rather than
        // deleting the toggle wiring) so it's a one-line revert if this
        // gets revisited later, but the toggle stays hidden unconditionally
        // and voiceOutput is forced off, including for anyone who has an
        // old localStorage value from before this was turned off.
        if (els.ttsToggle) els.ttsToggle.style.display = 'none';
        if (els.headerSpacer) els.headerSpacer.style.display = 'none';
        if (window.AppState && window.AppState.settings) {
            window.AppState.settings.voiceOutput = false;
        }
    }
    function stripForSpeech(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        let text = tmp.textContent || tmp.innerText || '';
        // Strip emoji — some TTS voices (notably on Windows) read these out
        // loud as descriptions ("loudspeaker emoji") instead of skipping
        // them, which is exactly as confusing as it sounds.
        text = text.replace(/\p{Extended_Pictographic}/gu, '');
        text = text.replace(/[\u200D\uFE0F]/g, ''); // stray joiners/variation selectors left behind
        return text.replace(/\s+/g, ' ').trim();
    }
    function isVoiceOutputOn() {
        return typeof AppState !== 'undefined' && !!(AppState && AppState.settings && AppState.settings.voiceOutput);
    }
    function speak(message) {
        return; // spoken output disabled — see updateTtsAvailability()
        /* eslint-disable no-unreachable */
        if (!window.speechSynthesis || !isVoiceOutputOn()) return;
        const voice = pickPersianVoice();
        if (!voice) return; // no real Persian voice on this device — stay silent rather than mispronounce
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
        return; // spoken output disabled — see updateTtsAvailability()
    }

    // ============================================
    // VOICE LEARNING LOG (export / clear)
    // See the long comment in voice-commands.js next to
    // logUnrecognizedPhrase() for the full reasoning — short version: this
    // is a local-only, privacy-respecting substitute for real cross-user
    // learning, which would require a server this app doesn't (and, given
    // the sanctions situation covered earlier, largely can't) have.
    // ============================================
    function wireVoiceLearningLogButtons() {
        const exportBtn = document.getElementById('exportVoiceLogBtn');
        const clearBtn = document.getElementById('clearVoiceLogBtn');
        if (!window.VoiceCommands) return;

        if (exportBtn) {
            exportBtn.addEventListener('click', function () {
                const text = window.VoiceCommands.exportUnrecognizedLogAsText();
                if (navigator.share) {
                    navigator.share({ title: 'فهرست عبارات درک‌نشده FoxiMed', text: text }).catch(function () {});
                } else if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(text)
                        .then(function () { if (typeof showToast === 'function') showToast('کپی شد', 'فهرست در کلیپ‌بورد کپی شد', 'success'); })
                        .catch(function () { if (typeof showToast === 'function') showToast('خطا', 'کپی کردن ممکن نشد', 'error'); });
                } else if (typeof showToast === 'function') {
                    showToast('خطا', 'این قابلیت در این مرورگر در دسترس نیست', 'error');
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                window.VoiceCommands.clearUnrecognizedLog();
                if (typeof showToast === 'function') showToast('پاک شد', 'فهرست عبارات درک‌نشده پاک شد', 'success');
            });
        }
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
    // The ripples/embers/glow are all driven by CSS state classes already,
    // so the only thing JS needs to push per audio frame is the real mic
    // level — it drives glow intensity and eye-spark brightness via the
    // --audio-level custom property (see voice-assistant.css).
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
    // ENVIRONMENT BANNER (iOS / unsupported messaging)
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
                if (els.modelProgressLabel) els.modelProgressLabel.textContent = 'در حال شروع دانلود موتور Rizeh (حدود ۵۵ مگابایت)...';
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
            // Only fall back to idle if we're not mid-processing/result.
            const cur = els.orbContainer && els.orbContainer.classList;
            if (cur && !cur.contains('is-processing') && !cur.contains('is-success') && !cur.contains('is-error')) {
                setOrbState('idle');
                setStatus('برای شروع، دکمه را بزنید یا تایپ کنید');
            }
        });
        window.VoiceEngine.on('error', function (info) {
            if (els.modelProgress) els.modelProgress.style.display = 'none';
            if (info && info.onlineFallbackAvailable) {
                showOnlineFallback(info);
                return;
            }
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

        wireVoiceLearningLogButtons();

        document.querySelectorAll('.voice-example-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                const cmd = this.dataset.command;
                if (cmd) handleTranscript(cmd, 'chip');
            });
        });

        // ============================================
        // DRUG-NAME AUTOCOMPLETE
        // Mainly for uncommon/hard-to-pronounce pharmaceutical names the
        // offline voice model can't reliably recognize by voice at all
        // (a model-training vocabulary limit, not something a JS-level
        // fix can patch) — this makes typing genuinely fast for exactly
        // those cases instead of requiring the full name to be typed out
        // from memory.
        // ============================================
        function searchDrugSuggestions(fragment) {
            if (!window.drugDatabase || !fragment) return [];
            const lower = fragment.toLowerCase();
            const matches = [];
            for (const id in window.drugDatabase) {
                const drug = window.drugDatabase[id];
                const names = [drug.persianName, drug.englishName].concat(drug.alternativeNames || []);
                const hit = names.some(function (n) { return String(n).toLowerCase().indexOf(lower) !== -1; });
                if (hit) matches.push(drug);
                if (matches.length >= 6) break;
            }
            return matches;
        }

        function renderAutocomplete(matches) {
            if (!els.autocomplete) return;
            if (!matches.length) { els.autocomplete.style.display = 'none'; els.autocomplete.innerHTML = ''; return; }
            els.autocomplete.innerHTML = matches.map(function (drug) {
                return '<button type="button" class="voice-autocomplete-item" data-drug="' + drug.persianName.replace(/"/g, '&quot;') + '">' +
                    '<span class="voice-autocomplete-name">' + drug.persianName + '</span>' +
                    '<span class="voice-autocomplete-en">' + drug.englishName + '</span>' +
                    '</button>';
            }).join('');
            els.autocomplete.style.display = 'block';
            els.autocomplete.querySelectorAll('.voice-autocomplete-item').forEach(function (btn) {
                // mousedown (not click) so this fires BEFORE the input's
                // blur event would otherwise hide the dropdown first.
                btn.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    if (!els.textInput) return;
                    els.textInput.value = btn.dataset.drug + ' ';
                    els.textInput.focus();
                    renderAutocomplete([]);
                });
            });
        }

        if (els.textInput) {
            els.textInput.addEventListener('input', function () {
                const val = els.textInput.value.trim();
                // Only search once there's a real fragment to match, and
                // only on the LAST word being typed — so autocomplete
                // still works naturally mid-sentence (e.g. after already
                // typing "قطره 500 میلی لیتر" and starting a drug name).
                const lastWord = val.split(/\s+/).pop();
                if (!lastWord || lastWord.length < 2) { renderAutocomplete([]); return; }
                renderAutocomplete(searchDrugSuggestions(lastWord));
            });
            els.textInput.addEventListener('blur', function () {
                // Slight delay so a tap on a suggestion (mousedown) has
                // already run before the dropdown disappears.
                setTimeout(function () { renderAutocomplete([]); }, 150);
            });
        }

        if (els.textSend && els.textInput) {
            const send = function () {
                const val = els.textInput.value.trim();
                if (val) { handleTranscript(val, 'text'); els.textInput.value = ''; renderAutocomplete([]); }
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
    }

    window.VoiceUI = {
        showResult: showResult,
        showConfirmation: showConfirmation,
        appendTip: appendTip
    };
    window.initVoiceTab = init;
})(window, document);
