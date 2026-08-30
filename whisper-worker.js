/* FoxiMed — dedicated WebGPU Whisper worker.
 * Pinned runtime/model IDs make production behavior repeatable. Model weights
 * use Transformers.js' browser cache and are never included in the app shell.
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

const MODEL_IDS = {
    base: 'onnx-community/whisper-base',
    tiny: 'onnx-community/whisper-tiny'
};

const MODEL_REVISIONS = {
    base: '1846881',
    tiny: 'ff41770'
};

// Keep Base's encoder unquantized for the best Persian/medical accuracy on
// the high-memory devices that are allowed to select it. Tiny is the
// constrained-device option: its q4 encoder cuts the largest up-front
// allocation/download substantially and is supported by the pinned model.
const MODEL_DTYPES = {
    base: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
    tiny: { encoder_model: 'q4', decoder_model_merged: 'q4' }
};

// Transformers.js reports progress one file at a time. Some Hugging Face/Xet
// responses omit Content-Length, so using that raw value makes a bar reset for
// every file or remain indeterminate. These sizes belong to the pinned model
// revisions above and let us report one monotonic, whole-model percentage.
const COMMON_FILE_BYTES = {
    'added_tokens.json': 34600,
    'config.json': 2240,
    'generation_config.json': 3830,
    'merges.txt': 494000,
    'normalizer.json': 52700,
    'preprocessor_config.json': 339,
    'quantize_config.json': 10100,
    'special_tokens_map.json': 2190,
    'tokenizer.json': 2480000,
    'tokenizer_config.json': 283000,
    'vocab.json': 1040000
};

const MODEL_FILE_BYTES = {
    base: Object.assign({}, COMMON_FILE_BYTES, {
        'onnx/encoder_model.onnx': 82500000,
        'onnx/decoder_model_merged_q4.onnx': 124000000
    }),
    tiny: Object.assign({}, COMMON_FILE_BYTES, {
        'onnx/encoder_model_q4.onnx': 9020000,
        'onnx/decoder_model_merged_q4.onnx': 86700000
    })
};

let transcriber = null;
let loadedModel = '';

function normalizeFileName(file) {
    const clean = String(file || '').split(/[?#]/)[0].replace(/^\.\//, '');
    const onnxAt = clean.lastIndexOf('/onnx/');
    if (onnxAt >= 0) return clean.slice(onnxAt + 1);
    if (clean.indexOf('onnx/') === 0) return clean;
    return clean.slice(clean.lastIndexOf('/') + 1);
}

function createOverallProgress(model) {
    const expected = MODEL_FILE_BYTES[model];
    const totalBytes = Object.values(expected).reduce((sum, bytes) => sum + bytes, 0);
    const completed = new Map();
    let lastPercent = 0;

    return function normalizedProgress(progress) {
        const file = normalizeFileName(progress && progress.file);
        const expectedBytes = expected[file] || 0;
        const loaded = Number(progress && progress.loaded) || 0;
        const total = Number(progress && progress.total) || 0;
        const explicit = Number(progress && progress.progress);
        const status = String(progress && progress.status || '');
        let fraction = Number.isFinite(explicit) ? explicit / 100 : (total > 0 ? loaded / total : null);

        if (status === 'done' || status === 'ready') fraction = 1;
        if (expectedBytes && fraction === null && loaded > 0) fraction = loaded / expectedBytes;
        if (expectedBytes && fraction !== null) {
            completed.set(file, Math.max(completed.get(file) || 0, Math.min(expectedBytes, expectedBytes * Math.max(0, fraction))));
        }

        const overallLoaded = Array.from(completed.values()).reduce((sum, bytes) => sum + bytes, 0);
        const calculated = Math.floor(overallLoaded / totalBytes * 100);
        lastPercent = Math.max(lastPercent, Math.min(99, calculated));
        return {
            file: file,
            status: status,
            loaded: loaded,
            total: total,
            percent: Number.isFinite(explicit) ? Math.max(0, Math.min(100, Math.round(explicit)))
                : (total > 0 ? Math.round(loaded / total * 100) : null),
            overallLoaded: Math.round(overallLoaded),
            overallTotal: totalBytes,
            overallPercent: lastPercent,
            phase: 'download',
            fromCache: status === 'done' && loaded === 0
        };
    };
}

async function loadModel(model) {
    if (transcriber && loadedModel === model) return;
    const modelId = MODEL_IDS[model];
    if (!modelId) throw new Error('unknown-whisper-model');

    const startedAt = Date.now();
    const overallProgress = createOverallProgress(model);
    self.postMessage({ type: 'progress', progress: { status: 'starting', model: model, loaded: 0, total: 0, percent: null } });
    transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'webgpu',
        dtype: MODEL_DTYPES[model],
        revision: MODEL_REVISIONS[model],
        progress_callback(progress) {
            self.postMessage({ type: 'progress', progress: overallProgress(progress) });
        }
    });
    loadedModel = model;
    self.postMessage({
        type: 'progress',
        progress: { status: 'initialized', phase: 'ready', model: model, loaded: 0, total: 0, percent: 100, overallPercent: 100, elapsedMs: Date.now() - startedAt }
    });
}

self.onmessage = async function (event) {
    const message = event.data || {};
    try {
        if (message.type === 'load') {
            await loadModel(message.model === 'tiny' ? 'tiny' : 'base');
            self.postMessage({ type: 'ready', model: loadedModel });
            return;
        }
        if (message.type === 'transcribe') {
            if (!transcriber) throw new Error('whisper-not-loaded');
            const audio = new Float32Array(message.audio || new ArrayBuffer(0));
            const output = await transcriber(audio, {
                language: 'persian',
                task: 'transcribe',
                return_timestamps: false,
                condition_on_prev_tokens: false,
                temperature: 0
            });
            self.postMessage({
                type: 'result',
                requestId: message.requestId,
                text: String(output && output.text || '').trim()
            });
        }
    } catch (error) {
        console.error('[WhisperASR] worker operation failed:', error);
        self.postMessage({
            type: 'error',
            requestId: message.requestId || 0,
            message: String(error && (error.stack || error.message) || error || 'whisper-error')
        });
    }
};
