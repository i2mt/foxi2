/* FoxiMed — Koochik non-streaming sherpa-onnx worker
 *
 * v24 architecture:
 *   microphone PCM -> hybrid Silero+energy endpoint -> full-context Koochik INT8
 *
 * VAD runs continuously in this Dedicated Worker. The expensive non-streaming
 * ASR pass runs only once, after capture stops, so it cannot starve microphone
 * callbacks on the page thread.
 */
'use strict';

const BUILD_ID = 'v25-hybrid-cachebust';
const SAMPLE_RATE = 16000;
const ASR_WRAPPER_FILE = 'sherpa-onnx-asr.js';
const VAD_WRAPPER_FILE = 'sherpa-onnx-vad.js';
const RUNTIME_FILE = 'sherpa-onnx-wasm-main-vad-asr.js';
const MODEL_PATH = './nemo-ctc.onnx';
const TOKENS_PATH = './tokens.txt';
const VAD_MODEL_PATH = './silero_vad.onnx';
const VAD_WINDOW = 512;

// Hybrid utterance controller. Silero remains primary, but a lightweight
// energy fallback prevents missed speech on short commands from keeping the
// microphone open for tens of seconds. Thresholds are deliberately below the
// RMS observed in real speech tests (~0.02-0.05) and above post-speech noise
// (~0.005-0.009).
const ENERGY_START_RMS = 0.016;
const ENERGY_START_PEAK = 0.030;
const ENERGY_START_CONFIRM_CHUNKS = 2;
const ENERGY_TRAILING_SILENCE_SEC = 0.95;
const NO_SPEECH_TIMEOUT_SEC = 5.0;
const HARD_UTTERANCE_LIMIT_SEC = 15.0;
const PRE_ROLL_SEC = 0.45;
const POST_ROLL_SEC = 0.45;

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
let sileroSpeechDetected = false;
let energySpeechDetected = false;
let energyStartConfirm = 0;
let energyPeakRms = 0;
let speechStartSample = -1;
let lastVoiceSample = -1;
let endpointReason = '';
let noSpeechTimedOut = false;

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
      threshold: 0.40,
      // Short command mode: enough trailing silence to avoid chopping natural
      // pauses, but faster than v23's 0.8 s when Silero is confident.
      minSilenceDuration: 0.70,
      minSpeechDuration: 0.20,
      maxSpeechDuration: 15,
      windowSize: VAD_WINDOW
    },
    tenVad: {
      model: '', threshold: 0.40, minSilenceDuration: 0.70,
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
  sileroSpeechDetected = false;
  energySpeechDetected = false;
  energyStartConfirm = 0;
  energyPeakRms = 0;
  speechStartSample = -1;
  lastVoiceSample = -1;
  endpointReason = '';
  noSpeechTimedOut = false;
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
              build: BUILD_ID,
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
          type: 'ready', build: BUILD_ID, sampleRate: SAMPLE_RATE,
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

    if (vad.isDetected()) {
      sileroSpeechDetected = true;
      speechDetected = true;
      if (speechStartSample < 0) {
        // Silero can assert detection after some latency. Preserve generous
        // pre-context instead of treating this late detection point as the
        // literal beginning of speech.
        speechStartSample = Math.max(0, capturedSamples - Math.round(1.25 * SAMPLE_RATE));
      }
    }

    if (!vad.isEmpty()) {
      endpoint = true;
      if (!endpointReason) endpointReason = 'silero';
      while (!vad.isEmpty()) {
        try { vad.pop(); } catch (_) { break; }
      }
      break;
    }
  }

  return { windows, ms: performance.now() - started };
}

