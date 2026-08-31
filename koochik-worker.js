/* FoxiMed — Rizeh non-streaming sherpa-onnx worker
 *
 * v29 architecture:
 *   microphone PCM -> Silero VAD + fixed-frame energy fallback
 *   -> detected speech segment -> one offline Rizeh INT8 decode
 *
 * Both VAD and ASR stay inside this Dedicated Worker. The page thread only
 * captures audio, which keeps microphone callbacks responsive on low-memory
 * iOS PWAs.
 */
'use strict';

const BUILD_ID = 'v34-rizeh-offline';
const SAMPLE_RATE = 16000;
const ASR_WRAPPER_FILE = 'sherpa-onnx-asr.js';
const VAD_WRAPPER_FILE = 'sherpa-onnx-vad.js';
const RUNTIME_FILE = 'sherpa-onnx-wasm-main-vad-asr.js';
const MODEL_PATH = './nemo-ctc.onnx';
const TOKENS_PATH = './tokens.txt';
const VAD_MODEL_PATH = './silero_vad.onnx';
const VAD_WINDOW = 512;

// Energy detection is evaluated on fixed 20 ms frames. Browser audio callback
// sizes vary by device, so counting callbacks made the old detector require
// ~170 ms on one device and ~510 ms on another.
const ENERGY_FRAME_SAMPLES = 320;
const ENERGY_START_RMS = 0.016;
const ENERGY_START_PEAK = 0.030;
const ENERGY_START_CONFIRM_FRAMES = 4; // 80 ms
const ENERGY_REFERENCE_CAP_RMS = 0.120;
const ENERGY_HOLD_RATIO = 0.28;
const ENERGY_HOLD_MIN_RMS = 0.012;
const ENERGY_HOLD_MAX_RMS = 0.034;
const ENERGY_TRAILING_SILENCE_SEC = 0.80;
const NO_SPEECH_TIMEOUT_SEC = 4.5;
const HARD_UTTERANCE_LIMIT_SEC = 12.0;
const ENERGY_ONLY_MAX_SEC = 6.0;
const ENERGY_PREROLL_SEC = 0.25;
const ENERGY_POSTROLL_SEC = 0.45;
const SEGMENT_GAP_SEC = 0.08;
const MIN_DECODE_SEC = 0.15;

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
let detectedSegments = [];
let sileroSpeechDetected = false;
let energySpeechDetected = false;
let energyStartConfirm = 0;
let energyCandidateStartSample = -1;
let energyPeakRms = 0;
let energyRemainder = new Float32Array(0);
let energyProcessedSamples = 0;
let speechStartSample = -1;
let lastVoiceSample = -1;
let endpointReason = '';
let noSpeechTimedOut = false;

function ensureSlash(s) {
  s = String(s || '');
  return s.endsWith('/') ? s : s + '/';
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
    peak,
    rms: finite ? Math.sqrt(sumSq / finite) : 0,
    nonFinite: samples.length - finite
  };
}

function sanitizeCopy(samples) {
  const out = new Float32Array(samples || []);
  for (let i = 0; i < out.length; i++) {
    if (!Number.isFinite(out[i])) out[i] = 0;
  }
  return out;
}

