/* ============================================
   FoxiMed — Koochik ASR adapter (sherpa-onnx WebAssembly)
   ============================================
   This file deliberately does NOT implement DSP, FastConformer caches,
   ONNX tensor plumbing, or CTC decoding itself. Those are owned by the
   official sherpa-onnx streaming runtime built by GitHub Actions into:

       ./sherpa-koochik/

   The build embeds the official Shenava Koochik v1.0 114M streaming INT8
   NeMo CTC model as nemo-ctc.onnx plus tokens.txt in Emscripten's .data
   package. The public KoochikASR API stays compatible with
   voice-recognition.js so the rest of FoxiMed is unchanged.
   ============================================ */
(function (window) {
    'use strict';

    const DEFAULT_BASE_URL = './sherpa-koochik/';
    const WRAPPER_FILE = 'sherpa-onnx-asr.js';
    const RUNTIME_FILE = 'sherpa-onnx-wasm-main-asr.js';
    const MODEL_PATH = './nemo-ctc.onnx';
    const TOKENS_PATH = './tokens.txt';
    const SAMPLE_RATE = 16000;

    let runtimePromise = null;
    let moduleRef = null;
    let recognizer = null;
    let currentBaseUrl = null;

    function ensureSlash(s) {
        s = String(s || DEFAULT_BASE_URL);
        return s.endsWith('/') ? s : s + '/';
    }

    function createError(code, message) {
        const e = new Error(message || code);
        e.code = code;
        return e;
    }


    // sherpa's own browser ASR example feeds 16 kHz PCM to acceptWaveform().
    // Keep that exact contract even when the browser insists on a 44.1/48 kHz
    // AudioContext. This simple area-average downsampler mirrors the official
    // demo and, importantly, never reads outside the current chunk.
    function toModelSampleRate(samples, inputRate) {
        const src = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
        const sr = Number(inputRate) || SAMPLE_RATE;
        if (!src.length || sr === SAMPLE_RATE) return new Float32Array(src);
        if (sr < SAMPLE_RATE) {
            // Rare browser/device case: linear interpolation for upsampling.
            const outLen = Math.max(1, Math.round(src.length * SAMPLE_RATE / sr));
            const out = new Float32Array(outLen);
            const scale = sr / SAMPLE_RATE;
            for (let i = 0; i < outLen; i++) {
                const pos = i * scale;
                const a = Math.min(src.length - 1, Math.floor(pos));
                const b = Math.min(src.length - 1, a + 1);
                const t = pos - a;
                out[i] = src[a] + (src[b] - src[a]) * t;
            }
            return out;
        }
        const ratio = sr / SAMPLE_RATE;
        const outLen = Math.max(1, Math.round(src.length / ratio));
        const out = new Float32Array(outLen);
        let srcOffset = 0;
        for (let i = 0; i < outLen; i++) {
            const next = Math.min(src.length, Math.round((i + 1) * ratio));
            let sum = 0;
            let n = 0;
            for (let j = srcOffset; j < next; j++) {
                const v = src[j];
                if (Number.isFinite(v)) { sum += v; n++; }
            }
            out[i] = n ? sum / n : 0;
            srcOffset = next;
        }
        return out;
    }

    function signalStats(samples) {
        let peak = 0;
        let sumSq = 0;
        let finite = 0;
        for (let i = 0; i < samples.length; i++) {
            const v = samples[i];
            if (!Number.isFinite(v)) continue;
            const a = Math.abs(v);
            if (a > peak) peak = a;
            sumSq += v * v;
            finite++;
        }
        return {
            peak: peak,
            rms: finite ? Math.sqrt(sumSq / finite) : 0,
            nonFinite: samples.length - finite
        };
    }

    function loadClassicScript(src, id) {
        return new Promise(function (resolve, reject) {
            const old = document.getElementById(id);
            if (old && old.dataset.loaded === '1') {
                resolve();
                return;
            }
            if (old) old.remove();

            const s = document.createElement('script');
            s.id = id;
            s.src = src;
            s.async = false;
            s.onload = function () {
                s.dataset.loaded = '1';
                resolve();
            };
            s.onerror = function () {
                try { s.remove(); } catch (e) {}
                reject(createError('script-load-failed', 'script-load-failed: ' + src));
            };
            document.head.appendChild(s);
        });
    }

    function parseStatus(status, onProgress) {
        if (typeof onProgress !== 'function') return;
        status = String(status || '');
        const m = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
        if (m) {
            const loaded = Number(m[1]);
            const total = Number(m[2]);
            onProgress({
                loaded: loaded,
                total: total,
                percent: total > 0 ? Math.max(0, Math.min(100, loaded * 100 / total)) : 0,
                status: 'download'
            });
            return;
        }
        if (/Running\.\.\./i.test(status)) {
            onProgress({ percent: 100, status: 'initializing' });
        }
    }

    function makeRecognizerConfig() {
        return {
            featConfig: {
                sampleRate: SAMPLE_RATE,
                featureDim: 80
            },
            modelConfig: {
                transducer: { encoder: '', decoder: '', joiner: '' },
                paraformer: { encoder: '', decoder: '' },
                zipformer2Ctc: { model: '' },
                nemoCtc: { model: MODEL_PATH },
                toneCtc: { model: '' },
                tokens: TOKENS_PATH,
                numThreads: 1,
                provider: 'cpu',
                debug: 0,
                modelType: '',
                modelingUnit: '',
                bpeVocab: ''
            },
            decodingMethod: 'greedy_search',
            maxActivePaths: 4,
            enableEndpoint: 1,
            rule1MinTrailingSilence: 2.4,
            rule2MinTrailingSilence: 1.2,
            rule3MinUtteranceLength: 20,
            hotwordsFile: '',
            hotwordsScore: 1.5,
            blankPenalty: 0,
            ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
            ruleFsts: '',
            ruleFars: ''
        };
    }

    function createRecognizerIfNeeded() {
        if (recognizer) return recognizer;
        if (!moduleRef || typeof window.createOnlineRecognizer !== 'function') {
            throw createError('sherpa-runtime-not-ready');
        }
        recognizer = window.createOnlineRecognizer(moduleRef, makeRecognizerConfig());
        if (!recognizer || !recognizer.handle) {
            recognizer = null;
            throw createError('sherpa-recognizer-create-failed');
        }
        console.log('[KoochikASR] sherpa recognizer ready:',
            'model=Koochik-v1.0-streaming-int8',
            '| sampleRate=16000',
            '| endpoint=2.4/1.2/20');
        return recognizer;
    }

    function ensureRuntime(baseUrl, onProgress, signal) {
        baseUrl = ensureSlash(baseUrl);
        if (runtimePromise && currentBaseUrl === baseUrl) return runtimePromise;
        if (runtimePromise && currentBaseUrl !== baseUrl) {
            return Promise.reject(createError('sherpa-base-url-changed'));
        }
        currentBaseUrl = baseUrl;

        runtimePromise = new Promise(function (resolve, reject) {
            if (signal && signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }

            let settled = false;
            function fail(err) {
                if (settled) return;
                settled = true;
                runtimePromise = null;
                reject(err);
            }
            function done() {
                if (settled) return;
                try {
                    createRecognizerIfNeeded();
                    settled = true;
                    resolve(moduleRef);
                } catch (e) {
                    fail(e);
                }
            }

            const Module = {};
            moduleRef = Module;
            // The generated Emscripten .js lives beside its .wasm/.data files.
            // Force every runtime asset lookup to our generated deployment dir.
            Module.locateFile = function (path) {
                return baseUrl + path;
            };
            Module.setStatus = function (status) {
                console.log('[KoochikASR] sherpa status:', status);
                parseStatus(status, onProgress);
            };
            Module.print = function () {
                console.log.apply(console, ['[sherpa]'].concat(Array.from(arguments)));
            };
            Module.printErr = function () {
                console.warn.apply(console, ['[sherpa]'].concat(Array.from(arguments)));
            };
            Module.onAbort = function (reason) {
                fail(createError('sherpa-wasm-abort', String(reason || 'sherpa-wasm-abort')));
            };
            Module.onRuntimeInitialized = function () {
                console.log('[KoochikASR] sherpa WASM runtime initialized');
                done();
            };
            window.Module = Module;

            let abortHandler = null;
            if (signal) {
                abortHandler = function () {
                    // Emscripten owns the underlying .data fetch, so we can stop
                    // using the result but cannot reliably abort that internal
                    // fetch from here. Keep the cancellation semantics honest.
                    fail(new DOMException('Aborted', 'AbortError'));
                };
                signal.addEventListener('abort', abortHandler, { once: true });
            }

            loadClassicScript(baseUrl + WRAPPER_FILE, 'foximed-sherpa-wrapper')
                .then(function () {
                    if (typeof window.createOnlineRecognizer !== 'function') {
                        throw createError('sherpa-wrapper-invalid');
                    }
                    return loadClassicScript(baseUrl + RUNTIME_FILE, 'foximed-sherpa-runtime');
                })
                .then(function () {
                    // onRuntimeInitialized normally resolves us. If a cached
                    // Emscripten runtime is already initialized, allow that too.
                    if (moduleRef && moduleRef.calledRun && !settled) done();
                })
                .catch(fail)
                .finally(function () {
                    if (signal && abortHandler) {
                        try { signal.removeEventListener('abort', abortHandler); } catch (e) {}
                    }
                });
        });
        return runtimePromise;
    }

    class SherpaKoochikEngine {
        constructor(recognizerRef) {
            this.recognizer = recognizerRef;
            this.stream = null;
            this.totalSeconds = 0;
            this.lastText = '';
            this.endpoint = false;
            this.reset();
        }

        reset() {
            if (this.stream) {
                try { this.stream.free(); } catch (e) {}
            }
            this.stream = this.recognizer.createStream();
            this.totalSeconds = 0;
            this.lastText = '';
            this.endpoint = false;
        }

        feed(samples, sampleRate) {
            if (!this.stream || !samples || !samples.length) return;
            const inputRate = Number(sampleRate) || SAMPLE_RATE;
            const inputCopy = new Float32Array(samples);
            const inputStats = signalStats(inputCopy);
            const modelPcm = toModelSampleRate(inputCopy, inputRate);
            const modelStats = signalStats(modelPcm);

            // bufferedSeconds() describes real captured time, not the number
            // of samples after conversion.
            this.totalSeconds += inputCopy.length / inputRate;
            this.stream.acceptWaveform(SAMPLE_RATE, modelPcm);

            let loops = 0;
            const decodeStart = performance.now();
            while (this.recognizer.isReady(this.stream)) {
                this.recognizer.decode(this.stream);
                loops++;
                if (loops > 64) throw createError('sherpa-decode-loop');
            }

            const r = this.recognizer.getResult(this.stream);
            this.lastText = (r && r.text ? String(r.text) : '').trim();
            this.endpoint = !!this.recognizer.isEndpoint(this.stream);
            if (loops > 0) {
                console.log('[KoochikASR] sherpa decode:',
                    'steps=', loops,
                    '| ms=', (performance.now() - decodeStart).toFixed(1),
                    '| inputSr=', inputRate,
                    '| modelSr=', SAMPLE_RATE,
                    '| inputPeak=', inputStats.peak.toFixed(4),
                    '| inputRms=', inputStats.rms.toFixed(4),
                    '| modelPeak=', modelStats.peak.toFixed(4),
                    '| modelRms=', modelStats.rms.toFixed(4),
                    '| nonFinite=', modelStats.nonFinite,
                    '| text=', JSON.stringify(this.lastText),
                    '| endpoint=', this.endpoint);
            }
        }

        decode() {
            return Promise.resolve(this.lastText || '');
        }

        finalize() {
            if (!this.stream) return Promise.resolve(this.lastText || '');
            this.stream.inputFinished();
            let loops = 0;
            const finalStart = performance.now();
            while (this.recognizer.isReady(this.stream)) {
                this.recognizer.decode(this.stream);
                loops++;
                if (loops > 128) throw createError('sherpa-final-decode-loop');
            }
            const r = this.recognizer.getResult(this.stream);
            this.lastText = (r && r.text ? String(r.text) : '').trim();
            console.log('[KoochikASR] sherpa final:',
                'steps=', loops,
                '| ms=', (performance.now() - finalStart).toFixed(1),
                '| text=', JSON.stringify(this.lastText));
            return Promise.resolve(this.lastText || '');
        }

        endpointDetected() {
            // Rule 1 can legitimately report an endpoint after a few seconds
            // of what the recognizer considers silence. Do not let an all-blank
            // stream auto-stop before we have ever seen a token; this is both a
            // safer UX and an important diagnostic while validating Koochik.
            return !!(this.endpoint && this.lastText);
        }

        bufferedSeconds() {
            return this.totalSeconds;
        }

        supportsLivePartials() {
            return true;
        }

        executionProvider() {
            return 'sherpa-onnx-wasm-int8';
        }

        destroy() {
            if (this.stream) {
                try { this.stream.free(); } catch (e) {}
                this.stream = null;
            }
            // The recognizer is a singleton shared by this adapter. Freeing it
            // releases the ORT session/weights; the Emscripten runtime itself
            // remains loaded in the page and can recreate the recognizer later.
            if (recognizer) {
                try { recognizer.free(); } catch (e) {}
                recognizer = null;
            }
        }
    }

    window.KoochikASR = {
        load: function (options, onProgress) {
            options = options || {};
            return ensureRuntime(options.baseUrl || DEFAULT_BASE_URL, onProgress, options.signal)
                .then(function () {
                    return new SherpaKoochikEngine(createRecognizerIfNeeded());
                });
        },
        runtime: 'sherpa-onnx-wasm',
        model: 'Shenava-Koochik-v1.0-streaming-int8'
    };
})(window);
