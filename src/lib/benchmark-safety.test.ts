import assert from 'node:assert/strict';
import { getBenchmarkSafetyMode } from './benchmark-safety.ts';

const GIB = 1024 * 1024 * 1024;

const lowEndPc = getBenchmarkSafetyMode({ cores: 2, ramBytes: 4 * GIB });
assert.equal(lowEndPc.enabled, true);
assert.equal(lowEndPc.threads, 2, 'safe mode must use every logical CPU thread');

assert.equal(
    getBenchmarkSafetyMode({ cores: 2, ramBytes: 8 * GIB }).enabled,
    false,
    'low thread count alone must not enable safe mode'
);
assert.equal(
    getBenchmarkSafetyMode({ cores: 8, ramBytes: 4 * GIB }).enabled,
    false,
    'low memory alone must not enable safe mode'
);
assert.equal(
    getBenchmarkSafetyMode({ cores: 2, ramBytes: 0 }).enabled,
    false,
    'unknown memory must not enable safe mode'
);

console.log('benchmark-safety tests passed');
