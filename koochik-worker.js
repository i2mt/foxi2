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

const BUILD_ID = 'v27-offline-conditioner';
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
const ENERGY_TRAILING_SILENCE_SEC = 0.80;
const NO_SPEECH_TIMEOUT_SEC = 4.5;
const HARD_UTTERANCE_LIMIT_SEC = 12.0;
const ENERGY_ONLY_MAX_SEC = 6.0;

// Offline decode conditioner. Koochik has been most reliable in the browser
// when speech frames arrive around ~0.03-0.05 RMS. Chrome/AGC can produce a
// very hot startup burst (0.2-0.3 RMS, peaks >0.7). We preserve every sample
// but attenuate only over-hot 20 ms frames before the offline decode. Quiet or
// normal speech is never boosted.
const OFFLINE_FRAME_SAMPLES = 320; // 20 ms @ 16 kHz
const OFFLINE_LIMIT_START_RMS = 0.070;
const OFFLINE_TARGET_RMS = 0.050;
const OFFLINE_LIMIT_START_PEAK = 0.30;
const OFFLINE_TARGET_PEAK = 0.25;
const OFFLINE_MIN_GAIN = 0.10;
const OFFLINE_RELEASE = 0.45;
const ENERGY_REFERENCE_CAP_RMS = 0.120;
const ENERGY_HOLD_RATIO = 0.28;
const ENERGY_HOLD_MIN_RMS = 0.012;
const ENERGY_HOLD_MAX_RMS = 0.034;

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


function conditionOfflinePcm(pcm) {
  const out = new Float32Array(pcm);
  const before = signalStats(pcm);
  let gain = 1.0;
  let minGain = 1.0;
  let limitedFrames = 0;
  let frames = 0;

  for (let start = 0; start < out.length; start += OFFLINE_FRAME_SAMPLES) {
    const end = Math.min(out.length, start + OFFLINE_FRAME_SAMPLES);
    let peak = 0, sumSq = 0, n = 0;
    for (let i = start; i < end; i++) {
      const v = out[i];
      if (!Number.isFinite(v)) continue;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sumSq += v * v;
      n++;
    }
    const rms = n ? Math.sqrt(sumSq / n) : 0;
    let targetGain = 1.0;
    if (rms > OFFLINE_LIMIT_START_RMS) {
      targetGain = Math.min(targetGain, OFFLINE_TARGET_RMS / Math.max(rms, 1e-9));
    }
    if (peak > OFFLINE_LIMIT_START_PEAK) {
      targetGain = Math.min(targetGain, OFFLINE_TARGET_PEAK / Math.max(peak, 1e-9));
    }
    targetGain = Math.max(OFFLINE_MIN_GAIN, Math.min(1.0, targetGain));

    // Fast attack, controlled release. This knocks down the startup burst
    // immediately but returns to unity within a few frames once normal speech
    // level is reached.
    if (targetGain < gain) gain = targetGain;
    else gain += (targetGain - gain) * OFFLINE_RELEASE;

    if (gain < 0.999) limitedFrames++;
    minGain = Math.min(minGain, gain);
    frames++;
    for (let i = start; i < end; i++) out[i] *= gain;
  }

  return {
    pcm: out,
    before,
    after: signalStats(out),
    minGain,
    limitedFrames,
    frames
  };
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
  let sileroActiveNow = false;
  let segmentReady = false;

  while (circularBuffer.size() >= VAD_WINDOW) {
    const s = circularBuffer.get(circularBuffer.head(), VAD_WINDOW);
    vad.acceptWaveform(s);
    circularBuffer.pop(VAD_WINDOW);
    windows++;

    if (vad.isDetected()) {
      sileroActiveNow = true;
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
      // A completed Silero segment is only a CANDIDATE endpoint. v25 showed
      // that Silero can finish a segment while energy still says the speaker
      // is talking. processEnergy() arbitrates the final stop decision.
      segmentReady = true;
      while (!vad.isEmpty()) {
        try { vad.pop(); } catch (_) { break; }
      }
    }
  }

  return {
    windows,
    ms: performance.now() - started,
    sileroActiveNow,
    segmentReady
  };
}

