'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MockWorker {
    constructor(url, options) {
        this.url = url;
        this.options = options;
        this.terminated = false;
    }

    postMessage(message) {
        if (message.type === 'load') {
            if (MockWorker.failNextLoad) {
                MockWorker.failNextLoad = false;
                queueMicrotask(() => this.onmessage({
                    data: { type: 'error', requestId: 0, message: 'simulated-model-load-failure' }
                }));
                return;
            }
            queueMicrotask(() => this.onmessage({ data: { type: 'ready', model: message.model } }));
        } else if (message.type === 'transcribe') {
            const samples = new Float32Array(message.audio).length;
            queueMicrotask(() => this.onmessage({
                data: { type: 'result', requestId: message.requestId, text: samples ? 'محاسبه درصد سوختگی' : '' }
            }));
        }
    }

    terminate() { this.terminated = true; }
}

(async function () {
    const window = {};
    const navigator = {
        gpu: { requestAdapter: async () => ({ name: 'mock-adapter' }) }
    };
    const context = {
        window,
        navigator,
        Worker: MockWorker,
        AbortController,
        DOMException,
        Float32Array,
        ArrayBuffer,
        Map,
        Promise,
        Error,
        Number,
        Math,
        String,
        setTimeout,
        clearTimeout,
        queueMicrotask,
        console
    };
    vm.createContext(context);
    const source = fs.readFileSync(path.resolve(__dirname, '../whisper-asr.js'), 'utf8');
    vm.runInContext(source, context, { filename: 'whisper-asr.js' });

    const engine = await window.WhisperASR.load({ model: 'base' });
    assert.strictEqual(engine.executionProvider(), 'transformersjs-webgpu-whisper-base');

    const voice = new Float32Array(16000 * 0.25).fill(0.08);
    const silence = new Float32Array(16000);
    engine.feed(voice, 16000);
    engine.feed(silence, 16000);
    assert.strictEqual(engine.endpointDetected(), true, 'energy endpoint must stop after trailing silence');
    assert(engine.bufferedSeconds() >= 1.2, 'adapter must retain the captured utterance');
    assert.strictEqual(await engine.finalize(), 'محاسبه درصد سوختگی');
    engine.reset();
    assert.strictEqual(engine.bufferedSeconds(), 0, 'reset must retain the loaded model but clear audio');

    await engine.destroy();
    MockWorker.failNextLoad = true;
    await assert.rejects(
        window.WhisperASR.load({ model: 'tiny' }),
        /simulated-model-load-failure/,
        'a worker load error must reject immediately instead of waiting for the 15-minute timeout'
    );

    console.log('Whisper adapter tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
