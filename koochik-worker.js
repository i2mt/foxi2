/* FoxiMed — Koochik sherpa-onnx worker
 * Runs the synchronous sherpa/ONNX decode loop off the page main thread.
 */
'use strict';

const SAMPLE_RATE = 16000;
const WRAPPER_FILE = 'sherpa-onnx-asr.js';
const RUNTIME_FILE = 'sherpa-onnx-wasm-main-asr.js';
const MODEL_PATH = './nemo-ctc.onnx';
const TOKENS_PATH = './tokens.txt';

var Module = null;
let recognizer = null;
let stream = null;
let ready = false;
let baseUrl = '';
let lastText = '';
let endpoint = false;
let totalSeconds = 0;
let capturedModelPcm = [];
let capturedModelSamples = 0;
let initPromise = null;

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
  if (!src.length || sr === SAMPLE_RATE) return src;

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

function recognizerConfig() {
  // Match OnlineRecognizer.from_nemo_ctc() defaults as closely as the
  // sherpa WebAssembly JS API allows. No transducer/BPE/hotword overrides.
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
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
      modelingUnit: 'cjkchar',
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

function createRecognizer() {
  if (recognizer) return;
  if (!Module || typeof self.createOnlineRecognizer !== 'function') {
    throw new Error('sherpa-runtime-not-ready');
  }
  recognizer = self.createOnlineRecognizer(Module, recognizerConfig());
  if (!recognizer || !recognizer.handle) {
    recognizer = null;
    throw new Error('sherpa-recognizer-create-failed');
  }
  resetStream();
}

function resetStream() {
  if (!recognizer) return;
  if (stream) {
    try { stream.free(); } catch (_) {}
  }
  stream = recognizer.createStream();
  lastText = '';
  endpoint = false;
  totalSeconds = 0;
  capturedModelPcm = [];
  capturedModelSamples = 0;
}


function appendCapturedPcm(samples) {
  if (!samples || !samples.length) return;
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  capturedModelPcm.push(copy);
  capturedModelSamples += copy.length;
}

function joinCapturedPcm() {
  const out = new Float32Array(capturedModelSamples);
  let offset = 0;
  for (let i = 0; i < capturedModelPcm.length; i++) {
    out.set(capturedModelPcm[i], offset);
    offset += capturedModelPcm[i].length;
  }
  return out;
}

function decodeFreshReplay(pcm, leadingSilenceSeconds) {
  if (!recognizer) throw new Error('sherpa-recognizer-not-ready');
  const replayStream = recognizer.createStream();
  let steps = 0;
  const started = performance.now();
  try {
    const leadSamples = Math.max(0, Math.round((Number(leadingSilenceSeconds) || 0) * SAMPLE_RATE));
    if (leadSamples) replayStream.acceptWaveform(SAMPLE_RATE, new Float32Array(leadSamples));
    if (pcm && pcm.length) replayStream.acceptWaveform(SAMPLE_RATE, pcm);
    replayStream.inputFinished();
    while (recognizer.isReady(replayStream)) {
      recognizer.decode(replayStream);
      steps++;
      if (steps > 256) throw new Error('sherpa-replay-decode-loop');
    }
    const result = recognizer.getResult(replayStream);
    return {
      text: (result && result.text ? String(result.text) : '').trim(),
      steps,
      ms: performance.now() - started,
      leadingSilenceSeconds: Number(leadingSilenceSeconds) || 0
    };
  } finally {
    try { replayStream.free(); } catch (_) {}
  }
}

function decodeFreshIncrementalReplay(chunks) {
  if (!recognizer) throw new Error('sherpa-recognizer-not-ready');
  const replayStream = recognizer.createStream();
  let steps = 0;
  const started = performance.now();
  try {
    for (let i = 0; i < chunks.length; i++) {
      replayStream.acceptWaveform(SAMPLE_RATE, chunks[i]);
      while (recognizer.isReady(replayStream)) {
        recognizer.decode(replayStream);
        steps++;
        if (steps > 256) throw new Error('sherpa-incremental-replay-decode-loop');
      }
    }
    replayStream.inputFinished();
    while (recognizer.isReady(replayStream)) {
      recognizer.decode(replayStream);
      steps++;
      if (steps > 256) throw new Error('sherpa-incremental-replay-final-loop');
    }
    const result = recognizer.getResult(replayStream);
    return {
      text: (result && result.text ? String(result.text) : '').trim(),
      steps,
      ms: performance.now() - started
    };
  } finally {
    try { replayStream.free(); } catch (_) {}
  }
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
      importScripts(baseUrl + WRAPPER_FILE);

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
            createRecognizer();
            ready = true;
            self.postMessage({ type: 'ready', sampleRate: SAMPLE_RATE });
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      };
      self.Module = Module;
      importScripts(baseUrl + RUNTIME_FILE);
      if (Module && Module.calledRun && !ready) {
        createRecognizer();
        ready = true;
        self.postMessage({ type: 'ready', sampleRate: SAMPLE_RATE });
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

function feedMessage(msg) {
  if (!ready || !stream) throw new Error('sherpa-worker-not-ready');
  const inputRate = Number(msg.sampleRate) || SAMPLE_RATE;
  const input = new Float32Array(msg.buffer || 0);
  const inputStats = signalStats(input);
  const modelPcm = toModelSampleRate(input, inputRate);
  const modelStats = signalStats(modelPcm);
  totalSeconds += input.length / inputRate;
  appendCapturedPcm(modelPcm);

  stream.acceptWaveform(SAMPLE_RATE, modelPcm);

  let steps = 0;
  const started = performance.now();
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
    steps++;
    if (steps > 64) throw new Error('sherpa-decode-loop');
  }

  const result = recognizer.getResult(stream);
  lastText = (result && result.text ? String(result.text) : '').trim();
  endpoint = !!recognizer.isEndpoint(stream);

  self.postMessage({
    type: 'result',
    sequence: msg.sequence || 0,
    steps,
    ms: performance.now() - started,
    queueDelayMs: msg.sentAt ? Math.max(0, Date.now() - msg.sentAt) : 0,
    inputSr: inputRate,
    modelSr: SAMPLE_RATE,
    inputPeak: inputStats.peak,
    inputRms: inputStats.rms,
    modelPeak: modelStats.peak,
    modelRms: modelStats.rms,
    nonFinite: modelStats.nonFinite,
    text: lastText,
    endpoint,
    bufferedSeconds: totalSeconds
  });
}

function finalizeMessage(requestId) {
  if (!ready || !stream) throw new Error('sherpa-worker-not-ready');
  stream.inputFinished();
  let steps = 0;
  const started = performance.now();
  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
    steps++;
    if (steps > 128) throw new Error('sherpa-final-decode-loop');
  }
  const result = recognizer.getResult(stream);
  lastText = (result && result.text ? String(result.text) : '').trim();
  const liveFinalMs = performance.now() - started;
  const exactPcm = joinCapturedPcm();

  // Return the normal final result immediately. The controlled replay tests
  // below are diagnostics only and must not make the UI wait several extra
  // seconds after the user stops speaking.
  self.postMessage({
    type: 'final', requestId,
    steps,
    ms: liveFinalMs,
    text: lastText,
    bufferedSeconds: totalSeconds
  });

  // #1 reproduces the original acceptWaveform chunk boundaries and decode
  // cadence on a completely fresh stream. It is the strict determinism test.
  const replayIncremental = decodeFreshIncrementalReplay(capturedModelPcm);
  // #2 feeds the exact same PCM as one continuous block. If this differs from
  // #1, feed/decode boundaries are influencing the result.
  const replayJoined = decodeFreshReplay(exactPcm, 0);
  // #3 adds 300 ms of clean context before the same PCM. If only this restores
  // the first word, start-of-stream context is the likely culprit.
  const replayLead = decodeFreshReplay(exactPcm, 0.30);

  self.postMessage({
    type: 'diagnostic',
    liveText: lastText,
    capturedSamples: exactPcm.length,
    capturedChunks: capturedModelPcm.length,
    replayIncrementalText: replayIncremental.text,
    replayIncrementalSteps: replayIncremental.steps,
    replayIncrementalMs: replayIncremental.ms,
    replayJoinedText: replayJoined.text,
    replayJoinedSteps: replayJoined.steps,
    replayJoinedMs: replayJoined.ms,
    replayLeadText: replayLead.text,
    replayLeadSteps: replayLead.steps,
    replayLeadMs: replayLead.ms,
    replayLeadSeconds: replayLead.leadingSilenceSeconds,
    deterministic: lastText === replayIncremental.text
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
      resetStream();
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
      if (stream) { try { stream.free(); } catch (_) {} stream = null; }
      if (recognizer) { try { recognizer.free(); } catch (_) {} recognizer = null; }
      ready = false;
      self.postMessage({ type: 'destroyed', requestId: msg.requestId || 0 });
      return;
    }
  } catch (e) {
    postError(e, msg.requestId);
  }
};