function processEnergy(modelStats, chunkStartSample, chunkEndSample, vadWork) {
  const strong = modelStats.rms >= ENERGY_START_RMS && modelStats.peak >= ENERGY_START_PEAK;

  if (!energySpeechDetected) {
    energyStartConfirm = strong ? energyStartConfirm + 1 : 0;
    if (strong) energyPeakRms = Math.max(energyPeakRms, modelStats.rms);
    if (energyStartConfirm >= ENERGY_START_CONFIRM_CHUNKS) {
      energySpeechDetected = true;
      speechDetected = true;
      // Keep the entire beginning of the recording for the offline recognizer.
      // speechStartSample is diagnostic only; final decoding no longer
      // trims the start of short utterances.
      speechStartSample = Math.max(0, chunkStartSample - (chunkEndSample - chunkStartSample));
      lastVoiceSample = chunkEndSample;
    }
  }

  if (energySpeechDetected) {
    energyPeakRms = Math.max(energyPeakRms, modelStats.rms);
  }

  // v25 capped the hold threshold at 0.020 RMS. In the user's third test,
  // steady post-speech room noise sat around 0.027-0.030 RMS, so it was
  // incorrectly held as speech for ~12 seconds. the current controller derives the tail threshold
  // from the utterance level, but caps the REFERENCE (not the threshold) so a
  // loud first callback cannot make quiet trailing syllables disappear.
  const referenceRms = Math.min(
    ENERGY_REFERENCE_CAP_RMS,
    Math.max(ENERGY_START_RMS, energyPeakRms || ENERGY_START_RMS)
  );
  const holdRms = Math.max(
    ENERGY_HOLD_MIN_RMS,
    Math.min(ENERGY_HOLD_MAX_RMS, referenceRms * ENERGY_HOLD_RATIO)
  );
  const softPeakGate = Math.max(0.070, holdRms * 2.2);
  const energyVoiceNow = modelStats.rms >= holdRms ||
    (modelStats.rms >= holdRms * 0.85 && modelStats.peak >= softPeakGate);

  // Current Silero activity is authoritative for "still speaking" even when
  // energy briefly dips. Conversely, a completed Silero segment cannot stop
  // the utterance while energy still looks voice-like.
  const currentVoice = !!(vadWork && vadWork.sileroActiveNow) ||
    (energySpeechDetected && energyVoiceNow);
  if (currentVoice) lastVoiceSample = chunkEndSample;

  const anySpeech = sileroSpeechDetected || energySpeechDetected;
  speechDetected = anySpeech;

  if (!endpoint && vadWork && vadWork.segmentReady && anySpeech && !currentVoice) {
    endpoint = true;
    endpointReason = 'silero';
  }

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

  // Energy is a fallback for cases where Silero misses a short Persian
  // command. If Silero never confirms speech, do not let a persistent noise
  // floor keep the microphone open for the full hard limit.
  if (!endpoint && energySpeechDetected && !sileroSpeechDetected &&
      totalSeconds >= ENERGY_ONLY_MAX_SEC) {
    endpoint = true;
    endpointReason = 'energy-only-limit';
  }

  if (!endpoint && totalSeconds >= HARD_UTTERANCE_LIMIT_SEC) {
    endpoint = true;
    endpointReason = anySpeech ? 'hard-limit' : 'no-speech-hard-limit';
    if (!anySpeech) noSpeechTimedOut = true;
  }

  return { energyVoiceNow, holdRms, referenceRms };
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
  const energyWork = processEnergy(modelStats, chunkStartSample, chunkEndSample, vadWork);

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
    sileroActiveNow: !!vadWork.sileroActiveNow,
    energySpeechDetected,
    energyVoiceNow: !!energyWork.energyVoiceNow,
    energyHoldRms: energyWork.holdRms,
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

  // The current path deliberately decodes the entire short captured utterance. The previous trimming pass's
  // trimming saved little time but could remove useful onset/coda context from
  // commands such as "حالت روشن". Endpoint control now keeps recordings short.
  const startSample = 0;
  const endSample = pcm.length;
  const conditioned = conditionOfflinePcm(pcm);
  const decodePcm = conditioned.pcm;
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
    endpointReason,
    rawPeak: conditioned.before.peak,
    rawRms: conditioned.before.rms,
    conditionedPeak: conditioned.after.peak,
    conditionedRms: conditioned.after.rms,
    conditionerMinGain: conditioned.minGain,
    conditionerLimitedFrames: conditioned.limitedFrames,
    conditionerFrames: conditioned.frames
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
