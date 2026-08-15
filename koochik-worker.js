/* FoxiMed — Koochik non-streaming sherpa-onnx worker
 *
 * v23 architecture:
 *   microphone PCM -> Silero VAD -> endpoint -> full-context Koochik INT8
 *
 * VAD runs continuously in this Dedicated Worker. The expensive non-streaming
 * ASR pass runs only once, after capture stops, so it cannot starve microphone
 * callbacks on the page thread.
 */
'use strict';

const SAMPLE_RATE = 16000;
const ASR_WRAPPER_FILE = 'sherpa-onnx-asr.js';
const VAD_WRAPPER_FILE = 'sherpa-onnx-vad.js';
const RUNTIME_FILE = 'sherpa-onnx-wasm-main-vad-asr.js';
const MODEL_PATH = './nemo-ctc.onnx';
const TOKENS_PATH = './tokens.txt';
const VAD_MODEL_PATH = './silero_vad.onnx';
const VAD_WINDOW = 512;

var Module = null;
let recognizer = null;
let vad = null;
let circularBuffer = null;
let ready = false;
let baseUrl = '';
let endpoint = false;
let speechDetected = false;
let totalSeconds = 0;
let initPromise = null;
let capturedChunks = [];
let capturedSamples = 0;

function ensureSlash(s) {
  s = String(s || '');
  return s.endsWith('/') ? s : s + '/';
}

function signalStats(samples) {
  let peak = 0, sumSq = 0, finite = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) continue;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sumSq += v * v;
    finite++;
  }
  return {
    peak,
    rms: finite ? Math.sqrt(sumSq / finite) : 0,
    nonFinite: samples.length - finite
  };
}

function toModelSampleRate(samples, inputRate) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const sr = Number(inputRate) || SAMPLE_RATE;
  if (!src.length || sr === SAMPLE_RATE) return new Float32Array(src);

  if (sr < SAMPLE_RATE) {
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

  // Area-average downsampling, matching sherpa's browser example style.
  const ratio = sr / SAMPLE_RATE;
  const outLen = Math.max(1, Math.round(src.length / ratio));
  const out = new Float32Array(outLen);
  let srcOffset = 0;
  for (let i = 0; i < outLen; i++) {
    const next = Math.min(src.length, Math.round((i + 1) * ratio));
    let sum = 0, n = 0;
    for (let j = srcOffset; j < next; j++) {
      const v = src[j];
      if (Number.isFinite(v)) { sum += v; n++; }
    }
    out[i] = n ? sum / n : 0;
    srcOffset = next;
  }
  return out;
}

function offlineRecognizerConfig() {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      nemoCtc: { model: MODEL_PATH },
      tokens: TOKENS_PATH,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: 'cjkchar',
      bpeVocab: ''
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    blankPenalty: 0,
    ruleFsts: '',
    ruleFars: ''
  };
}

function vadConfig() {
  return {
    sileroVad: {
      model: VAD_MODEL_PATH,
      threshold: 0.50,
      // A little longer than sherpa's 0.5 s default so natural pauses inside
      // a short Persian command don't split the utterance too aggressively.
      minSilenceDuration: 0.80,
      minSpeechDuration: 0.20,
      maxSpeechDuration: 15,
      windowSize: VAD_WINDOW
    },
    tenVad: {
      model: '', threshold: 0.50, minSilenceDuration: 0.80,
      minSpeechDuration: 0.20, maxSpeechDuration: 15, windowSize: 256
    },
    sampleRate: SAMPLE_RATE,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
    bufferSizeInSeconds: 30
  };
}

function createRuntimeObjects() {
  if (!Module) throw new Error('sherpa-runtime-not-ready');
  if (typeof OfflineRecognizer !== 'function') {
    throw new Error('sherpa-offline-recognizer-api-missing');
  }
  if (typeof createVad !== 'function' || typeof CircularBuffer !== 'function') {
    throw new Error('sherpa-vad-api-missing');
  }

  recognizer = new OfflineRecognizer(offlineRecognizerConfig(), Module);
  if (!recognizer || !recognizer.handle) throw new Error('sherpa-offline-recognizer-create-failed');

  vad = createVad(Module, vadConfig());
  if (!vad || !vad.handle) throw new Error('sherpa-vad-create-failed');

  circularBuffer = new CircularBuffer(30 * SAMPLE_RATE, Module);
  resetSession();
}

function resetSession() {
  if (vad) {
    try { vad.reset(); } catch (_) {}
  }
  if (circularBuffer) {
    try { circularBuffer.reset(); } catch (_) {}
  }
  endpoint = false;
  speechDetected = false;
  totalSeconds = 0;
  capturedChunks = [];
  capturedSamples = 0;
}

function postError(err, requestId) {
  self.postMessage({
    type: 'error',
    requestId: requestId || 0,
    message: String(err && (err.stack || err.message) || err || 'worker-error')
  });
}

