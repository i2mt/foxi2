/* ============================================
   FoxiMed — Koochik ASR adapter (sherpa-onnx in a Dedicated Worker)
   ============================================
   sherpa's synchronous WASM inference is intentionally kept off the page
   main thread. This prevents ~500-800 ms decode calls from starving the
   microphone ScriptProcessor callback and dropping pieces of live speech.
   ============================================ */
(function (window) {
  'use strict';

  const DEFAULT_BASE_URL = './sherpa-koochik/';
  const WORKER_FILE = './koochik-worker.js';
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
      onProgress({ loaded, total, percent: total > 0 ? Math.max(0, Math.min(100, loaded * 100 / total)) : 0, status: 'download' });
    } else if (/Running\.\.\./i.test(status)) {
      onProgress({ percent: 100, status: 'initializing' });
    }
  }

  function rejectAll(err) {
    pending.forEach((p) => p.reject(err));
    pending.clear();
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
    if (workerReadyPromise && workerBaseUrl === baseUrl) return workerReadyPromise;
    if (workerReadyPromise && workerBaseUrl !== baseUrl) return Promise.reject(new Error('sherpa-base-url-changed'));

    workerBaseUrl = baseUrl;
    workerReadyPromise = new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      let settled = false;
      const workerUrl = new URL(WORKER_FILE, window.location.href).href;
      try {
        worker = new Worker(workerUrl);
      } catch (e) {
        reject(e);
        return;
      }

      const abortHandler = signal ? function () {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch (_) {}
        worker = null;
        workerReadyPromise = null;
        reject(new DOMException('Aborted', 'AbortError'));
      } : null;
      if (signal && abortHandler) signal.addEventListener('abort', abortHandler, { once: true });

      worker.onmessage = function (event) {
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
          console.log('[KoochikASR] sherpa worker ready: model=Koochik-v1.0-streaming-int8 | sampleRate=16000');
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
          else console.error('[KoochikASR] sherpa worker error:', err);
          if (!settled) {
            settled = true;
            workerReadyPromise = null;
            reject(err);
          }
        }
      };

      worker.onerror = function (event) {
        const err = new Error('koochik-worker-error: ' + (event && event.message ? event.message : 'unknown'));
        console.error('[KoochikASR] worker crashed:', err);
        rejectAll(err);
        if (!settled) {
          settled = true;
          workerReadyPromise = null;
          reject(err);
        }
      };

      worker.postMessage({ type: 'init', baseUrl, requestId: 0 });
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
      activeEngine = this;
    }

    reset() {
      this.totalSeconds = 0;
      this.lastText = '';
      this.finalText = '';
      this.endpoint = false;
      this.sequence = 0;
      if (worker) sendRequest('reset').catch((e) => console.warn('[KoochikASR] worker reset failed:', e));
    }

    feed(samples, sampleRate) {
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
      console.log('[KoochikASR] sherpa worker decode:',
        'seq=', msg.sequence,
        '| steps=', msg.steps,
        '| ms=', Number(msg.ms || 0).toFixed(1),
        '| queueDelayMs=', Number(msg.queueDelayMs || 0).toFixed(0),
        '| inputSr=', msg.inputSr,
        '| modelSr=', msg.modelSr,
        '| rawPeak=', Number(msg.inputPeak || 0).toFixed(4),
        '| rawRms=', Number(msg.inputRms || 0).toFixed(4),
        '| modelPeak=', Number(msg.modelPeak || 0).toFixed(4),
        '| modelRms=', Number(msg.modelRms || 0).toFixed(4),
        '| nonFinite=', msg.nonFinite,
        '| text=', JSON.stringify(this.lastText),
        '| endpoint=', this.endpoint);
    }

    _onFinal(msg) {
      this.finalText = String(msg.text || '').trim();
      this.lastText = this.finalText || this.lastText;
      console.log('[KoochikASR] sherpa worker final:',
        'steps=', msg.steps,
        '| ms=', Number(msg.ms || 0).toFixed(1),
        '| text=', JSON.stringify(this.finalText));
    }


    decode() { return Promise.resolve(this.lastText || ''); }

    finalize() {
      if (!worker) return Promise.resolve(this.lastText || '');
      return sendRequest('finalize').then((text) => String(text || this.lastText || '').trim());
    }

    endpointDetected() { return !!this.endpoint; }
    bufferedSeconds() { return this.totalSeconds; }
    supportsLivePartials() { return true; }
    executionProvider() { return 'sherpa-onnx-worker-wasm-int8'; }

    destroy() {
      if (activeEngine === this) activeEngine = null;
      if (worker) sendRequest('destroy').catch(function () {});
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
    model: 'Shenava-Koochik-v1.0-streaming-int8'
  };
})(window);
