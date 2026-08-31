/* ============================================
   FoxiMed — Rizeh ASR adapter (segmented VAD + non-streaming sherpa-onnx)
   ============================================
   sherpa's synchronous WASM inference is intentionally kept off the page
   main thread. This prevents ~500-800 ms decode calls from starving the
   microphone ScriptProcessor callback and dropping pieces of live speech.
   ============================================ */
(function (window) {
  'use strict';

  const DEFAULT_BASE_URL = './sherpa-koochik/';
  const BUILD_ID = 'v34-rizeh-offline';
  console.log('[KoochikASR] adapter build=' + BUILD_ID);
  const WORKER_FILE = './koochik-worker.js?v=35';
  const SAMPLE_RATE = 16000;

  let worker = null;
  let workerReadyPromise = null;
  let workerBaseUrl = '';
  let requestSeq = 1;
  const pending = new Map();
  let activeEngine = null;

  function ensureSlash(s) {
    s = String(s || DEFAULT_BASE_URL);
    return s.endsWith('/') ? s : s + '/';
  }

  function parseStatus(status, onProgress) {
    if (typeof onProgress !== 'function') return;
    status = String(status || '');
    const m = status.match(/Downloading data\.\.\. \((\d+)\/(\d+)\)/);
    if (m) {
      const loaded = Number(m[1]);
      const total = Number(m[2]);
      const percent = total > 0 ? Math.round(Math.max(0, Math.min(100, loaded * 100 / total))) : 0;
      onProgress({ loaded, total, percent, overallLoaded: loaded, overallTotal: total, overallPercent: percent, phase: 'download', status: 'download' });
    } else if (/Running\.\.\./i.test(status)) {
      onProgress({ percent: 100, overallPercent: 100, phase: 'initializing', status: 'initializing' });
    }
  }

  function rejectAll(err) {
    pending.forEach((p) => p.reject(err));
    pending.clear();
  }

  function shutdownWorker(err) {
    const oldWorker = worker;
    worker = null;
    workerReadyPromise = null;
    workerBaseUrl = '';
    activeEngine = null;
    if (oldWorker) {
      oldWorker.onmessage = null;
      oldWorker.onerror = null;
      try { oldWorker.terminate(); } catch (_) {}
    }
    if (err) rejectAll(err);
  }

  function sendRequest(type, payload) {
    if (!worker) return Promise.reject(new Error('koochik-worker-not-ready'));
    const requestId = requestSeq++;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject, type });
      worker.postMessage(Object.assign({ type, requestId }, payload || {}));
    });
  }

  function ensureWorker(baseUrl, onProgress, signal) {
    baseUrl = new URL(ensureSlash(baseUrl), window.location.href).href;
    if (workerReadyPromise && worker && workerBaseUrl === baseUrl) return workerReadyPromise;
    if (workerReadyPromise || worker) {
      shutdownWorker(new Error('sherpa-worker-replaced'));
    }

    workerBaseUrl = baseUrl;
    let createdWorker = null;
    const readyPromise = new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      let settled = false;
      const workerUrl = new URL(WORKER_FILE, window.location.href).href;
      try {
        createdWorker = new Worker(workerUrl);
        worker = createdWorker;
      } catch (e) {
        reject(e);
        return;
      }

      const abortHandler = signal ? function () {
        if (settled) return;
        settled = true;
        const err = new DOMException('Aborted', 'AbortError');
        shutdownWorker(err);
        reject(err);
      } : null;
      if (signal && abortHandler) signal.addEventListener('abort', abortHandler, { once: true });

      createdWorker.onmessage = function (event) {
        if (worker !== createdWorker) return;
        const msg = event.data || {};

        if (msg.type === 'status') {
          console.log('[KoochikASR] sherpa worker status:', msg.status);
          parseStatus(msg.status, onProgress);
          return;
        }
        if (msg.type === 'sherpa-log') {
          const fn = msg.level === 'warn' ? console.warn : console.log;
          fn.apply(console, ['[sherpa worker]'].concat(msg.args || []));
          return;
        }
        if (msg.type === 'ready') {
          console.log('[KoochikASR] sherpa worker ready: build=' + String(msg.build || BUILD_ID) + ' | model=Rizeh-v1.0-non-streaming-int8 | VAD=Silero-segments+fixed-frame-energy | sampleRate=16000');
          if (!settled) {
            settled = true;
            if (signal && abortHandler) try { signal.removeEventListener('abort', abortHandler); } catch (_) {}
            resolve();
          }
          return;
        }
        if (msg.type === 'result') {
          if (activeEngine) activeEngine._onResult(msg);
          return;
        }
        if (msg.type === 'final') {
          if (activeEngine) activeEngine._onFinal(msg);
          const p = pending.get(msg.requestId);
          if (p) { pending.delete(msg.requestId); p.resolve(msg.text || ''); }
          return;
        }
        if (msg.type === 'reset-done' || msg.type === 'destroyed') {
          const p = pending.get(msg.requestId);
          if (p) { pending.delete(msg.requestId); p.resolve(msg); }
          return;
        }
        if (msg.type === 'error') {
          const err = new Error(msg.message || 'sherpa-worker-error');
          const p = pending.get(msg.requestId);
          if (p) { pending.delete(msg.requestId); p.reject(err); }
          else {
            console.error('[KoochikASR] sherpa worker error:', err);
            if (activeEngine) activeEngine._onFatal(err);
            shutdownWorker(err);
          }
          if (!settled) {
            settled = true;
            shutdownWorker(err);
            reject(err);
          }
        }
      };

      createdWorker.onerror = function (event) {
        const err = new Error('koochik-worker-error: ' + (event && event.message ? event.message : 'unknown'));
        console.error('[KoochikASR] worker crashed:', err);
        if (activeEngine) activeEngine._onFatal(err);
        shutdownWorker(err);
        if (!settled) {
          settled = true;
          reject(err);
        }
      };

      createdWorker.postMessage({ type: 'init', baseUrl, requestId: 0 });
    });

    workerReadyPromise = readyPromise.catch(function (err) {
      if (!createdWorker || worker === createdWorker) shutdownWorker(err);
      throw err;
    });

    return workerReadyPromise;
  }

  class WorkerKoochikEngine {
    constructor() {
      this.totalSeconds = 0;
      this.lastText = '';
      this.endpoint = false;
      this.sequence = 0;
      this.finalText = '';
      this.lastSpeechDetected = false;
      this.lastEndpointReason = '';
      this.fatalError = null;
      activeEngine = this;
    }

    reset() {
      this.totalSeconds = 0;
      this.lastText = '';
      this.finalText = '';
      this.endpoint = false;
      this.sequence = 0;
      this.lastSpeechDetected = false;
      this.lastEndpointReason = '';
      this.fatalError = null;
      if (worker) sendRequest('reset').catch((e) => console.warn('[KoochikASR] worker reset failed:', e));
    }

    feed(samples, sampleRate) {
      if (this.fatalError) throw this.fatalError;
      if (!worker || !samples || !samples.length) return;
      const inputRate = Number(sampleRate) || SAMPLE_RATE;
      const copy = new Float32Array(samples);
      this.totalSeconds += copy.length / inputRate;
      this.sequence++;
      worker.postMessage({
        type: 'feed',
        sequence: this.sequence,
        sampleRate: inputRate,
        sentAt: Date.now(),
        buffer: copy.buffer
      }, [copy.buffer]);
    }

    _onResult(msg) {
      this.lastText = String(msg.text || '').trim();
      this.endpoint = !!msg.endpoint;
      const nowSpeech = !!msg.speechDetected;
      const reason = String(msg.endpointReason || '');
      const transition = nowSpeech !== this.lastSpeechDetected || reason !== this.lastEndpointReason;
      const periodic = msg.sequence === 1 || (msg.sequence % 8) === 0;

      if (transition || periodic || this.endpoint) {
        console.log('[KoochikASR] capture:',
          'seq=', msg.sequence,
          '| ms=', Number(msg.ms || 0).toFixed(1),
          '| queueDelayMs=', Number(msg.queueDelayMs || 0).toFixed(0),
          '| rms=', Number(msg.modelRms || 0).toFixed(4),
          '| peak=', Number(msg.modelPeak || 0).toFixed(4),
          '| silero=', !!msg.sileroSpeechDetected,
          '| sileroNow=', !!msg.sileroActiveNow,
          '| energy=', !!msg.energySpeechDetected,
          '| energyNow=', !!msg.energyVoiceNow,
          '| holdRms=', Number(msg.energyHoldRms || 0).toFixed(4),
          '| speech=', nowSpeech,
          '| endpoint=', this.endpoint,
          '| reason=', reason || '-');
      }
      this.lastSpeechDetected = nowSpeech;
      this.lastEndpointReason = reason;
    }

    _onFinal(msg) {
      this.finalText = String(msg.text || '').trim();
      this.lastText = this.finalText || this.lastText;
      console.log('[KoochikASR] sherpa worker final:',
        'steps=', msg.steps,
        '| ms=', Number(msg.ms || 0).toFixed(1),
        '| capturedSec=', Number(msg.bufferedSeconds || 0).toFixed(2),
        '| decodeSec=', Number(msg.decodeSeconds || 0).toFixed(2),
        '| decodeSource=', String(msg.decodeSource || '-'),
        '| segments=', Number(msg.sileroSegments || 0),
        '| endpointReason=', String(msg.endpointReason || '-'),
        '| rawRms=', Number(msg.rawRms || 0).toFixed(4),
        '| decodeRms=', Number(msg.decodeRms || 0).toFixed(4),
        '| rawPeak=', Number(msg.rawPeak || 0).toFixed(4),
        '| decodePeak=', Number(msg.decodePeak || 0).toFixed(4),
        '| text=', JSON.stringify(this.finalText));
    }

    _onFatal(err) {
      this.fatalError = err instanceof Error ? err : new Error(String(err || 'sherpa-worker-error'));
    }


    decode() { return Promise.resolve(''); }

    finalize() {
      if (this.fatalError) return Promise.reject(this.fatalError);
      if (!worker) return Promise.resolve(this.lastText || '');
      return sendRequest('finalize').then((text) => String(text || this.lastText || '').trim());
    }

    endpointDetected() { return !!this.endpoint; }
    bufferedSeconds() { return this.totalSeconds; }
    supportsLivePartials() { return false; }
    executionProvider() { return 'sherpa-onnx-worker-wasm-rizeh-int8-segmented-vad-v29'; }

    destroy() {
      // Worker.terminate() is the only reliable way to release the complete
      // Emscripten heap on iOS. It also resets the ready promise, so the next
      // load creates a genuinely fresh worker instead of reusing stale state.
      shutdownWorker(new DOMException('Rizeh worker released', 'AbortError'));
      return Promise.resolve();
    }
  }

  window.KoochikASR = {
    load: function (options, onProgress) {
      options = options || {};
      // Best-effort protection against storage eviction. Browsers may deny
      // this silently; recognition still works and the model cache simply
      // becomes normal best-effort site storage.
      try {
        if (navigator.storage && navigator.storage.persist) {
          navigator.storage.persist().then(function (granted) {
            console.log('[KoochikASR] persistent storage:', granted ? 'granted' : 'not-granted');
          }).catch(function () {});
        }
      } catch (_) {}
      return ensureWorker(options.baseUrl || DEFAULT_BASE_URL, onProgress, options.signal)
        .then(function () {
          const engine = new WorkerKoochikEngine();
          engine.reset();
          return engine;
        });
    },
    runtime: 'sherpa-onnx-dedicated-worker-wasm',
    model: 'Shenava-Rizeh-v1.0-non-streaming-int8'
  };
})(window);