function toModelSampleRate(samples, inputRate) {
  const src = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
  const sr = Number(inputRate) || SAMPLE_RATE;
  if (!src.length || sr === SAMPLE_RATE) return sanitizeCopy(src);

  if (sr < SAMPLE_RATE) {
    const outLen = Math.max(1, Math.round(src.length * SAMPLE_RATE / sr));
    const out = new Float32Array(outLen);
    const scale = sr / SAMPLE_RATE;
    for (let i = 0; i < outLen; i++) {
      const pos = i * scale;
      const a = Math.min(src.length - 1, Math.floor(pos));
      const b = Math.min(src.length - 1, a + 1);
      const t = pos - a;
      const av = Number.isFinite(src[a]) ? src[a] : 0;
      const bv = Number.isFinite(src[b]) ? src[b] : 0;
      out[i] = av + (bv - av) * t;
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
    let sum = 0;
    let n = 0;
    for (let j = srcOffset; j < next; j++) {
      const v = src[j];
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
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
  energyCandidateStartSample = -1;
  energyPeakRms = 0;
  energyRemainder = new Float32Array(0);
  energyProcessedSamples = 0;
  speechStartSample = -1;
  lastVoiceSample = -1;
  endpointReason = '';
  noSpeechTimedOut = false;
  totalSeconds = 0;
  capturedChunks = [];
  capturedSamples = 0;
  detectedSegments = [];
}

function postError(err, requestId) {
  self.postMessage({
    type: 'error',
    requestId: requestId || 0,
    message: String(err && (err.stack || err.message) || err || 'worker-error')
  });
}

function readyMessage() {
  self.postMessage({
    type: 'ready',
    build: BUILD_ID,
    sampleRate: SAMPLE_RATE,
    model: 'Shenava-Rizeh-v1.0-non-streaming-int8',
    vad: 'silero-segmented'
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
            readyMessage();
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
        readyMessage();
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

function drainVadSegments() {
  let count = 0;
  while (vad && !vad.isEmpty()) {
    try {
      const segment = vad.front();
      if (segment && segment.samples && segment.samples.length) {
        // front().samples points into WASM-owned memory. Copy it before pop().
        detectedSegments.push(new Float32Array(segment.samples));
        count++;
      }
      vad.pop();
    } catch (_) {
      break;
    }
  }
  return count;
}

function processVad(modelPcm) {
  circularBuffer.push(modelPcm);
  const started = performance.now();
  let windows = 0;
  let sileroActiveNow = false;
  let completedSegments = 0;

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
        speechStartSample = Math.max(0, capturedSamples - Math.round(1.25 * SAMPLE_RATE));
      }
    }

    completedSegments += drainVadSegments();
  }

  return {
    windows,
    ms: performance.now() - started,
    sileroActiveNow,
    segmentReady: completedSegments > 0
  };
}

function energyThresholds() {
  const referenceRms = Math.min(
    ENERGY_REFERENCE_CAP_RMS,
    Math.max(ENERGY_START_RMS, energyPeakRms || ENERGY_START_RMS)
  );
  const holdRms = Math.max(
    ENERGY_HOLD_MIN_RMS,
    Math.min(ENERGY_HOLD_MAX_RMS, referenceRms * ENERGY_HOLD_RATIO)
  );
  return { referenceRms, holdRms };
}

function processEnergy(modelPcm, vadWork) {
  const merged = new Float32Array(energyRemainder.length + modelPcm.length);
  merged.set(energyRemainder, 0);
  merged.set(modelPcm, energyRemainder.length);

  let offset = 0;
  let energyVoiceNow = false;
  let lastFrameStats = { peak: 0, rms: 0, nonFinite: 0 };

  while (offset + ENERGY_FRAME_SAMPLES <= merged.length) {
    const frame = merged.subarray(offset, offset + ENERGY_FRAME_SAMPLES);
    const stats = signalStats(frame);
    lastFrameStats = stats;
    const frameStart = energyProcessedSamples;
    const frameEnd = frameStart + ENERGY_FRAME_SAMPLES;
    const strong = stats.rms >= ENERGY_START_RMS && stats.peak >= ENERGY_START_PEAK;

    if (!energySpeechDetected) {
      if (strong) {
        if (energyStartConfirm === 0) energyCandidateStartSample = frameStart;
        energyStartConfirm++;
        energyPeakRms = Math.max(energyPeakRms, stats.rms);
      } else {
        energyStartConfirm = 0;
        energyCandidateStartSample = -1;
      }

      if (energyStartConfirm >= ENERGY_START_CONFIRM_FRAMES) {
        energySpeechDetected = true;
        speechDetected = true;
        const candidate = energyCandidateStartSample >= 0 ? energyCandidateStartSample : frameStart;
        speechStartSample = speechStartSample < 0
          ? Math.max(0, candidate - Math.round(ENERGY_PREROLL_SEC * SAMPLE_RATE))
          : Math.min(speechStartSample, candidate);
        lastVoiceSample = frameEnd;
      }
    }

    if (energySpeechDetected) energyPeakRms = Math.max(energyPeakRms, stats.rms);
    const thresholds = energyThresholds();
    const softPeakGate = Math.max(0.070, thresholds.holdRms * 2.2);
    energyVoiceNow = energySpeechDetected && (
      stats.rms >= thresholds.holdRms ||
      (stats.rms >= thresholds.holdRms * 0.85 && stats.peak >= softPeakGate)
    );
    if (energyVoiceNow) lastVoiceSample = frameEnd;

    energyProcessedSamples = frameEnd;
    offset += ENERGY_FRAME_SAMPLES;
  }

  energyRemainder = new Float32Array(merged.subarray(offset));

  // Silero remains authoritative while it sees active speech.
  const currentVoice = !!(vadWork && vadWork.sileroActiveNow) || energyVoiceNow;
  if (vadWork && vadWork.sileroActiveNow) lastVoiceSample = capturedSamples;

  const anySpeech = sileroSpeechDetected || energySpeechDetected;
  speechDetected = anySpeech;

  if (!endpoint && vadWork && vadWork.segmentReady && anySpeech && !currentVoice) {
    endpoint = true;
    endpointReason = 'silero-segment';
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

  const thresholds = energyThresholds();
  return {
    energyVoiceNow,
    holdRms: thresholds.holdRms,
    referenceRms: thresholds.referenceRms,
    frameRms: lastFrameStats.rms,
    framePeak: lastFrameStats.peak
  };
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
  const energyWork = processEnergy(modelPcm, vadWork);

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
    energyFramePeak: energyWork.framePeak,
    energyFrameRms: energyWork.frameRms,
    nonFinite: modelStats.nonFinite,
    text: '',
    speechDetected,
    sileroSpeechDetected,
    sileroActiveNow: !!vadWork.sileroActiveNow,
    sileroSegments: detectedSegments.length,
    energySpeechDetected,
    energyVoiceNow: !!energyWork.energyVoiceNow,
    energyHoldRms: energyWork.holdRms,
    endpoint,
    endpointReason,
    bufferedSeconds: totalSeconds
  });
}

function concatenateSegments(segments) {
  const valid = segments.filter((segment) =>
    segment && segment.length >= Math.round(MIN_DECODE_SEC * SAMPLE_RATE)
  );
  if (!valid.length) return new Float32Array(0);
  const gapLength = Math.round(SEGMENT_GAP_SEC * SAMPLE_RATE);
  let total = 0;
  for (let i = 0; i < valid.length; i++) total += valid[i].length + (i ? gapLength : 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (let i = 0; i < valid.length; i++) {
    if (i) offset += gapLength;
    out.set(valid[i], offset);
    offset += valid[i].length;
  }
  return out;
}

function chooseDecodePcm(captured) {
  if (!speechDetected) {
    return { pcm: new Float32Array(0), source: 'no-speech', startSample: 0, endSample: 0 };
  }

  const startSample = Math.max(0, speechStartSample >= 0 ? speechStartSample : 0);
  const endSample = Math.min(
    captured.length,
    lastVoiceSample >= 0
      ? lastVoiceSample + Math.round(ENERGY_POSTROLL_SEC * SAMPLE_RATE)
      : captured.length
  );

  // Prefer the raw capture bounded by the independent energy detector when
  // it is available. Silero's completed segment is excellent for endpoint
  // timing, but its returned samples can end at the speech boundary. The
  // non-streaming CTC model then repeatedly loses the last syllable of the
  // final medical word (observed: سوختگی→سوخت, هپارین→هپار,
  // برادن→بر). Keeping 250 ms of real preroll and 450 ms of real postroll
  // gives Rizeh the acoustic context without decoding the whole session.
  if (energySpeechDetected && lastVoiceSample >= 0 &&
      endSample - startSample >= Math.round(MIN_DECODE_SEC * SAMPLE_RATE)) {
    return {
      pcm: new Float32Array(captured.subarray(startSample, endSample)),
      source: 'energy-context',
      startSample,
      endSample
    };
  }

  const segmented = concatenateSegments(detectedSegments);
  if (segmented.length) {
    return { pcm: segmented, source: 'silero-segments', startSample: 0, endSample: segmented.length };
  }

  if (endSample - startSample < Math.round(MIN_DECODE_SEC * SAMPLE_RATE)) {
    return { pcm: new Float32Array(0), source: 'too-short', startSample, endSample };
  }
  return {
    pcm: new Float32Array(captured.subarray(startSample, endSample)),
    source: 'energy-context-fallback',
    startSample,
    endSample
  };
}

function postEmptyFinal(requestId, pcmLength, decodeSource) {
  self.postMessage({
    type: 'final', requestId, steps: 0, ms: 0,
    text: '', bufferedSeconds: totalSeconds, capturedSamples: pcmLength,
    decodeSamples: 0, decodeSeconds: 0, endpointReason,
    decodeSource: decodeSource || 'no-speech', sileroSegments: detectedSegments.length
  });
}

function finalizeMessage(requestId) {
  if (!ready || !recognizer) throw new Error('sherpa-worker-not-ready');

  // Process the last partial VAD window with zero padding, then flush and
  // retain any completed segment before freeing the VAD-owned view.
  try {
    if (circularBuffer && circularBuffer.size() > 0) {
      const remaining = circularBuffer.size();
      const padded = new Float32Array(VAD_WINDOW);
      padded.set(circularBuffer.get(circularBuffer.head(), remaining));
      vad.acceptWaveform(padded);
      circularBuffer.pop(remaining);
    }
    vad.flush();
    drainVadSegments();
  } catch (_) {}

  const captured = flattenCaptured();
  if (!captured.length) {
    postEmptyFinal(requestId, 0, 'empty-capture');
    return;
  }

  if (noSpeechTimedOut && !speechDetected) {
    postEmptyFinal(requestId, captured.length, 'no-speech-timeout');
    return;
  }

  const chosen = chooseDecodePcm(captured);
  const decodePcm = chosen.pcm;
  if (!decodePcm.length) {
    postEmptyFinal(requestId, captured.length, chosen.source);
    return;
  }

  const rawStats = signalStats(captured);
  const decodeStats = signalStats(decodePcm);
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
    capturedSamples: captured.length,
    decodeSamples: decodePcm.length,
    decodeSeconds: decodePcm.length / SAMPLE_RATE,
    trimStartSeconds: chosen.startSample / SAMPLE_RATE,
    trimEndSeconds: chosen.endSample / SAMPLE_RATE,
    decodeSource: chosen.source,
    sileroSegments: detectedSegments.length,
    endpointReason,
    rawPeak: rawStats.peak,
    rawRms: rawStats.rms,
    decodePeak: decodeStats.peak,
    decodeRms: decodeStats.rms
  });
}

function freeRuntimeObjects() {
  if (circularBuffer) {
    try { circularBuffer.free(); } catch (_) {}
    circularBuffer = null;
  }
  if (vad) {
    try { vad.free(); } catch (_) {}
    vad = null;
  }
  if (recognizer) {
    try { recognizer.free(); } catch (_) {}
    recognizer = null;
  }
  capturedChunks = [];
  detectedSegments = [];
  capturedSamples = 0;
  ready = false;
  initPromise = null;
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
      freeRuntimeObjects();
      self.postMessage({ type: 'destroyed', requestId: msg.requestId || 0 });
    }
  } catch (e) {
    postError(e, msg.requestId);
  }
};
