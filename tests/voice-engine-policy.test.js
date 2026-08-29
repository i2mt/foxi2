'use strict';

const assert = require('assert');
const policy = require('../voice-engine-policy.js');

assert.strictEqual(policy.choose({ mode: 'auto', hasWebGPU: true, deviceMemory: 8 }), 'whisper-base');
assert.strictEqual(policy.choose({ mode: 'auto', hasWebGPU: true, deviceMemory: 4 }), 'whisper-tiny');
assert.strictEqual(policy.choose({ mode: 'auto', hasWebGPU: true }), 'whisper-tiny');
assert.strictEqual(policy.choose({ mode: 'auto', hasWebGPU: true, deviceMemory: 8, lowPower: true }), 'rizeh');
assert.strictEqual(policy.choose({ mode: 'auto', hasWebGPU: false, deviceMemory: 8 }), 'rizeh');
assert.strictEqual(policy.choose({ mode: 'whisper-base', hasWebGPU: false }), 'rizeh');
assert.strictEqual(policy.choose({ mode: 'whisper-base', hasWebGPU: true, deviceMemory: 2 }), 'whisper-base');
assert.strictEqual(policy.choose({ mode: 'unexpected', hasWebGPU: true, deviceMemory: 8 }), 'whisper-base');

console.log('voice engine policy tests passed');
