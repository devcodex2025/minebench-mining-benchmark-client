import assert from 'node:assert/strict';
import { classifyMinerOutput, isTransientPoolNetworkError, shouldMarkMinerExited } from './miner-output.ts';

assert.equal(classifyMinerOutput('net new job from xmr.minebench.cloud:3333'), 'connected');
assert.equal(classifyMinerOutput('login succeeded'), 'connected');
assert.equal(classifyMinerOutput('net      xmr.minebench.cloud:3333 connected'), 'connected');
assert.equal(classifyMinerOutput('login failed: invalid user'), 'auth-error');
assert.equal(classifyMinerOutput('randomx failed to allocate 1GB pages'), 'other');
assert.equal(classifyMinerOutput('read error: "end of file"'), 'other');
assert.equal(classifyMinerOutput('FATAL: access violation'), 'crash');

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

console.log('miner output classification tests passed');
