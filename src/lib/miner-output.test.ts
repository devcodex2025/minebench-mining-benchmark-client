import assert from 'node:assert/strict';
import {
    classifyMinerOutput,
    getAcceptedShareCount,
    getAcceptedShareCountFromOutput,
    getCpuHashrate,
    isTransientPoolNetworkError,
    shouldAutoStopBenchmark,
    shouldMarkMinerExited,
    shouldStartBenchmarkMeasurement,
} from './miner-output.ts';

assert.equal(classifyMinerOutput('net new job from xmr.minebench.cloud:3333'), 'connected');
assert.equal(classifyMinerOutput('login succeeded'), 'connected');
assert.equal(classifyMinerOutput('net      xmr.minebench.cloud:3333 connected'), 'connected');
assert.equal(classifyMinerOutput('login failed: invalid user'), 'auth-error');
assert.equal(classifyMinerOutput('randomx failed to allocate 1GB pages'), 'other');
assert.equal(classifyMinerOutput('read error: "end of file"'), 'other');
assert.equal(classifyMinerOutput('FATAL: access violation'), 'crash');
assert.equal(isTransientPoolNetworkError('net stratum+tcp://xmr.minebench.cloud:3333 read error: "connection reset by peer"'), true);
assert.equal(isTransientPoolNetworkError('net stratum+tcp://xmr.minebench.cloud:3333 read error: "end of file"'), true);
assert.equal(isTransientPoolNetworkError('randomx failed to allocate 1GB pages'), false);

// Regression: a dropped pool link must NOT be classified as 'connected'.
// "disconnected" contains the substring "connected".
assert.equal(
    classifyMinerOutput('net      xmr.minebench.cloud:3333 disconnected, restart in 5 seconds'),
    'disconnected',
);
assert.equal(classifyMinerOutput('DISCONNECTED'), 'disconnected');
assert.equal(classifyMinerOutput('connect error: "connection refused"'), 'disconnected');
assert.equal(classifyMinerOutput('no active pools, stopping mining'), 'disconnected');

assert.equal(shouldMarkMinerExited('starting', true), false);
assert.equal(shouldMarkMinerExited('running', true), false);
assert.equal(shouldMarkMinerExited('starting', false), true);
assert.equal(shouldMarkMinerExited('idle', false), false);
assert.equal(getAcceptedShareCount({ results: { shares_good: 1 } }), 1);
assert.equal(getAcceptedShareCount({ results: { accepted: 2 } }), 2);
assert.equal(getAcceptedShareCount({ connection: { accepted: 3 } }), 3);
assert.equal(getAcceptedShareCount({}), 0);
assert.equal(getAcceptedShareCountFromOutput('[2026-08-18] cpu accepted (1/0) diff 14027 (121 ms)'), 1);
assert.equal(getAcceptedShareCountFromOutput('cpu accepted (12/1) diff 14027'), 12);
assert.equal(getAcceptedShareCountFromOutput('net new job from pool'), null);
assert.equal(getCpuHashrate({ hashrate: { total: [2481.2, 2399.9, null] } }), 2481.2);
assert.equal(getCpuHashrate({ hashrate: { current: 900 } }), 900);
assert.equal(getCpuHashrate({ hashrate: 750 }), 750);
assert.equal(getCpuHashrate({ hashrate: { total: [null, null, null] } }), 0);
assert.equal(shouldStartBenchmarkMeasurement(0, false, false), false);
assert.equal(shouldStartBenchmarkMeasurement(1, false, false), true);
assert.equal(shouldStartBenchmarkMeasurement(1, true, false), false);
assert.equal(shouldStartBenchmarkMeasurement(1, false, true), false);
assert.equal(shouldAutoStopBenchmark(1, true, true, false), false);
assert.equal(shouldAutoStopBenchmark(0, true, true, false), true);
assert.equal(shouldAutoStopBenchmark(0, true, true, true), false);
assert.equal(shouldAutoStopBenchmark(0, true, false, false), false);

console.log('miner output classification tests passed');
