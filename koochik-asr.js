/* ============================================
   KoochikASR — Persian offline ASR engine
   ============================================
   Runs Shenava Koochik v1.0 (FastConformer CTC, ONNX fp16) entirely
   in-browser via onnxruntime-web. No custom WASM build required —
   this is a plain <script> CDN load, same shape as vosk-browser was.

   Model: Reza2kn/Shenava-Koochik-v1.0-ONNX-fp16
     - Single CTC graph (NOT encoder/decoder/joiner RNNT — that's the
       separate v1.5 export). Fixed input window of 2005 frames
       (~20.04s of audio at 16kHz).
     - inputs:  processed_signal        float16 [1, 80, 2005]
                processed_signal_length int64   [1]
     - outputs: logits                  float16 [1, 252, 1025]
                encoded_lengths         int64   [1]
     - blank_id: 1024, vocab size: 1025, output stride: 8

   Feature extraction contract (preprocessor.json):
     sample_rate 16000, n_fft 512, win_length 400, hop_length 160,
     n_mels 80, Hann (non-periodic), center=true with 256-sample
     reflect padding, preemphasis 0.97, Slaney mel scale, natural
     log with a 2^-24 floor, NO per-feature normalization.

   Runtime assets are supplied by config. In FoxiMed they currently
   point directly at the official Hugging Face export and are cached by
   this loader after the first successful download. No hand-generated mel
   filterbank is used: the official exported 80x257 matrix is loaded as-is.

   Public API:
     KoochikASR.load(config, onProgress) -> Promise<engine>
       config: { modelUrl, tokensUrl, melFiltersUrl, ortLibUrl,
                 ortWasmBaseUrl, cacheName, signal }
     engine.feed(float32Samples, sourceSampleRate)
     engine.decode() -> Promise<string>   // runs inference on the
                                           // currently buffered audio
     engine.reset()                       // clears the audio buffer
     engine.bufferedSeconds()
     engine.destroy()
   ============================================ */
