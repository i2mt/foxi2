/* FoxiMed — on-device Whisper capture adapter.
 *
 * Audio stays on the device. The model/runtime are downloaded lazily into a
 * dedicated worker and reused for later utterances. This adapter deliberately
 * exposes the same small engine interface as KoochikASR so voice-recognition.js
 * can keep one microphone/UI path for both engines.
 */
(function (window) {
    'use strict';

    const SAMPLE_RATE = 16000;
    const WORKER_URL = './whisper-worker.js?v=37';
    const LOAD_TIMEOUT_MS = 15 * 60 * 1000;
    const ENERGY_FRAME_SAMPLES = 320;
    const START_RMS = 0.015;
    const START_PEAK = 0.030;
    const START_CONFIRM_FRAMES = 4;
    const SILENCE_SECONDS = 0.85;
    const NO_SPEECH_SECONDS = 4.5;
    const MAX_SECONDS = 12;

    let worker = null;
    let workerModel = '';
    let workerReadyPromise = null;
    let requestId = 0;
    const pending = new Map();

    function shutdown(reason) {
        if (worker) {
            try { worker.terminate(); } catch (_) {}
        }
        worker = null;
        workerModel = '';
        workerReadyPromise = null;
        const error = reason instanceof Error ? reason : new Error(String(reason || 'whisper-worker-stopped'));
        pending.forEach(function (entry) { entry.reject(error); });
        pending.clear();
    }

    async function probeWebGPU() {
        if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return null;
        try { return await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); }
        catch (_) { return null; }
    }

    function ensureWorker(model, onProgress, signal) {
        if (worker && workerModel === model && workerReadyPromise) return workerReadyPromise;
        if (worker && workerModel !== model) shutdown(new Error('whisper-model-changed'));

        workerModel = model;
        const created = new Worker(WORKER_URL, { type: 'module', name: 'foximed-whisper-' + model });
        worker = created;

        workerReadyPromise = new Promise(function (resolve, reject) {
            let settled = false;
            const timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                shutdown(new Error('whisper-load-timeout'));
                reject(new Error('whisper-load-timeout'));
            }, LOAD_TIMEOUT_MS);

            function abort() {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                shutdown(new DOMException('Whisper load cancelled', 'AbortError'));
                reject(new DOMException('Whisper load cancelled', 'AbortError'));
            }
            if (signal) {
                if (signal.aborted) return abort();
                signal.addEventListener('abort', abort, { once: true });
            }

            created.onmessage = function (event) {
                const msg = event.data || {};
                if (msg.type === 'progress') {
                    if (typeof onProgress === 'function') onProgress(msg.progress || {});
                    return;
                }
                if (msg.type === 'ready') {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        if (signal) signal.removeEventListener('abort', abort);
                        console.log('[WhisperASR] model ready:', model);
                        resolve();
                    }
                    return;
                }
                // A load-time worker error has no transcription requestId.
                // Previously it fell through to the pending-transcription
                // map, found no entry, and left this promise spinning until
                // the 15-minute timeout. Reject the model load immediately.
                if (msg.type === 'error' && !settled) {
                    settled = true;
                    clearTimeout(timer);
                    if (signal) signal.removeEventListener('abort', abort);
                    const loadError = new Error(msg.message || 'whisper-model-load-failed');
                    loadError.code = msg.code || '';
                    reject(loadError);
                    return;
                }
                if (msg.type === 'result' || msg.type === 'error') {
                    const entry = pending.get(msg.requestId);
                    if (!entry) return;
                    pending.delete(msg.requestId);
                    if (msg.type === 'result') {
                        if (msg.rejectedReason) console.warn('[WhisperASR] ignored likely background-noise hallucination:', msg.rejectedReason);
                        entry.resolve(String(msg.text || '').trim());
                    }
                    else entry.reject(new Error(msg.message || 'whisper-inference-failed'));
                }
            };
            created.onerror = function (event) {
                const error = new Error('whisper-worker-error: ' + (event && event.message ? event.message : 'unknown'));
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    reject(error);
                }
                shutdown(error);
            };
            created.postMessage({ type: 'load', model: model });
        }).catch(function (error) {
            console.error('[WhisperASR] model initialization failed:', error);
            if (worker === created) shutdown(error);
            throw error;
        });
        return workerReadyPromise;
    }

    function resample(input, inputRate) {
        const src = input instanceof Float32Array ? input : new Float32Array(input || []);
        const rate = Number(inputRate) || SAMPLE_RATE;
        if (!src.length) return new Float32Array(0);
        if (rate === SAMPLE_RATE) return new Float32Array(src);
        const length = Math.max(1, Math.round(src.length * SAMPLE_RATE / rate));
        const out = new Float32Array(length);
        const scale = rate / SAMPLE_RATE;
        for (let i = 0; i < length; i++) {
            const position = i * scale;
            const a = Math.min(src.length - 1, Math.floor(position));
            const b = Math.min(src.length - 1, a + 1);
            const fraction = position - a;
            const av = Number.isFinite(src[a]) ? src[a] : 0;
            const bv = Number.isFinite(src[b]) ? src[b] : 0;
            out[i] = av + (bv - av) * fraction;
        }
        return out;
    }

    class WhisperEngine {
        constructor(model) {
            this.model = model;
            this.reset();
        }

        reset() {
            this.chunks = [];
            this.samples = 0;
            this.lastAudioStats = null;
            this.endpoint = false;
            this.speech = false;
            this.confirmFrames = 0;
            this.lastVoiceSample = 0;
            this.frameRemainder = new Float32Array(0);
        }

        feed(samples, sampleRate) {
            const pcm = resample(samples, sampleRate);
            if (!pcm.length || this.endpoint) return;
            this.chunks.push(pcm);
            this.samples += pcm.length;

            const merged = new Float32Array(this.frameRemainder.length + pcm.length);
            merged.set(this.frameRemainder, 0);
            merged.set(pcm, this.frameRemainder.length);
            let offset = 0;
            while (offset + ENERGY_FRAME_SAMPLES <= merged.length) {
                let sumSq = 0;
                let peak = 0;
                for (let i = offset; i < offset + ENERGY_FRAME_SAMPLES; i++) {
                    const value = Number.isFinite(merged[i]) ? merged[i] : 0;
                    sumSq += value * value;
                    peak = Math.max(peak, Math.abs(value));
                }
                const rms = Math.sqrt(sumSq / ENERGY_FRAME_SAMPLES);
                const voiced = rms >= START_RMS || peak >= START_PEAK;
                if (!this.speech) {
                    this.confirmFrames = voiced ? this.confirmFrames + 1 : 0;
                    if (this.confirmFrames >= START_CONFIRM_FRAMES) {
                        this.speech = true;
                        this.lastVoiceSample = this.samples - (merged.length - offset);
                    }
                } else if (voiced) {
                    this.lastVoiceSample = this.samples - (merged.length - offset);
                }
                offset += ENERGY_FRAME_SAMPLES;
            }
            this.frameRemainder = merged.slice(offset);

            const seconds = this.samples / SAMPLE_RATE;
            if (this.speech && (this.samples - this.lastVoiceSample) / SAMPLE_RATE >= SILENCE_SECONDS) this.endpoint = true;
            if (!this.speech && seconds >= NO_SPEECH_SECONDS) this.endpoint = true;
            if (seconds >= MAX_SECONDS) this.endpoint = true;
        }

        exportAudio() {
            const out = new Float32Array(this.samples);
            let offset = 0;
            this.chunks.forEach(function (chunk) { out.set(chunk, offset); offset += chunk.length; });
            return out;
        }

        finalize() {
            if (!worker || !workerReadyPromise) return Promise.reject(new Error('whisper-worker-not-ready'));
            const audio = this.exportAudio();
            if (audio.length < SAMPLE_RATE * 0.15) return Promise.resolve('');
            let sumSq = 0;
            let peak = 0;
            for (let i = 0; i < audio.length; i++) {
                const value = Number.isFinite(audio[i]) ? audio[i] : 0;
                sumSq += value * value;
                peak = Math.max(peak, Math.abs(value));
            }
            this.lastAudioStats = {
                rms: Math.sqrt(sumSq / audio.length),
                peak: peak
            };
            const id = ++requestId;
            return new Promise(function (resolve, reject) {
                pending.set(id, { resolve: resolve, reject: reject });
                worker.postMessage({ type: 'transcribe', requestId: id, audio: audio.buffer }, [audio.buffer]);
            });
        }

        decode() { return Promise.resolve(''); }
        endpointDetected() { return this.endpoint; }
        bufferedSeconds() { return this.samples / SAMPLE_RATE; }
        audioStats() { return this.lastAudioStats || null; }
        supportsLivePartials() { return false; }
        executionProvider() { return 'transformersjs-webgpu-whisper-' + this.model; }
        destroy() { shutdown(new DOMException('Whisper released', 'AbortError')); return Promise.resolve(); }
    }

    window.WhisperASR = {
        probe: probeWebGPU,
        load: async function (options, onProgress) {
            options = options || {};
            const model = options.model === 'tiny' ? 'tiny' : 'base';
            const adapter = await probeWebGPU();
            if (!adapter) throw new Error('webgpu-unavailable');
            await ensureWorker(model, onProgress, options.signal);
            return new WhisperEngine(model);
        },
        release: function () { shutdown(new DOMException('Whisper released', 'AbortError')); },
        runtime: 'transformers.js-webgpu',
        models: ['onnx-community/whisper-base', 'onnx-community/whisper-tiny']
    };
})(window);
