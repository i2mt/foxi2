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

let transcriber = null;
let loadedModel = '';

function normalizedProgress(progress) {
    const loaded = Number(progress && progress.loaded) || 0;
    const total = Number(progress && progress.total) || 0;
    const explicit = Number(progress && progress.progress);
    return {
        file: String(progress && progress.file || ''),
        status: String(progress && progress.status || ''),
        loaded: loaded,
        total: total,
        percent: Number.isFinite(explicit) ? Math.max(0, Math.min(100, Math.round(explicit)))
            : (total > 0 ? Math.round(loaded / total * 100) : null),
        fromCache: progress && progress.status === 'done' && loaded === 0
    };
}

async function loadModel(model) {
    if (transcriber && loadedModel === model) return;
    const modelId = MODEL_IDS[model];
    if (!modelId) throw new Error('unknown-whisper-model');

    transcriber = await pipeline('automatic-speech-recognition', modelId, {
        device: 'webgpu',
        dtype: {
            encoder_model: 'fp32',
            decoder_model_merged: 'q4'
        },
        progress_callback(progress) {
            self.postMessage({ type: 'progress', progress: normalizedProgress(progress) });
        }
    });
    loadedModel = model;
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
        self.postMessage({
            type: 'error',
            requestId: message.requestId || 0,
            message: String(error && (error.stack || error.message) || error || 'whisper-error')
        });
    }
};
