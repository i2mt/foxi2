'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function read(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function makeStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); }
    };
}

function toLatinDigits(value) {
    const fa = '۰۱۲۳۴۵۶۷۸۹';
    const ar = '٠١٢٣٤٥٦٧٨٩';
    return String(value || '')
        .replace(/[۰-۹]/g, c => String(fa.indexOf(c)))
        .replace(/[٠-٩]/g, c => String(ar.indexOf(c)));
}

function testCommandRouting() {
    const events = [];
    const storage = makeStorage();
    const window = {
        VoiceUI: {
            showResult(message, type) {
                events.push({ kind: 'result', message, type });
            },
            showConfirmation(message, onConfirm, onCancel) {
                events.push({ kind: 'confirmation', message, onConfirm, onCancel });
            },
            appendTip() {}
        }
    };

    const drugDatabase = {
        heparin: {
            persianName: 'هپارین',
            englishName: 'Heparin',
            alternativeNames: ['هپارین سدیم']
        },
        vancomycin: {
            persianName: 'وانکومایسین',
            englishName: 'Vancomycin',
            alternativeNames: []
        }
    };

    const context = {
        window,
        console,
        Set,
        Map,
        Date,
        Math,
        JSON,
        RegExp,
        localStorage: storage,
        PersianNumbers: { toLatin: toLatinDigits },
        drugDatabase,
        AppState: { settings: {} },
        saveSettings() {},
        applyThemeMode() {},
        applySettings() {},
        switchTab(tab) { events.push({ kind: 'tab', tab }); },
        setTimeout,
        clearTimeout
    };
    window.window = window;
    window.drugDatabase = drugDatabase;
    vm.createContext(context);
    vm.runInContext(read('voice-commands.js'), context, { filename: 'voice-commands.js' });

    function run(phrase) {
        events.length = 0;
        window.VoiceCommands.process(phrase);
        return events.slice();
    }

    let result = run('بی‌ام‌آی وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'BMI should require confirmation');

    result = run('بي ام آي وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BMI')),
        'Arabic/Persian letter variants should normalize');

    result = run('قطره ۵۰۰ ml در ۸ ساعت');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('سرعت قطره')),
        'drip calculation should require confirmation');

    result = run('هپارین ۱۲ units وزن ۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('دارو و دوز')),
        'drug dose should require confirmation');

    result = run('سطح بدن وزن ۷۰ قد ۱۷۰');
    assert(result.some(e => e.kind === 'confirmation' && e.message.includes('BSA')),
        'explicit BSA should route to BSA');

    result = run('وزن ۷۰ قد ۱۷۰');
    assert(!result.some(e => e.kind === 'confirmation'),
        'ambiguous BMI/BSA input must not execute');
    assert(result.some(e => e.kind === 'result' && e.message.includes('BMI یا BSA')),
        'ambiguous body measurement should ask for clarification');

    result = run('ساعت ۸');
    assert(!result.some(e => e.kind === 'confirmation'),
        'generic time word must not route to drip');

    result = run('به ۲۰');
    assert(!result.some(e => e.kind === 'confirmation'),
        'generic Persian preposition must not route to conversion');

    result = run('دارو');
    assert(result.some(e => e.kind === 'tab' && e.tab === 'drugs'),
        'safe drug-library navigation should run without confirmation');
}

function testDeploymentWiring() {
    const workflow = read('.github/workflows/pages-sherpa-koochik.yml');
    const serviceWorker = read('service-worker.js');
    const index = read('index.html');
    const script = read('script.js');
    const voiceEngine = read('voice-recognition.js');
    const voiceUi = read('voice-ui.js');

    assert(workflow.includes('shenava-rizeh-v1.0-non-streaming-int8'),
        'deployment workflow must download Rizeh');
    assert(!workflow.includes('shenava-koochik-v1.0-non-streaming-int8'),
        'deployment workflow must not download the old Koochik model');
    assert(workflow.includes('f2b9251cc3ceb177bc5e55ddd4114536c3bb61d3'),
        'deployment workflow must pin the reviewed Rizeh revision');
    assert(workflow.includes('RIZEH_MODEL_SHA256') && workflow.includes('sha256sum --check --strict'),
        'deployment workflow must verify the Rizeh payload');
    assert(workflow.includes('WASM_INITIAL_MEMORY_MB: "256"'),
        'mobile build must not reserve sherpa-onnx default 512 MB at startup');
    assert(workflow.includes("--exclude 'icons/vosk-model-small-fa-0.5.tar.gz'"),
        'the obsolete Vosk archive must not be shipped in the Pages site');
    assert(serviceWorker.includes('FoxiMed_Model_Rizeh_v1_nonstreaming_int8_f2b9251'),
        'service worker must use a cache namespace tied to the pinned Rizeh revision');
    assert(serviceWorker.includes('koochik-worker.js?v=29'),
        'service worker must precache the v29 worker URL');
    assert(index.includes('service-worker.js?v=29'),
        'page must register the v29 service worker');
    assert(!script.includes('VoiceEngine.releaseModel'),
        'tab changes must keep the loaded voice model warm');
    assert(voiceEngine.includes('onlineFallbackAvailable: true') && voiceEngine.includes('startOnline: startOnline'),
        'offline failures must expose an explicit online retry');
    assert(voiceUi.includes('صدا برای تشخیص به سرویس مرورگر فرستاده می‌شود'),
        'online retry must disclose that speech leaves the device');
}

