/*
 * FoxiMed anonymous usage analytics.
 *
 * Privacy boundary: this module only sends whitelisted event/feature names and
 * coarse technical metadata. It never reads or sends names, form values,
 * calculator inputs/results, selected drugs, voice audio, or transcripts.
 */
(function () {
    'use strict';

    const QUEUE_KEY = 'foximed_analytics_queue_v1';
    const VISITOR_KEY = 'foximed_analytics_visitor_v1';
    const STANDALONE_SEEN_KEY = 'foximed_analytics_standalone_seen_v1';
    const MAX_QUEUE = 60;
    const EVENT_NAMES = new Set(['launch', 'pwa_installed', 'pwa_first_seen', 'tab_view', 'feature_used']);
    const FEATURES = new Set([
        'calculator', 'drug_reference', 'clinical_tools', 'voice_assistant',
        'infusion_calculation', 'reverse_infusion', 'manual_infusion',
        'voice_spoken', 'voice_typed', 'bmi', 'bsa', 'ibw', 'crcl',
        'dose_calculator', 'compatibility', 'gcs', 'burns', 'rass',
        'braden', 'morse', 'oxygen', 'ventilator', 'nutrition', 'vbg'
    ]);

    let enabled = true;
    let endpoint = '';
    let appVersion = '';
    let sessionId = makeId();
    let flushTimer = null;
    let flushing = false;

    function safeParse(value, fallback) {
        try { return JSON.parse(value); } catch (error) { return fallback; }
    }

    function makeId() {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
        const bytes = new Uint8Array(16);
        if (window.crypto && typeof window.crypto.getRandomValues === 'function') window.crypto.getRandomValues(bytes);
        else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
        return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    }

    function readSettingsEnabled() {
        const settings = safeParse(localStorage.getItem('appSettings') || '{}', {});
        return settings.anonymousAnalytics !== false;
    }

    function isStandalone() {
        return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true);
    }

    function displayMode() {
        if (isStandalone()) return 'standalone';
        if (window.matchMedia && window.matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui';
        return 'browser';
    }

    function platform() {
        const ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Windows/i.test(ua)) return 'windows';
        if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
        if (/Linux/i.test(ua)) return 'linux';
        return 'other';
    }

    function browser() {
        const ua = navigator.userAgent || '';
        if (/CriOS/i.test(ua)) return 'chrome-ios';
        if (/FxiOS/i.test(ua)) return 'firefox-ios';
        if (/EdgiOS|EdgA|Edg\//i.test(ua)) return 'edge';
        if (/OPR\//i.test(ua)) return 'opera';
        if (/Chrome|Chromium/i.test(ua)) return 'chrome';
        if (/Safari/i.test(ua)) return 'safari';
        if (/Firefox/i.test(ua)) return 'firefox';
        return 'other';
    }

    function visitorId() {
        let id = localStorage.getItem(VISITOR_KEY);
        if (!id || !/^[a-f0-9-]{16,64}$/i.test(id)) {
            id = makeId();
            localStorage.setItem(VISITOR_KEY, id);
        }
        return id;
    }

    function getQueue() {
        const queue = safeParse(localStorage.getItem(QUEUE_KEY) || '[]', []);
        return Array.isArray(queue) ? queue.slice(-MAX_QUEUE) : [];
    }

    function saveQueue(queue) {
        if (!queue.length) localStorage.removeItem(QUEUE_KEY);
        else localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE)));
    }

    function buildEvent(eventName, feature) {
        if (!EVENT_NAMES.has(eventName)) return null;
        const cleanFeature = feature && FEATURES.has(feature) ? feature : null;
        if ((eventName === 'tab_view' || eventName === 'feature_used') && !cleanFeature) return null;
        return {
            id: makeId(),
            visitor_id: visitorId(),
            session_id: sessionId,
            event: eventName,
            feature: cleanFeature,
            app_version: appVersion,
            display_mode: displayMode(),
            platform: platform(),
            browser: browser(),
            online: navigator.onLine !== false
        };
    }

    function scheduleFlush() {
        clearTimeout(flushTimer);
        flushTimer = setTimeout(flush, 450);
    }

    function track(eventName, feature) {
        if (!enabled || !endpoint || navigator.doNotTrack === '1') return false;
        const event = buildEvent(eventName, feature);
        if (!event) return false;
        const queue = getQueue();
        queue.push(event);
        saveQueue(queue);
        if (navigator.onLine !== false) scheduleFlush();
        return true;
    }

    async function flush() {
        if (flushing || !enabled || !endpoint || navigator.onLine === false) return;
        const queue = getQueue();
        if (!queue.length) return;
        const batch = queue.slice(0, 20);
        flushing = true;
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({ events: batch }),
                keepalive: true,
                cache: 'no-store',
                credentials: 'omit'
            });
            if (!response.ok) return;
            const sentIds = new Set(batch.map(item => item.id));
            saveQueue(getQueue().filter(item => !sentIds.has(item.id)));
        } catch (error) {
            // Offline and transient failures remain queued for a later launch.
        } finally {
            flushing = false;
            if (enabled && navigator.onLine !== false && getQueue().length) scheduleFlush();
        }
    }

    function setEnabled(value) {
        enabled = value !== false && navigator.doNotTrack !== '1';
        if (!enabled) {
            clearTimeout(flushTimer);
            localStorage.removeItem(QUEUE_KEY);
            localStorage.removeItem(VISITOR_KEY);
            localStorage.removeItem(STANDALONE_SEEN_KEY);
            sessionId = makeId();
        } else {
            track('launch');
        }
    }

    function init() {
        const meta = document.querySelector('meta[name="foximed-analytics-endpoint"]');
        endpoint = meta ? String(meta.content || '').trim() : '';
        appVersion = document.body ? String(document.body.dataset.appVersion || '') : '';
        enabled = readSettingsEnabled() && navigator.doNotTrack !== '1';
        if (!enabled || !endpoint) return;
        track('launch');
        if (isStandalone() && localStorage.getItem(STANDALONE_SEEN_KEY) !== 'true') {
            localStorage.setItem(STANDALONE_SEEN_KEY, 'true');
            track('pwa_first_seen');
        }
        flush();
    }

    window.FoxiAnalytics = {
        track: track,
        trackFeature: function (feature) { return track('feature_used', feature); },
        trackTab: function (feature) { return track('tab_view', feature); },
        setEnabled: setEnabled,
        flush: flush,
        isEnabled: function () { return enabled; }
    };

    window.addEventListener('online', flush);
    window.addEventListener('load', init, { once: true });
})();
