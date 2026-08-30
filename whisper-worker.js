/* FoxiMed — dedicated WebGPU Whisper worker.
 * Pinned runtime/model IDs make production behavior repeatable. Model weights
 * use Transformers.js' browser cache and are never included in the app shell.
 */
import { env, pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

// Mobile connections can drop while Hugging Face redirects a model request
// to its large-file CDN. A single interrupted request used to abort the whole
// pipeline even though all files completed before it were already cached.
// Retry both the individual fetch and (for body-stream failures) the pipeline
// load so a brief connection interruption does not force an immediate engine
// fallback.
const FETCH_ATTEMPTS = 3;
const PIPELINE_ATTEMPTS = 2;
const nativeFetch = self.fetch.bind(self);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function describeAsset(input) {
    try {
        const raw = typeof input === 'string' ? input : input.url;
        const url = new URL(raw);
        const parts = url.pathname.split('/').filter(Boolean);
        const resolveAt = parts.indexOf('resolve');
        const file = resolveAt >= 0 ? parts.slice(resolveAt + 2).join('/') : parts.slice(-2).join('/');
        return { host: url.host, file: file || 'model asset' };
    } catch (_) {
        return { host: 'model host', file: 'model asset' };
    }
}

function isRetryableStatus(status) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isNetworkError(error) {
    const message = String(error && (error.message || error) || '');
    return (error && error.code === 'whisper-network-failed') || /network|failed to fetch|fetch failed|load failed|connection|err_network|ns_error_net/i.test(message);
}

env.fetch = async function retryingModelFetch(input, init) {
    const asset = describeAsset(input);
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            const response = await nativeFetch(input, init);
            if (!isRetryableStatus(response.status)) return response;
            if (attempt === FETCH_ATTEMPTS) {
                const statusError = new Error('whisper-network-failed: HTTP ' + response.status + ' for ' + asset.file);
                statusError.code = 'whisper-network-failed';
                throw statusError;
            }
        } catch (error) {
            if (attempt === FETCH_ATTEMPTS || !isNetworkError(error)) throw error;
        }

        const delayMs = attempt === 1 ? 1200 : 3500;
        console.warn('[WhisperASR] model connection interrupted; retrying:',
            'attempt=', (attempt + 1) + '/' + FETCH_ATTEMPTS,
            '| host=', asset.host,
            '| file=', asset.file);
        self.postMessage({
            type: 'progress',
            progress: {
                status: 'retrying-network',
                phase: 'download',
                attempt: attempt + 1,
                maxAttempts: FETCH_ATTEMPTS,
                delayMs: delayMs,
                host: asset.host,
                file: asset.file
            }
        });
        await sleep(delayMs);
    }
};

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
    let loadError = null;
    for (let attempt = 1; attempt <= PIPELINE_ATTEMPTS; attempt++) {
        try {
            transcriber = await pipeline('automatic-speech-recognition', modelId, {
                device: 'webgpu',
                dtype: MODEL_DTYPES[model],
                revision: MODEL_REVISIONS[model],
                progress_callback(progress) {
                    self.postMessage({ type: 'progress', progress: overallProgress(progress) });
                }
            });
            loadError = null;
            break;
        } catch (error) {
            loadError = error;
            if (attempt === PIPELINE_ATTEMPTS || !isNetworkError(error)) break;
            console.warn('[WhisperASR] model stream failed; resuming from browser cache:',
                'attempt=', (attempt + 1) + '/' + PIPELINE_ATTEMPTS,
                '| error=', String(error && (error.message || error) || error));
            self.postMessage({
                type: 'progress',
                progress: {
                    status: 'retrying-model-load',
                    phase: 'download',
                    attempt: attempt + 1,
                    maxAttempts: PIPELINE_ATTEMPTS,
                    delayMs: 2000
                }
            });
            await sleep(2000);
        }
    }
    if (loadError) {
        if (isNetworkError(loadError)) {
            const wrapped = new Error('whisper-network-failed: ' + String(loadError && (loadError.message || loadError) || loadError));
            wrapped.code = 'whisper-network-failed';
            throw wrapped;
        }
        throw loadError;
    }
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
            code: error && error.code ? error.code : '',
            message: String(error && (error.stack || error.message) || error || 'whisper-error')
        });
    }
};
