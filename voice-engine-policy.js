/* FoxiMed — deterministic local voice-engine selection policy.
 * Kept separate from the microphone code so the safety/fallback rules can
 * be tested without a browser or downloading a speech model.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.VoiceEnginePolicy = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';

    const MODES = ['auto', 'whisper-base', 'whisper-tiny', 'rizeh'];

    function normalizeMode(value) {
        return MODES.indexOf(value) >= 0 ? value : 'auto';
    }

    function choose(options) {
        options = options || {};
        const mode = normalizeMode(options.mode);
        const hasWebGPU = !!options.hasWebGPU;
        const lowPower = !!options.lowPower;
        const memory = Number(options.deviceMemory);

        if (mode === 'rizeh') return 'rizeh';
        // Whisper in Transformers.js uses WebGPU here. Do not silently run
        // Base on WASM/CPU: that is exactly the slow, memory-heavy path this
        // tiering is intended to avoid.
        if (mode === 'whisper-base' || mode === 'whisper-tiny') {
            return hasWebGPU ? mode : 'rizeh';
        }
        if (lowPower || !hasWebGPU) return 'rizeh';

        // navigator.deviceMemory is intentionally coarse and is not exposed
        // by Safari. Six-or-more is a conservative Base gate; unknown-memory
        // WebGPU devices get Tiny, then may be changed explicitly in Settings.
        if (Number.isFinite(memory) && memory >= 6) return 'whisper-base';
        if (!Number.isFinite(memory) || memory >= 4) return 'whisper-tiny';
        return 'rizeh';
    }

    return { MODES: MODES.slice(), normalizeMode: normalizeMode, choose: choose };
});