function makeWorkerLogicContext() {
    const context = {
        self: { postMessage() {} },
        console,
        performance: { now: () => 0 },
        Float32Array,
        Array,
        Number,
        Math,
        String,
        Promise,
        Error,
        Date
    };
    vm.createContext(context);
    vm.runInContext(read('koochik-worker.js'), context, { filename: 'koochik-worker.js' });
    return context;
}

function testWorkerSegmentationAndFrames() {
    const context = makeWorkerLogicContext();

    let detected = vm.runInContext(
        'resetSession();\n' +
        'capturedSamples = 640;\n' +
        'totalSeconds = 0.04;\n' +
        'processEnergy(new Float32Array(640).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, false, 'two 20 ms frames are not enough to start speech');

    detected = vm.runInContext(
        'capturedSamples = 1280;\n' +
        'totalSeconds = 0.08;\n' +
        'processEnergy(new Float32Array(640).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, true, 'four 20 ms frames should start speech');

    detected = vm.runInContext(
        'resetSession();\n' +
        'capturedSamples = 1280;\n' +
        'totalSeconds = 0.08;\n' +
        'processEnergy(new Float32Array(1280).fill(0.04), {' +
        'sileroActiveNow: false, segmentReady: false});\n' +
        'energySpeechDetected;',
        context
    );
    assert.strictEqual(detected, true,
        'speech start must be invariant to browser callback chunking');

    const selection = vm.runInContext(
        'resetSession();\n' +
        'detectedSegments = [new Float32Array(3200).fill(0.02)];\n' +
        'speechDetected = true;\n' +
        'var chosenForTest = chooseDecodePcm(new Float32Array(12000).fill(0.01));\n' +
        '({ source: chosenForTest.source, length: chosenForTest.pcm.length });',
        context
    );
    assert.strictEqual(selection.source, 'silero-segments',
        'final decoding should use the retained Silero segment');
    assert.strictEqual(selection.length, 3200,
        'the retained segment should not be replaced by the full capture');
}

async function testWorkerLifecycle() {
    const workers = [];

    class FakeWorker {
        constructor(url) {
            this.url = url;
            this.terminated = false;
            workers.push(this);
        }
        postMessage(message) {
            if (message.type === 'init') {
                queueMicrotask(() => {
                    if (!this.terminated && this.onmessage) {
                        this.onmessage({ data: { type: 'ready', build: 'test' } });
                    }
                });
            }
            if (message.type === 'reset') {
                queueMicrotask(() => {
                    if (!this.terminated && this.onmessage) {
                        this.onmessage({ data: { type: 'reset-done', requestId: message.requestId } });
                    }
                });
            }
        }
        terminate() {
            this.terminated = true;
        }
    }

    const window = { location: { href: 'https://example.test/index.html' } };
    const context = {
        window,
        navigator: {},
        Worker: FakeWorker,
        URL,
        DOMException,
        console,
        Map,
        Promise,
        Error,
        Float32Array,
        Date,
        queueMicrotask
    };
    vm.createContext(context);
    vm.runInContext(read('koochik-asr.js'), context, { filename: 'koochik-asr.js' });

    const first = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 1, 'first load should create one worker');
    await first.destroy();
    assert.strictEqual(workers[0].terminated, true,
        'destroy should terminate the Emscripten worker');

    const second = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 2,
        'load after destroy should create a fresh worker');
    assert.notStrictEqual(workers[0], workers[1]);

    workers[1].onerror({ message: 'simulated crash' });
    await assert.rejects(second.finalize(), /simulated crash/,
        'a worker crash should surface to the active engine');

    const third = await window.KoochikASR.load({ baseUrl: './sherpa-koochik/' });
    assert.strictEqual(workers.length, 3,
        'load after a worker crash should create a fresh worker');
    await third.destroy();
}

(async function main() {
    testCommandRouting();
    testDeploymentWiring();
    testWorkerSegmentationAndFrames();
    await testWorkerLifecycle();
    console.log('voice pipeline smoke tests: PASS');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
