import assert from 'node:assert/strict';
import { classifyMinerOutput, isTransientPoolNetworkError, shouldMarkMinerExited } from './miner-output.ts';

assert.equal(classifyMinerOutput('net new job from xmr.minebench.cloud:3333'), 'connected');
assert.equal(classifyMinerOutput('login succeeded'), 'connected');
assert.equal(classifyMinerOutput('login failed: invalid user'), 'auth-error');
assert.equal(classifyMinerOutput('randomx failed to allocate 1GB pages'), 'other');
assert.equal(classifyMinerOutput('read error: "end of file"'), 'other');
assert.equal(classifyMinerOutput('FATAL: access violation'), 'crash');
assert.equal(isTransientPoolNetworkError('net stratum+tcp://xmr.minebench.cloud:3333 read error: "connection reset by peer"'), true);
assert.equal(isTransientPoolNetworkError('net stratum+tcp://xmr.minebench.cloud:3333 read error: "end of file"'), true);
assert.equal(isTransientPoolNetworkError('randomx failed to allocate 1GB pages'), false);
assert.equal(shouldMarkMinerExited('starting', true), false);
assert.equal(shouldMarkMinerExited('running', true), false);
assert.equal(shouldMarkMinerExited('starting', false), true);
assert.equal(shouldMarkMinerExited('idle', false), false);

console.log('miner output classification tests passed');
