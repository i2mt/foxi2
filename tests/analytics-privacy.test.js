'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'analytics.js'), 'utf8');
const storage = new Map([['appSettings', JSON.stringify({ anonymousAnalytics: true })]]);
const listeners = {};
const requests = [];
let sequence = 0;

const context = {
    console,
    Uint8Array,
    Set,
    Array,
    JSON,
    Math,
    Promise,
    clearTimeout: () => {},
    setTimeout: fn => { Promise.resolve().then(fn); return 1; },
    localStorage: {
        getItem: key => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: key => storage.delete(key)
    },
    navigator: {
        userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
        standalone: true,
        onLine: true,
        doNotTrack: '0'
    },
    document: {
        body: { dataset: { appVersion: '5.1.1' } },
        querySelector: selector => selector.includes('foximed-analytics-endpoint')
            ? { content: 'https://analytics.example.test/v1/events' }
            : null
    },
    fetch: async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return { ok: true };
    }
};

context.window = {
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}` },
    matchMedia: query => ({ matches: query.includes('standalone') }),
    addEventListener: (name, fn) => { listeners[name] = fn; }
};
context.crypto = context.window.crypto;
context.window.window = context.window;
context.window.navigator = context.navigator;
context.window.document = context.document;
context.window.localStorage = context.localStorage;
context.window.fetch = context.fetch;
context.window.setTimeout = context.setTimeout;
context.window.clearTimeout = context.clearTimeout;

vm.runInNewContext(source, context, { filename: 'analytics.js' });

(async () => {
    listeners.load();
    assert.strictEqual(context.window.FoxiAnalytics.trackFeature('bmi'), true);
    assert.strictEqual(context.window.FoxiAnalytics.trackFeature('patient-weight-70'), false, 'arbitrary feature names must be rejected');
    await new Promise(resolve => setImmediate(resolve));
    await context.window.FoxiAnalytics.flush();

    const events = requests.flatMap(request => request.body.events);
    assert(events.some(event => event.event === 'launch'));
    assert(events.some(event => event.event === 'pwa_first_seen'));
    assert(events.some(event => event.feature === 'bmi'));

    const allowedKeys = ['id', 'visitor_id', 'session_id', 'event', 'feature', 'app_version', 'display_mode', 'platform', 'browser', 'online'];
    events.forEach(event => {
        assert.deepStrictEqual(Object.keys(event).sort(), allowedKeys.sort());
        assert(!JSON.stringify(event).includes('patient-weight'));
    });

    context.window.FoxiAnalytics.setEnabled(false);
    assert.strictEqual(storage.has('foximed_analytics_visitor_v1'), false);
    assert.strictEqual(storage.has('foximed_analytics_queue_v1'), false);
    console.log('Analytics privacy tests passed.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