function processEnergy(modelStats, chunkStartSample, chunkEndSample) {
  const strong = modelStats.rms >= ENERGY_START_RMS && modelStats.peak >= ENERGY_START_PEAK;

  if (!energySpeechDetected) {
    energyStartConfirm = strong ? energyStartConfirm + 1 : 0;
    if (strong) energyPeakRms = Math.max(energyPeakRms, modelStats.rms);
    if (energyStartConfirm >= ENERGY_START_CONFIRM_CHUNKS) {
      energySpeechDetected = true;
      speechDetected = true;
      // Include the confirming chunk plus one previous chunk. Finalization adds
      // another fixed pre-roll below, so short initial syllables are retained.
      speechStartSample = Math.max(0, chunkStartSample - (chunkEndSample - chunkStartSample));
      lastVoiceSample = chunkEndSample;
    }
  }

  const anySpeechBeforeTail = sileroSpeechDetected || energySpeechDetected;
  if (anySpeechBeforeTail) {
    energyPeakRms = Math.max(energyPeakRms, modelStats.rms);
    // Adaptive tail threshold: after a loud/normal phrase, steady room noise
    // around RMS 0.014-0.016 should still count as silence. For quiet speech,
    // the floor stays low enough to preserve soft trailing syllables.
    const holdRms = Math.max(0.010, Math.min(0.020, energyPeakRms * 0.52));
    const voiceLike = modelStats.rms >= holdRms ||
      (modelStats.rms >= holdRms * 0.75 && modelStats.peak >= 0.045);
    if (voiceLike) lastVoiceSample = chunkEndSample;
  }

  const anySpeech = sileroSpeechDetected || energySpeechDetected;
  speechDetected = anySpeech;

  if (!endpoint && anySpeech && lastVoiceSample >= 0) {
    const silenceSamples = Math.max(0, capturedSamples - lastVoiceSample);
    if (silenceSamples / SAMPLE_RATE >= ENERGY_TRAILING_SILENCE_SEC) {
      endpoint = true;
      endpointReason = 'energy-silence';
    }
  }

  if (!endpoint && !anySpeech && totalSeconds >= NO_SPEECH_TIMEOUT_SEC) {
    endpoint = true;
    endpointReason = 'no-speech-timeout';
    noSpeechTimedOut = true;
  }

  if (!endpoint && totalSeconds >= HARD_UTTERANCE_LIMIT_SEC) {
    endpoint = true;
    endpointReason = anySpeech ? 'hard-limit' : 'no-speech-hard-limit';
    if (!anySpeech) noSpeechTimedOut = true;
  }
}

function feedMessage(msg) {
  if (!ready || !vad || !circularBuffer) throw new Error('sherpa-worker-not-ready');
  const inputRate = Number(msg.sampleRate) || SAMPLE_RATE;
  const input = new Float32Array(msg.buffer || 0);
  const inputStats = signalStats(input);
  const modelPcm = toModelSampleRate(input, inputRate);
  const modelStats = signalStats(modelPcm);
  totalSeconds += input.length / inputRate;
  const chunkStartSample = capturedSamples;
  appendCaptured(modelPcm);
  const chunkEndSample = capturedSamples;

  const vadWork = processVad(modelPcm);
  processEnergy(modelStats, chunkStartSample, chunkEndSample);

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
    sileroSpeechDetected,
    energySpeechDetected,
    endpoint,
    endpointReason,
    bufferedSeconds: totalSeconds
  });
}

function finalizeMessage(requestId) {
  if (!ready || !recognizer) throw new Error('sherpa-worker-not-ready');

  try { if (vad) vad.flush(); } catch (_) {}

  const pcm = flattenCaptured();
  if (!pcm.length) {
    self.postMessage({
      type: 'final', requestId, steps: 0, ms: 0,
      text: '', bufferedSeconds: totalSeconds, capturedSamples: 0,
      decodeSamples: 0, decodeSeconds: 0, endpointReason
    });
    return;
  }

  // If the automatic no-speech timeout fired, don't waste several seconds
  // asking the large ASR model to decode pure room noise.
  if (noSpeechTimedOut && !speechDetected) {
    self.postMessage({
      type: 'final', requestId, steps: 0, ms: 0,
      text: '', bufferedSeconds: totalSeconds, capturedSamples: pcm.length,
      decodeSamples: 0, decodeSeconds: 0, endpointReason
    });
    return;
  }

  let startSample = 0;
  let endSample = pcm.length;
  if (speechStartSample >= 0) {
    startSample = Math.max(0, speechStartSample - Math.round(PRE_ROLL_SEC * SAMPLE_RATE));
  }
  if (lastVoiceSample >= 0 && endpointReason === 'energy-silence') {
    endSample = Math.min(pcm.length, lastVoiceSample + Math.round(POST_ROLL_SEC * SAMPLE_RATE));
  }
  if (endSample <= startSample) { startSample = 0; endSample = pcm.length; }

  const decodePcm = pcm.subarray(startSample, endSample);
  const started = performance.now();
  const offlineStream = recognizer.createStream();
  let text = '';
  try {
    offlineStream.acceptWaveform(SAMPLE_RATE, decodePcm);
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
    capturedSamples: pcm.length,
    decodeSamples: decodePcm.length,
    decodeSeconds: decodePcm.length / SAMPLE_RATE,
    trimStartSeconds: startSample / SAMPLE_RATE,
    trimEndSeconds: endSample / SAMPLE_RATE,
    endpointReason
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