function initRuntime(url) {
  if (ready) return Promise.resolve();
  if (initPromise) return initPromise;
  baseUrl = ensureSlash(url);

  initPromise = new Promise((resolve, reject) => {
    try {
      importScripts(baseUrl + ASR_WRAPPER_FILE);
      importScripts(baseUrl + VAD_WRAPPER_FILE);

      Module = {
        locateFile(path) { return baseUrl + path; },
        setStatus(status) {
          self.postMessage({ type: 'status', status: String(status || '') });
        },
        print() {
          self.postMessage({ type: 'sherpa-log', level: 'log', args: Array.from(arguments).map(String) });
        },
        printErr() {
          self.postMessage({ type: 'sherpa-log', level: 'warn', args: Array.from(arguments).map(String) });
        },
        onAbort(reason) {
          reject(new Error(String(reason || 'sherpa-wasm-abort')));
        },
        onRuntimeInitialized() {
          try {
            createRuntimeObjects();
            ready = true;
            self.postMessage({
              type: 'ready',
              sampleRate: SAMPLE_RATE,
              model: 'Koochik-v1.0-non-streaming-int8',
              vad: 'silero'
            });
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      };
      self.Module = Module;
      importScripts(baseUrl + RUNTIME_FILE);
      if (Module && Module.calledRun && !ready) {
        createRuntimeObjects();
        ready = true;
        self.postMessage({
          type: 'ready', sampleRate: SAMPLE_RATE,
          model: 'Koochik-v1.0-non-streaming-int8', vad: 'silero'
        });
        resolve();
      }
    } catch (e) {
      reject(e);
    }
  }).catch((e) => {
    initPromise = null;
    throw e;
  });

  return initPromise;
}

function appendCaptured(modelPcm) {
  if (!modelPcm.length) return;
  capturedChunks.push(new Float32Array(modelPcm));
  capturedSamples += modelPcm.length;
}

function flattenCaptured() {
  const out = new Float32Array(capturedSamples);
  let offset = 0;
  for (let i = 0; i < capturedChunks.length; i++) {
    out.set(capturedChunks[i], offset);
    offset += capturedChunks[i].length;
  }
  return out;
}

function processVad(modelPcm) {
  circularBuffer.push(modelPcm);
  const started = performance.now();
  let windows = 0;

  while (circularBuffer.size() >= VAD_WINDOW) {
    const s = circularBuffer.get(circularBuffer.head(), VAD_WINDOW);
    vad.acceptWaveform(s);
    circularBuffer.pop(VAD_WINDOW);
    windows++;

    if (vad.isDetected()) speechDetected = true;

    // Once Silero emits a completed segment, enough trailing silence has
    // occurred. We only use this as the endpoint signal; final ASR runs over
    // the full captured utterance so no word is lost at the VAD boundary.
    if (!vad.isEmpty()) {
      endpoint = true;
      while (!vad.isEmpty()) {
        try { vad.pop(); } catch (_) { break; }
      }
      break;
    }
  }

  return { windows, ms: performance.now() - started };
}

function feedMessage(msg) {
  if (!ready || !vad || !circularBuffer) throw new Error('sherpa-worker-not-ready');
  const inputRate = Number(msg.sampleRate) || SAMPLE_RATE;
  const input = new Float32Array(msg.buffer || 0);
  const inputStats = signalStats(input);
  const modelPcm = toModelSampleRate(input, inputRate);
  const modelStats = signalStats(modelPcm);
  totalSeconds += input.length / inputRate;
  appendCaptured(modelPcm);

  const vadWork = processVad(modelPcm);

  self.postMessage({
    type: 'result',
    sequence: msg.sequence || 0,
    steps: vadWork.windows,
    ms: vadWork.ms,
    queueDelayMs: msg.sentAt ? Math.max(0, Date.now() - msg.sentAt) : 0,
    inputSr: inputRate,
    modelSr: SAMPLE_RATE,
    inputPeak: inputStats.peak,
    inputRms: inputStats.rms,
    modelPeak: modelStats.peak,
    modelRms: modelStats.rms,
    nonFinite: modelStats.nonFinite,
    text: '',
    speechDetected,
    endpoint,
    bufferedSeconds: totalSeconds
  });
}

function finalizeMessage(requestId) {
  if (!ready || !recognizer) throw new Error('sherpa-worker-not-ready');

  // If capture was manually stopped before Silero emitted a completed segment,
  // flush VAD state for bookkeeping. Recognition still uses all captured PCM.
  try { if (vad) vad.flush(); } catch (_) {}

  const pcm = flattenCaptured();
  if (!pcm.length) {
    self.postMessage({
      type: 'final', requestId, steps: 0, ms: 0,
      text: '', bufferedSeconds: totalSeconds, capturedSamples: 0
    });
    return;
  }

  const started = performance.now();
  const offlineStream = recognizer.createStream();
  let text = '';
  try {
    offlineStream.acceptWaveform(SAMPLE_RATE, pcm);
    recognizer.decode(offlineStream);
    const result = recognizer.getResult(offlineStream);
    text = (result && result.text ? String(result.text) : '').trim();
  } finally {
    try { offlineStream.free(); } catch (_) {}
  }

  self.postMessage({
    type: 'final', requestId,
    steps: 1,
    ms: performance.now() - started,
    text,
    bufferedSeconds: totalSeconds,
    capturedSamples: pcm.length
  });
}

self.onmessage = function (event) {
  const msg = event.data || {};
  try {
    if (msg.type === 'init') {
      initRuntime(msg.baseUrl).catch((e) => postError(e, msg.requestId));
      return;
    }
    if (msg.type === 'reset') {
      resetSession();
      self.postMessage({ type: 'reset-done', requestId: msg.requestId || 0 });
      return;
    }
    if (msg.type === 'feed') {
      feedMessage(msg);
      return;
    }
    if (msg.type === 'finalize') {
      finalizeMessage(msg.requestId || 0);
      return;
    }
    if (msg.type === 'destroy') {
      if (circularBuffer) { try { circularBuffer.free(); } catch (_) {} circularBuffer = null; }
      if (vad) { try { vad.free(); } catch (_) {} vad = null; }
      if (recognizer) { try { recognizer.free(); } catch (_) {} recognizer = null; }
      capturedChunks = [];
      capturedSamples = 0;
      ready = false;
      self.postMessage({ type: 'destroyed', requestId: msg.requestId || 0 });
      return;
    }
  } catch (e) {
    postError(e, msg.requestId);
  }
};
