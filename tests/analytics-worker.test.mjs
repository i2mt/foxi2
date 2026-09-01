import assert from 'node:assert/strict';
import worker from '../analytics-worker/worker.mjs';

const boundStatements = [];
const env = {
    ALLOWED_ORIGINS: 'https://app.example.test',
    ADMIN_TOKEN: 'a-very-long-owner-password',
    DB: {
        prepare(sql) {
            return {
                bind(...params) {
                    boundStatements.push({ sql, params });
                    return this;
                }
            };
        },
        async batch(statements) { return statements.map(() => ({ success: true })); }
    }
};

function event(overrides = {}) {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        visitor_id: '00000000-0000-4000-8000-000000000002',
        session_id: '00000000-0000-4000-8000-000000000003',
        event: 'feature_used',
        feature: 'bmi',
        app_version: '5.1.1',
        display_mode: 'standalone',
        platform: 'ios',
        browser: 'safari',
        online: true,
        ...overrides
    };
}

const preflight = await worker.fetch(new Request('https://stats.example.test/v1/events', {
    method: 'OPTIONS', headers: { Origin: 'https://app.example.test' }
}), env);
assert.equal(preflight.status, 204);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://app.example.test');

const rejectedOrigin = await worker.fetch(new Request('https://stats.example.test/v1/events', {
    method: 'POST', headers: { Origin: 'https://evil.example.test' }, body: JSON.stringify({ events: [event()] })
}), env);
assert.equal(rejectedOrigin.status, 403);

const rejectedField = await worker.fetch(new Request('https://stats.example.test/v1/events', {
    method: 'POST', headers: { Origin: 'https://app.example.test' },
    body: JSON.stringify({ events: [event({ feature: 'patient-weight-70' })] })
}), env);
assert.equal(rejectedField.status, 400);

const acceptedRequest = new Request('https://stats.example.test/v1/events', {
    method: 'POST', headers: { Origin: 'https://app.example.test' },
    body: JSON.stringify({ events: [event()] })
});
acceptedRequest.cf = { country: 'IR' };
const accepted = await worker.fetch(acceptedRequest, env);
assert.equal(accepted.status, 202);
assert.equal(boundStatements.length, 1);
assert(boundStatements[0].params.includes('bmi'));
assert(!JSON.stringify(boundStatements[0].params).includes('patient-weight'));

const unauthorized = await worker.fetch(new Request('https://stats.example.test/v1/stats'), env);
assert.equal(unauthorized.status, 401);

const dashboard = await worker.fetch(new Request('https://stats.example.test/dashboard'), env);
assert.equal(dashboard.status, 200);
assert((await dashboard.text()).includes('داشبورد آمار FoxiMed'));

console.log('Analytics Worker tests passed.');
