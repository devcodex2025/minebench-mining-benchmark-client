import assert from 'node:assert/strict';
import { isNewerVersion, normalizeVersionLabel } from './appUpdate.ts';

assert.equal(normalizeVersionLabel('v0.8.26'), '0.8.26');
assert.equal(normalizeVersionLabel('  V1.2.3  '), '1.2.3');
assert.equal(isNewerVersion('v0.8.26', '0.8.25'), true);
assert.equal(isNewerVersion('0.8.25', 'v0.8.25'), false);

console.log('application update version normalization tests passed');