(function (window) {
    'use strict';

    const SAMPLE_RATE = 16000;
    const N_FFT = 512;
    const WIN_LENGTH = 400;
    const HOP_LENGTH = 160;
    const N_MELS = 80;
    const N_FREQ_BINS = 257; // N_FFT / 2 + 1
    const FIXED_FRAMES = 2005;
    const PREEMPHASIS = 0.97;
    const CENTER_PAD = 256;
    const WINDOW_OFFSET = (N_FFT - WIN_LENGTH) / 2; // 56
    const LOG_ZERO_GUARD = Math.pow(2, -24);
    const BLANK_ID = 1024;
    const VOCAB_SIZE = 1025;
    const MAX_SAMPLES = (FIXED_FRAMES - 1) * HOP_LENGTH; // ~20.04s @16kHz
    const STREAM_FRAMES = 121;
    const STREAM_SHIFT = 112;
    const STREAM_FIRST_VALID = 105;
    const STREAM_OVERLAP = 9;
    const CACHE_LAYERS = 17;
    const CACHE_LEFT = 70;
    const CACHE_DMODEL = 512;
    const CACHE_TIME = 8;

    // Browser microphone gain varies dramatically between devices/sessions.
    // Koochik has no per-feature normalization, so very quiet captured audio
    // can shift the log-mel range far below what the model saw in a healthy
    // recording. Apply a conservative waveform gain only when there is a
    // plausible speech-level peak; do not amplify pure near-silence/noise.
    // This does not alter the official mel/preemphasis recipe.
    const QUIET_GAIN_MIN_PEAK = 0.040;
    const QUIET_GAIN_TARGET_PEAK = 0.60;
    const QUIET_GAIN_MAX = 12.0;
    const QUIET_GAIN_MIN_RMS = 0.008;

    // ============================================
    // Dynamic script loading (same pattern as the old vosk.js load)
    // ============================================
    function loadScriptOnce(url) {
        const existing = document.querySelector('script[src="' + url + '"]');
        if (existing) {
            if (existing.dataset.loaded === 'true') return Promise.resolve();
            return new Promise(function (resolve, reject) {
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { reject(new Error('script-load-failed')); });
            });
        }
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = function () { s.dataset.loaded = 'true'; resolve(); };
            s.onerror = function () { reject(new Error('script-load-failed')); };
            document.head.appendChild(s);
        });
    }

    // ============================================
    // fp16 <-> fp32 conversion
    // ============================================
    // IMPORTANT: do NOT install a Float16Array ponyfill globally before
    // loading ORT. onnxruntime-web 1.19.x historically represents fp16
    // CPU data as raw Uint16Array bits on browsers without native
    // Float16Array; modern browsers may expose a real Float16Array.
    // Handle both representations explicitly.
    const F32_VIEW = new Float32Array(1);
    const U32_VIEW = new Uint32Array(F32_VIEW.buffer);

    function float32ToFloat16Bits(value) {
        F32_VIEW[0] = value;
        const x = U32_VIEW[0];
        const sign = (x >>> 16) & 0x8000;
        let mantissa = (x >>> 12) & 0x07ff;
        const exponent = (x >>> 23) & 0xff;

        // Too small for fp16 (including tiny subnormals).
        if (exponent < 103) return sign;

        // Inf / NaN / overflow.
        if (exponent > 142) {
            if (exponent === 255 && (x & 0x007fffff)) return sign | 0x7e00;
            return sign | 0x7c00;
        }

        // fp16 subnormal.
        if (exponent < 113) {
            mantissa |= 0x0800;
            return sign | ((mantissa >>> (114 - exponent)) + ((mantissa >>> (113 - exponent)) & 1));
        }

        // Normal fp16, round-to-nearest-even.
        let out = sign | ((exponent - 112) << 10) | (mantissa >>> 1);
        out += mantissa & 1;
        return out & 0xffff;
    }

    function float32ArrayToFloat16Bits(arr) {
        const out = new Uint16Array(arr.length);
        for (let i = 0; i < arr.length; i++) out[i] = float32ToFloat16Bits(arr[i]);
        return out;
    }

    function float16BitsToFloat32(h) {
        const sign = (h & 0x8000) ? -1 : 1;
        const exp = (h >>> 10) & 0x1f;
        const frac = h & 0x03ff;
        if (exp === 0) return sign * Math.pow(2, -14) * (frac / 1024);
        if (exp === 0x1f) return frac ? NaN : sign * Infinity;
        return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
    }

    function float16BitsArrayToFloat32(arr) {
        const out = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i++) out[i] = float16BitsToFloat32(arr[i]);
        return out;
    }

    function makeOrtFloat16Input(arr) {
        // Let ORT see the browser's REAL native Float16Array if available.
        // Otherwise ORT 1.19.x uses Uint16Array as the fp16 bit container.
        if (typeof window.Float16Array === 'function') {
            return new window.Float16Array(arr);
        }
        return float32ArrayToFloat16Bits(arr);
    }

    function ortFloat16OutputToFloat32(data) {
        if (!data) throw new Error('missing-koochik-logits-data');

        // Native Float16Array yields numeric fp16 values when iterated.
        if (typeof window.Float16Array === 'function' && data instanceof window.Float16Array) {
            return Float32Array.from(data);
        }

        // Historical ORT-Web representation: raw IEEE-754 half bits.
        if (data instanceof Uint16Array) {
            return float16BitsArrayToFloat32(data);
        }

        // Defensive fallback for a future ORT representation.
        return Float32Array.from(data);
    }

    // ============================================
    // FFT — iterative radix-2 Cooley-Tukey, N=512 (power of two)
    // Returns UNNORMALIZED power (re^2 + im^2) for bins 0..N/2.
    // ============================================
    function bitReverseTable(n) {
        const bits = Math.log2(n);
        const table = new Uint32Array(n);
        for (let i = 0; i < n; i++) {
            let x = i, r = 0;
            for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
            table[i] = r;
        }
        return table;
    }
    const FFT_REV = bitReverseTable(N_FFT);
    // Precompute twiddle factors.
    const FFT_COS = new Float64Array(N_FFT / 2);
    const FFT_SIN = new Float64Array(N_FFT / 2);
    for (let i = 0; i < N_FFT / 2; i++) {
        const angle = -2 * Math.PI * i / N_FFT;
        FFT_COS[i] = Math.cos(angle);
        FFT_SIN[i] = Math.sin(angle);
    }

    function fftRealPower(frame /* Float32Array/Float64Array length N_FFT */, outPower /* Float32Array length 257, reused */) {
        const re = new Float64Array(N_FFT);
        const im = new Float64Array(N_FFT);
        for (let i = 0; i < N_FFT; i++) re[i] = frame[FFT_REV[i]];

        for (let size = 2; size <= N_FFT; size *= 2) {
            const half = size / 2;
            const step = N_FFT / size;
            for (let start = 0; start < N_FFT; start += size) {
                for (let k = 0; k < half; k++) {
                    const twIdx = k * step;
                    const c = FFT_COS[twIdx], s = FFT_SIN[twIdx];
                    const aRe = re[start + k], aIm = im[start + k];
                    const bRe = re[start + k + half], bIm = im[start + k + half];
                    const tRe = bRe * c - bIm * s;
                    const tIm = bRe * s + bIm * c;
                    re[start + k] = aRe + tRe;
                    im[start + k] = aIm + tIm;
                    re[start + k + half] = aRe - tRe;
                    im[start + k + half] = aIm - tIm;
                }
            }
        }
        for (let k = 0; k < N_FREQ_BINS; k++) {
            outPower[k] = re[k] * re[k] + im[k] * im[k];
        }
        return outPower;
    }

    // ============================================
    // Feature extraction: PCM (16kHz, Float32, -1..1) -> Koochik log-mel
    // ============================================
    function reflectIndex(i, length) {
        if (length <= 1) return 0;
        while (i < 0 || i >= length) {
            if (i < 0) i = -i;
            if (i >= length) i = 2 * length - i - 2;
        }
        return i;
    }

    const HANN = (function () {
        const w = new Float64Array(WIN_LENGTH);
        for (let i = 0; i < WIN_LENGTH; i++) {
            w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN_LENGTH - 1));
        }
        return w;
    })();

    function pcmToKoochikLogMel(pcm, melFilters) {
        if (pcm.length > MAX_SAMPLES) pcm = pcm.subarray(pcm.length - MAX_SAMPLES);

        const frameCount = Math.max(1, Math.min(FIXED_FRAMES, Math.floor(pcm.length / HOP_LENGTH) + 1));
        const features = new Float32Array(N_MELS * FIXED_FRAMES);

        const emphasized = new Float64Array(Math.max(1, pcm.length));
        if (pcm.length > 0) emphasized[0] = pcm[0];
        for (let i = 1; i < pcm.length; i++) emphasized[i] = pcm[i] - PREEMPHASIS * pcm[i - 1];

        const frame = new Float64Array(N_FFT);
        const power = new Float32Array(N_FREQ_BINS);

        for (let t = 0; t < frameCount; t++) {
            frame.fill(0);
            const frameStart = t * HOP_LENGTH - CENTER_PAD;
            for (let j = 0; j < N_FFT; j++) {
                const winIndex = j - WINDOW_OFFSET;
                if (winIndex < 0 || winIndex >= WIN_LENGTH) continue;
                const src = reflectIndex(frameStart + j, emphasized.length);
                frame[j] = emphasized[src] * HANN[winIndex];
            }
            fftRealPower(frame, power);
            for (let m = 0; m < N_MELS; m++) {
                const filter = melFilters[m];
                let energy = 0;
                for (let k = 0; k < N_FREQ_BINS; k++) energy += power[k] * filter[k];
                features[m * FIXED_FRAMES + t] = Math.log(energy + LOG_ZERO_GUARD);
            }
        }
        return { features: features, frameCount: frameCount };
    }

    // ============================================
    // Greedy CTC decode
    // ============================================
    function isSpecialToken(token) {
        return typeof token === 'string' && token.length >= 2 && token.charAt(0) === '<' && token.charAt(token.length - 1) === '>';
    }

    function decodeKoochikCtc(logitsF32, timeSteps, vocabSize, tokens, blankId) {
        let previousId = -1;
        const pieces = [];
        // TEMPORARY diagnostic tally — remove once real speech comes
        // through.
        let blankCount = 0, nonBlankCount = 0, emptyPieceCount = 0, specialCount = 0;
        const idCounts = new Map();
        for (let t = 0; t < timeSteps; t++) {
            const base = t * vocabSize;
            let bestId = 0, bestValue = -Infinity;
            for (let id = 0; id < vocabSize; id++) {
                const value = logitsF32[base + id];
                if (value > bestValue) { bestValue = value; bestId = id; }
            }
            if (bestId === blankId) blankCount++; else nonBlankCount++;
            idCounts.set(bestId, (idCounts.get(bestId) || 0) + 1);
            const piece = tokens[bestId] || '';
            if (bestId !== blankId && !piece) emptyPieceCount++;
            if (bestId !== blankId && piece && isSpecialToken(piece)) specialCount++;
            if (bestId !== blankId && bestId !== previousId && piece && !isSpecialToken(piece)) {
                pieces.push(piece);
            }
            previousId = bestId;
        }
        if (typeof console !== 'undefined' && console.log) {
            const topIds = Array.from(idCounts.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 5)
                .map(function (x) { return x[0] + ':' + JSON.stringify(tokens[x[0]] || '') + '×' + x[1]; }).join(', ');
            console.log('[KoochikASR] ctc tally: timeSteps=', timeSteps, '| blank=', blankCount, '| nonBlank=', nonBlankCount, '| unmapped=', emptyPieceCount, '| special(<...>)=', specialCount, '| top=', topIds);
        }
        return pieces.join('').split('\u2581').join(' ').replace(/\s+/g, ' ').trim();
    }

    // ============================================
    // Boundary-safe linear-interpolation resampler with cross-call continuity
    // ============================================
    function makeResampler(targetRate) {
        let sourceRate = targetRate;
        let nextPos = 0; // source-sample position relative to the current chunk
        let prevSample = 0;
        let havePrev = false;

        return function resample(chunk, chunkSourceRate) {
            if (!chunk || !chunk.length) return new Float32Array(0);

            const newSourceRate = chunkSourceRate || sourceRate;
            if (newSourceRate !== sourceRate) {
                // A live AudioContext should not normally change rate, but if it
                // does, reset interpolation state rather than joining two
                // incompatible timelines.
                sourceRate = newSourceRate;
                nextPos = 0;
                havePrev = false;
            } else {
                sourceRate = newSourceRate;
            }

            // Own the samples we keep. WebAudio's input view belongs to the
            // callback and should not be retained directly. Also sanitize any
            // non-finite browser sample defensively.
            if (sourceRate === targetRate) {
                const copy = new Float32Array(chunk.length);
                for (let i = 0; i < chunk.length; i++) {
                    const v = chunk[i];
                    copy[i] = Number.isFinite(v) ? v : 0;
                }
                prevSample = copy[copy.length - 1];
                havePrev = true;
                return copy;
            }

            const ratio = sourceRate / targetRate;
            // A small over-allocation avoids per-sample array growth.
            const capacity = Math.ceil((chunk.length + 2) / ratio) + 3;
            const out = new Float32Array(Math.max(0, capacity));
            let written = 0;

            while (nextPos < chunk.length) {
                const idx = Math.floor(nextPos);
                const frac = nextPos - idx;
                let s0, s1;

                if (idx < 0) {
                    // The only valid negative position is in (-1, 0), carried
                    // from a deferred interpolation at the previous chunk end.
                    // Use the previous chunk's final sample and this chunk's
                    // first sample. Never index chunk[-1]/chunk[-2].
                    if (!havePrev || idx !== -1) {
                        nextPos = 0;
                        continue;
                    }
                    s0 = prevSample;
                    s1 = chunk[0];
                } else if (idx + 1 < chunk.length) {
                    s0 = chunk[idx];
                    s1 = chunk[idx + 1];
                } else if (idx === chunk.length - 1 && frac === 0) {
                    // Exact hit on the final source sample needs no look-ahead.
                    s0 = chunk[idx];
                    s1 = s0;
                } else {
                    // Interpolation needs the first sample of the NEXT chunk.
                    // Defer it instead of substituting or reading out of range.
                    break;
                }

                if (!Number.isFinite(s0)) s0 = 0;
                if (!Number.isFinite(s1)) s1 = 0;
                out[written++] = s0 + (s1 - s0) * frac;
                nextPos += ratio;
            }

            // Carry the next desired source position into the next callback.
            // After a deferred boundary interpolation this is in (-1, 0);
            // otherwise it is normally in [0, ratio).
            nextPos -= chunk.length;
            prevSample = Number.isFinite(chunk[chunk.length - 1]) ? chunk[chunk.length - 1] : 0;
            havePrev = true;

            return out.subarray(0, written);
        };
    }

    // ============================================
    // Asset fetch + cache (mirrors the old Vosk model caching approach,
    // simplified — Koochik's assets are fetched as three plain files
    // rather than one tarball).
    // ============================================
    function abortError() {
        try { return new DOMException('Aborted', 'AbortError'); }
        catch (e) { const err = new Error('Aborted'); err.name = 'AbortError'; return err; }
    }

    function fetchWithCache(url, cacheName, onProgress, signal, responseType) {
        responseType = responseType || 'arrayBuffer';

        function readResponse(resp, fromCache) {
            if (signal && signal.aborted) return Promise.reject(abortError());
            if (fromCache && onProgress) {
                onProgress({ loaded: 0, total: 0, percent: 100, url: url, fromCache: true });
            }
            if (responseType === 'json') return resp.json();

            const total = parseInt(resp.headers.get('Content-Length') || '0', 10);
            if (!resp.body || !total || !onProgress) return resp.arrayBuffer();

            const reader = resp.body.getReader();
            const chunks = [];
            let received = 0;

            function cancelReader() {
                try { reader.cancel(); } catch (e) {}
            }
            if (signal) signal.addEventListener('abort', cancelReader, { once: true });

            return new Promise(function (resolve, reject) {
                function cleanup() {
                    if (signal) signal.removeEventListener('abort', cancelReader);
                }
                function pump() {
                    if (signal && signal.aborted) {
                        cleanup();
                        reject(abortError());
                        return;
                    }
                    reader.read().then(function (result) {
                        if (result.done) {
                            cleanup();
                            const blob = new Blob(chunks);
                            blob.arrayBuffer().then(resolve, reject);
                            return;
                        }
                        chunks.push(result.value);
                        received += result.value.length;
                        onProgress({
                            loaded: received,
                            total: total,
                            percent: Math.min(100, Math.round(received * 100 / total)),
                            url: url,
                            fromCache: false
                        });
                        pump();
                    }).catch(function (err) {
                        cleanup();
                        reject(err);
                    });
                }
                pump();
            });
        }

        function doFetch(cache) {
            if (signal && signal.aborted) return Promise.reject(abortError());
            return fetch(url, signal ? { signal: signal } : undefined).then(function (resp) {
                if (!resp.ok) throw new Error('fetch-failed:' + url + ':' + resp.status);

                // JSON sidecars are tiny, so cache the network response
                // directly and parse a clone. For the ~230 MB model we
                // avoid cloning the streamed response because that can
                // cause a large transient memory spike on mobile Safari.
                if (responseType === 'json') {
                    const clone = resp.clone();
                    const putPromise = cache
                        ? cache.put(url, clone).catch(function () { /* quota/cache failure is non-fatal */ })
                        : Promise.resolve();
                    return readResponse(resp, false).then(function (data) {
                        return putPromise.then(function () { return data; });
                    });
                }

                return readResponse(resp, false).then(function (buf) {
                    if (!cache || (signal && signal.aborted)) return buf;
                    // Do not make an explicit buf.slice(0) copy. The Cache
                    // API write is best-effort and may fail on quota-limited
                    // browsers; inference can still proceed with this buffer.
                    return cache.put(url, new Response(buf)).catch(function () {
                        return undefined;
                    }).then(function () { return buf; });
                });
            });
        }

        if (!window.caches) return doFetch(null);
        return caches.open(cacheName).then(function (cache) {
            if (signal && signal.aborted) throw abortError();
            return cache.match(url).then(function (cached) {
                if (cached) return readResponse(cached, true);
                return doFetch(cache);
            });
        });
    }

    // ============================================
    // WebGPU capability probe
    // ============================================
    // navigator.gpu alone is not enough for this model: Koochik is an FP16
    // graph, so WebGPU must expose the optional shader-f16 feature. If it
    // does not, attempting the WebGPU EP can create a session successfully
    // but fail later during the first session.run() when WGSL kernels using
    // f16 are compiled. Probe the adapter up front and choose WASM instead.
    function probeWebGpuFp16(preferWebGPU) {
        if (!preferWebGPU) {
            return Promise.resolve({ ok: false, reason: 'disabled', adapter: null, shaderF16: false });
        }
        if (!(window.navigator && navigator.gpu && navigator.gpu.requestAdapter)) {
            return Promise.resolve({ ok: false, reason: 'navigator.gpu-unavailable', adapter: null, shaderF16: false });
        }

        return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })
            .then(function (adapter) {
                if (!adapter) {
                    return { ok: false, reason: 'no-adapter', adapter: null, shaderF16: false };
                }
                const shaderF16 = !!(adapter.features && adapter.features.has && adapter.features.has('shader-f16'));
                return {
                    ok: shaderF16,
                    reason: shaderF16 ? 'shader-f16-supported' : 'shader-f16-unavailable',
                    adapter: adapter,
                    shaderF16: shaderF16
                };
            })
            .catch(function (err) {
                return {
                    ok: false,
                    reason: 'adapter-probe-failed',
                    adapter: null,
                    shaderF16: false,
                    error: err
                };
            });
    }

    // ============================================
    // Public API
    // ============================================
    function load(config, onProgress) {
        config = config || {};
        const preferWebGPU = config.preferWebGPU !== false;
        const ortWebgpuLibUrl = config.ortWebgpuLibUrl || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort.webgpu.min.js';
        const ortWasmLibUrl = config.ortWasmLibUrl || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/ort.min.js';
        const ortWasmBaseUrl = config.ortWasmBaseUrl || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/';
        const cacheName = config.cacheName || 'foximed-koochik-model-v1';
        const signal = config.signal || null;
        let wantWebGPU = false;
        let webGpuProbe = null;
        let selectedModelUrl = config.modelUrl;
        let selectedMode = 'fp16-fixed';

        return probeWebGpuFp16(preferWebGPU)
            .then(function (probe) {
                if (signal && signal.aborted) throw abortError();
                webGpuProbe = probe;
                wantWebGPU = !!probe.ok;

                if (!wantWebGPU && config.streamingModelUrl) {
                    selectedModelUrl = config.streamingModelUrl;
                    selectedMode = 'int4-streaming';
                }
                const ortLibUrl = wantWebGPU ? ortWebgpuLibUrl : ortWasmLibUrl;
                if (preferWebGPU && !wantWebGPU) {
                    console.warn('[KoochikASR] WebGPU FP16 unavailable; using Koochik INT4 streaming WASM:', probe.reason);
                }
                return loadScriptOnce(ortLibUrl);
            })
            .then(function () {
                if (signal && signal.aborted) throw abortError();
                if (!window.ort) throw new Error('ort-missing-after-load');
                window.ort.env.wasm.wasmPaths = ortWasmBaseUrl;
                console.log('[KoochikASR] runtime:',
                    'navigator.gpu=', !!(window.navigator && navigator.gpu),
                    '| shader-f16=', !!(webGpuProbe && webGpuProbe.shaderF16),
                    '| requested=', wantWebGPU ? 'webgpu' : 'wasm',
                    '| modelMode=', selectedMode,
                    '| webgpuReason=', webGpuProbe ? webGpuProbe.reason : 'not-probed',
                    '| crossOriginIsolated=', !!window.crossOriginIsolated);
            })
            .then(function () {
                return Promise.all([
                    fetchWithCache(
                        selectedModelUrl,
                        cacheName,
                        onProgress ? function (p) { onProgress(Object.assign({ asset: 'model' }, p)); } : null,
                        signal,
                        'arrayBuffer'
                    ),
                    fetchWithCache(config.tokensUrl, cacheName, null, signal, 'json'),
                    fetchWithCache(config.melFiltersUrl, cacheName, null, signal, 'json')
                ]);
            })
            .then(function (results) {
                if (signal && signal.aborted) throw abortError();

                const modelBuffer = results[0];
                const tokenData = results[1];
                let tokens = tokenData;
                let blankId = BLANK_ID;
                let melFilters = results[2];

                // Official Koochik tokens.json:
                // { "blank_id": 1024, ..., "tokens": [ ... ] }
                // Keep compatibility with a raw array or legacy numeric map.
                if (tokenData && !Array.isArray(tokenData) && typeof tokenData === 'object') {
                    if (Array.isArray(tokenData.tokens)) {
                        tokens = tokenData.tokens;
                        if (Number.isInteger(tokenData.blank_id)) blankId = tokenData.blank_id;
                    } else {
                        const arr = [];
                        Object.keys(tokenData).forEach(function (k) {
                            const id = parseInt(k, 10);
                            if (!Number.isNaN(id)) arr[id] = tokenData[k];
                        });
                        tokens = arr;
                    }
                }

                // Be tolerant if a future sidecar wraps the matrix in an
                // object, while validating the exact dimensions Koochik needs.
                if (!Array.isArray(melFilters) && melFilters && typeof melFilters === 'object') {
                    if (Array.isArray(melFilters.mel_filters)) melFilters = melFilters.mel_filters;
                    else if (Array.isArray(melFilters.filters)) melFilters = melFilters.filters;
                }

                if (!Array.isArray(tokens) || tokens.length < VOCAB_SIZE) {
                    throw new Error('invalid-koochik-tokens');
                }
                if (!Array.isArray(melFilters) || melFilters.length !== N_MELS) {
                    throw new Error('invalid-koochik-mel-filters');
                }
                for (let i = 0; i < melFilters.length; i++) {
                    if (!melFilters[i] || melFilters[i].length !== N_FREQ_BINS) {
                        throw new Error('invalid-koochik-mel-filters');
                    }
                }

                // TEMPORARY diagnostic — sanity-check what actually got
                // loaded. tokens[blankId] should read something like
                // "<blank>"; tokens[0] is usually a real token, not empty.
                // If blankId looks wrong or tokens are mostly empty
                // strings, the tokens.json shape assumption above is wrong
                // for this file and needs adjusting.
                console.log('[KoochikASR] loaded: tokens.length=', tokens.length,
                    '| blankId=', blankId, '| tokens[blankId]=', JSON.stringify(tokens[blankId]),
                    '| tokens[0..4]=', JSON.stringify(tokens.slice(0, 5)),
                    '| melFilters=', melFilters.length + 'x' + (melFilters[0] ? melFilters[0].length : '?'));

                function finishSession(session, provider, mode) {
                    if (signal && signal.aborted) {
                        try { session.release && session.release(); } catch (e) {}
                        throw abortError();
                    }
                    console.log('[KoochikASR] execution provider=', provider, '| modelMode=', mode,
                        '| inputs=', JSON.stringify(session.inputNames || []),
                        '| outputs=', JSON.stringify(session.outputNames || []));
                    if (mode === 'int4-streaming') {
                        return makeStreamingEngine(session, tokens, melFilters, blankId, provider);
                    }
                    return makeEngine(session, tokens, melFilters, blankId, provider);
                }

                if (wantWebGPU) {
                    return window.ort.InferenceSession.create(modelBuffer, {
                        executionProviders: ['webgpu', 'wasm']
                    }).then(function (session) {
                        return finishSession(session, 'webgpu', 'fp16-fixed');
                    }).catch(function (err) {
                        if (signal && signal.aborted) throw err;
                        if (!config.streamingModelUrl) throw err;
                        console.warn('[KoochikASR] FP16 WebGPU session failed; retrying Koochik INT4 streaming WASM:', err);
                        return fetchWithCache(config.streamingModelUrl, cacheName, onProgress ? function (p) { onProgress(Object.assign({ asset: 'streaming-model' }, p)); } : null, signal, 'arrayBuffer')
                            .then(function (streamBuffer) {
                                return window.ort.InferenceSession.create(streamBuffer, { executionProviders: ['wasm'] });
                            })
                            .then(function (session) { return finishSession(session, 'wasm', 'int4-streaming'); });
                    });
                }

                return window.ort.InferenceSession.create(modelBuffer, {
                    executionProviders: ['wasm']
                }).then(function (session) {
                    return finishSession(session, 'wasm', selectedMode);
                });
            });
    }

    function makeEngine(session, tokens, melFilters, blankId, provider) {
        const resample = makeResampler(SAMPLE_RATE);
        let chunks = [];
        let totalLen = 0;

        function trim() {
            if (totalLen <= MAX_SAMPLES) return;
            // Drop oldest chunks until we're back under the cap — only the
            // trailing MAX_SAMPLES matter to the model anyway.
            while (chunks.length > 1 && (totalLen - chunks[0].length) >= MAX_SAMPLES) {
                totalLen -= chunks[0].length;
                chunks.shift();
            }
        }

        function materialize() {
            const out = new Float32Array(totalLen);
            let offset = 0;
            for (let i = 0; i < chunks.length; i++) { out.set(chunks[i], offset); offset += chunks[i].length; }
            return out;
        }

        return {
            executionProvider: function () { return provider || 'wasm'; },
            supportsLivePartials: function () { return provider === 'webgpu'; },
            feed: function (float32Samples, sourceSampleRate) {
                const resampled = resample(float32Samples, sourceSampleRate || SAMPLE_RATE);
                if (resampled.length) {
                    chunks.push(resampled);
                    totalLen += resampled.length;
                    trim();
                }
            },
            reset: function () { chunks = []; totalLen = 0; },
            bufferedSeconds: function () { return totalLen / SAMPLE_RATE; },
            decode: function () {
                if (totalLen === 0) return Promise.resolve('');
                const decodeStartedAt = performance.now();
                const rawPcm = materialize();

                // Measure the raw capture before deciding whether this particular
                // utterance needs app-level digital gain. The successful device log
                // showed peaks near 0.86, while a failing quiet session peaked near
                // 0.066. Because the frontend intentionally has no normalization,
                // that level difference survives into the log-mel tensor.
                let rawPeak = 0, rawSq = 0, rawFiniteN = 0, pcmNonFinite = 0;
                for (let i = 0; i < rawPcm.length; i++) {
                    const v = rawPcm[i];
                    if (!Number.isFinite(v)) { pcmNonFinite++; continue; }
                    const a = Math.abs(v);
                    if (a > rawPeak) rawPeak = a;
                    rawSq += v * v;
                    rawFiniteN++;
                }
                const rawRms = Math.sqrt(rawSq / Math.max(1, rawFiniteN));

                let inputGain = 1.0;
                if (rawPeak >= QUIET_GAIN_MIN_PEAK && rawRms >= QUIET_GAIN_MIN_RMS && rawPeak < QUIET_GAIN_TARGET_PEAK) {
                    inputGain = Math.min(QUIET_GAIN_MAX, QUIET_GAIN_TARGET_PEAK / rawPeak);
                }

                let pcm = rawPcm;
                if (inputGain > 1.01 || pcmNonFinite) {
                    pcm = new Float32Array(rawPcm.length);
                    for (let i = 0; i < rawPcm.length; i++) {
                        const v = Number.isFinite(rawPcm[i]) ? rawPcm[i] : 0;
                        pcm[i] = v * inputGain;
                    }
                }

                const featureStartedAt = performance.now();
                const { features, frameCount } = pcmToKoochikLogMel(pcm, melFilters);
                const featureMs = performance.now() - featureStartedAt;

                let adjustedPeak = 0, adjustedSq = 0, adjustedFiniteN = 0;
                for (let i = 0; i < pcm.length; i++) {
                    const v = pcm[i];
                    if (!Number.isFinite(v)) continue;
                    const a = Math.abs(v);
                    if (a > adjustedPeak) adjustedPeak = a;
                    adjustedSq += v * v;
                    adjustedFiniteN++;
                }
                const adjustedRms = Math.sqrt(adjustedSq / Math.max(1, adjustedFiniteN));

                let fMin = Infinity, fMax = -Infinity, fSum = 0, fN = 0, featNonFinite = 0;
                for (let m = 0; m < N_MELS; m++) {
                    const base = m * FIXED_FRAMES;
                    for (let t = 0; t < frameCount; t++) {
                        const v = features[base + t];
                        if (!Number.isFinite(v)) { featNonFinite++; continue; }
                        if (v < fMin) fMin = v;
                        if (v > fMax) fMax = v;
                        fSum += v; fN++;
                    }
                }
                console.log('[KoochikASR] input stats: rawPeak=', rawPeak.toFixed(4),
                    '| rawRms=', rawRms.toFixed(4),
                    '| inputGain=', inputGain.toFixed(2) + 'x',
                    '| modelPeak=', adjustedPeak.toFixed(4),
                    '| modelRms=', adjustedRms.toFixed(4),
                    '| pcmNonFinite=', pcmNonFinite,
                    '| featMin=', (fN ? fMin : NaN).toFixed(3), '| featMax=', (fN ? fMax : NaN).toFixed(3),
                    '| featMean=', (fSum / Math.max(1, fN)).toFixed(3), '| featNonFinite=', featNonFinite,
                    '| frames=', frameCount, '| featureMs=', featureMs.toFixed(1));

                const fp16Input = makeOrtFloat16Input(features);
                console.log('[KoochikASR] fp16 input container=', fp16Input && fp16Input.constructor ? fp16Input.constructor.name : typeof fp16Input);
                const processedSignal = new window.ort.Tensor('float16', fp16Input, [1, N_MELS, FIXED_FRAMES]);
                const processedSignalLength = new window.ort.Tensor('int64', BigInt64Array.from([BigInt(frameCount)]), [1]);
                const inferenceStartedAt = performance.now();
                return session.run({
                    processed_signal: processedSignal,
                    processed_signal_length: processedSignalLength
                }).then(function (result) {
                    const inferenceMs = performance.now() - inferenceStartedAt;
                    const logits = result.logits;
                    console.log('[KoochikASR] logits container=', logits.data && logits.data.constructor ? logits.data.constructor.name : typeof logits.data,
                        '| type=', logits.type, '| dims=', logits.dims ? logits.dims.join('x') : '?',
                        '| inferenceMs=', inferenceMs.toFixed(1),
                        '| decodeTotalMs=', (performance.now() - decodeStartedAt).toFixed(1));
                    const logitsF32 = ortFloat16OutputToFloat32(logits.data);
                    const vocabSize = logits.dims[2] || VOCAB_SIZE;
                    let usableSteps = logits.dims[1] || Math.ceil(frameCount / 8);
                    if (result.encoded_lengths) {
                        const el = Number(result.encoded_lengths.data[0]);
                        if (el > 0) usableSteps = Math.min(usableSteps, el);
                    }
                    return decodeKoochikCtc(logitsF32, usableSteps, vocabSize, tokens, blankId);
                });
            },
            destroy: function () {
                chunks = []; totalLen = 0;
                try { session.release && session.release(); } catch (e) {}
            }
        };
    }


    // ============================================
    // Koochik 114M INT4 cache-aware streaming engine
    // Official graph: Reza2kn/Shenava-Koochik-v1.0-tract-streaming/model.int4.onnx
    // The graph is ONNX and can be executed by modern ORT Web WASM builds
    // that support com.microsoft::MatMulNBits. It keeps FastConformer cache
    // tensors between 121-frame chunks, shifted by 112 frames.
    // ============================================
    function makeStreamingEngine(session, tokens, melFilters, blankId, provider) {
        const requiredInputs = ['audio_signal', 'length', 'cache_last_channel', 'cache_last_time', 'cache_last_channel_len'];
        const inputNames = session.inputNames || [];
        for (let i = 0; i < requiredInputs.length; i++) {
            if (inputNames.indexOf(requiredInputs[i]) < 0) {
                throw new Error('koochik-streaming-missing-input:' + requiredInputs[i]);
            }
        }

        const resample = makeResampler(SAMPLE_RATE);
        let pcmChunks = [];
        let pcmLen = 0;
        let nextFrameStart = 0;
        let firstChunkDone = false;
        let previousCtcId = -1;
        let pieces = [];
        let runChain = Promise.resolve();

        let cacheChannel, cacheTime, cacheLen;

        function initState() {
            cacheChannel = new window.ort.Tensor('float32', new Float32Array(CACHE_LAYERS * CACHE_LEFT * CACHE_DMODEL), [1, CACHE_LAYERS, CACHE_LEFT, CACHE_DMODEL]);
            cacheTime = new window.ort.Tensor('float32', new Float32Array(CACHE_LAYERS * CACHE_DMODEL * CACHE_TIME), [1, CACHE_LAYERS, CACHE_DMODEL, CACHE_TIME]);
            cacheLen = new window.ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
            nextFrameStart = 0;
            firstChunkDone = false;
            previousCtcId = -1;
            pieces = [];
        }
        initState();

        function materializePcm() {
            const out = new Float32Array(pcmLen);
            let off = 0;
            for (let i = 0; i < pcmChunks.length; i++) { out.set(pcmChunks[i], off); off += pcmChunks[i].length; }
            return out;
        }

        function textNow() {
            return pieces.join('').split('\u2581').join(' ').replace(/\s+/g, ' ').trim();
        }

        function findTensor(result, preferred, shapeTest) {
            for (let i = 0; i < preferred.length; i++) if (result[preferred[i]]) return result[preferred[i]];
            const keys = Object.keys(result);
            for (let i = 0; i < keys.length; i++) {
                const t = result[keys[i]];
                if (t && shapeTest && shapeTest(t, keys[i])) return t;
            }
            return null;
        }

        function consumeCtc(logits) {
            if (!logits || !logits.dims || logits.dims.length < 3) throw new Error('koochik-streaming-logprobs-missing');
            const data = logits.type === 'float16' ? ortFloat16OutputToFloat32(logits.data) : Float32Array.from(logits.data);
            const vocab = logits.dims[logits.dims.length - 1];
            const steps = logits.dims[logits.dims.length - 2];
            for (let t = 0; t < steps; t++) {
                const base = t * vocab;
                let bestId = 0, best = -Infinity;
                for (let id = 0; id < vocab; id++) {
                    const v = data[base + id];
                    if (v > best) { best = v; bestId = id; }
                }
                const piece = tokens[bestId] || '';
                if (bestId !== blankId && bestId !== previousCtcId && piece && !isSpecialToken(piece)) pieces.push(piece);
                previousCtcId = bestId;
            }
        }

        function makeMelChunk(fullFeatures, start, valid) {
            const out = new Float32Array(N_MELS * STREAM_FRAMES);
            for (let m = 0; m < N_MELS; m++) {
                const srcBase = m * FIXED_FRAMES + start;
                const dstBase = m * STREAM_FRAMES;
                for (let t = 0; t < valid; t++) out[dstBase + t] = fullFeatures[srcBase + t];
            }
            return out;
        }

        function runOne(fullFeatures, start, valid) {
            const mel = makeMelChunk(fullFeatures, start, valid);
            const feeds = {
                audio_signal: new window.ort.Tensor('float32', mel, [1, N_MELS, STREAM_FRAMES]),
                length: new window.ort.Tensor('int64', BigInt64Array.from([BigInt(valid)]), [1]),
                cache_last_channel: cacheChannel,
                cache_last_time: cacheTime,
                cache_last_channel_len: cacheLen
            };
            const t0 = performance.now();
            return session.run(feeds).then(function (result) {
                const logprobs = findTensor(result, ['logprobs', 'logits'], function (t) {
                    return t.dims && t.dims.length === 3 && t.dims[t.dims.length - 1] === VOCAB_SIZE;
                });
                const nextChannel = findTensor(result, ['cache_last_channel_next'], function (t, name) { return name.indexOf('cache_last_channel') >= 0 && name.indexOf('next') >= 0; });
                const nextTime = findTensor(result, ['cache_last_time_next'], function (t, name) { return name.indexOf('cache_last_time') >= 0 && name.indexOf('next') >= 0; });
                const nextLen = findTensor(result, ['cache_last_channel_len_next'], function (t, name) { return name.indexOf('cache_last_channel_len') >= 0 && name.indexOf('next') >= 0; });
                if (!logprobs || !nextChannel || !nextTime || !nextLen) {
                    throw new Error('koochik-streaming-output-contract-mismatch:' + Object.keys(result).join(','));
                }
                consumeCtc(logprobs);
                cacheChannel = nextChannel;
                cacheTime = nextTime;
                cacheLen = new window.ort.Tensor('int64', BigInt64Array.from([BigInt(Number(nextLen.data[0]))]), [1]);
                console.log('[KoochikASR] streaming chunk:', 'start=', start, '| valid=', valid,
                    '| outSteps=', logprobs.dims[logprobs.dims.length - 2],
                    '| inferenceMs=', (performance.now() - t0).toFixed(1), '| text=', JSON.stringify(textNow()));
                return textNow();
            });
        }

        function process(finalize) {
            if (!pcmLen) return Promise.resolve(textNow());
            const pcm = materializePcm();
            const generated = pcmToKoochikLogMel(pcm, melFilters);
            const frameCount = generated.frameCount;
            const fullFeatures = generated.features;
            const jobs = [];

            if (!firstChunkDone) {
                if (frameCount >= STREAM_FIRST_VALID || finalize) {
                    const valid = Math.min(STREAM_FIRST_VALID, frameCount);
                    if (valid > 0) {
                        jobs.push({ start: 0, valid: valid });
                        firstChunkDone = true;
                        nextFrameStart = Math.max(0, STREAM_FIRST_VALID - STREAM_OVERLAP); // 96
                    }
                }
            }

            if (firstChunkDone) {
                while ((frameCount - nextFrameStart) >= STREAM_FRAMES) {
                    jobs.push({ start: nextFrameStart, valid: STREAM_FRAMES });
                    nextFrameStart += STREAM_SHIFT;
                }
                if (finalize) {
                    const remaining = frameCount - nextFrameStart;
                    // Ignore an overlap-only tail; it contains no new mel frames.
                    if (remaining > STREAM_OVERLAP) {
                        jobs.push({ start: nextFrameStart, valid: Math.min(STREAM_FRAMES, remaining) });
                        nextFrameStart += STREAM_SHIFT;
                    }
                }
            }

            let chain = Promise.resolve(textNow());
            jobs.forEach(function (job) {
                chain = chain.then(function () { return runOne(fullFeatures, job.start, job.valid); });
            });
            return chain;
        }

        return {
            executionProvider: function () { return provider || 'wasm'; },
            modelMode: function () { return 'int4-streaming'; },
            supportsLivePartials: function () { return true; },
            feed: function (float32Samples, sourceSampleRate) {
                const r = resample(float32Samples, sourceSampleRate || SAMPLE_RATE);
                if (r.length) { pcmChunks.push(r); pcmLen += r.length; }
            },
            bufferedSeconds: function () { return pcmLen / SAMPLE_RATE; },
            decode: function () {
                runChain = runChain.then(function () { return process(false); });
                return runChain;
            },
            finalize: function () {
                runChain = runChain.then(function () { return process(true); });
                return runChain;
            },
            reset: function () {
                pcmChunks = []; pcmLen = 0; runChain = Promise.resolve(); initState();
            },
            destroy: function () {
                pcmChunks = []; pcmLen = 0;
                try { session.release && session.release(); } catch (e) {}
            }
        };
    }

    window.KoochikASR = { load: load };
})(window);
