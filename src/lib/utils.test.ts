import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore Node's native TypeScript loader requires the explicit extension.
import { formatHashrate } from './utils.ts';

test('formatHashrate uses canonical SI units and boundaries', () => {
  assert.equal(formatHashrate(0), '0.00 H/s');
  assert.equal(formatHashrate(Number.NaN), '0.00 H/s');
  assert.equal(formatHashrate(-1), '0.00 H/s');
  assert.equal(formatHashrate(999), '999.00 H/s');
  assert.equal(formatHashrate(1000), '1.00 kH/s');
  assert.equal(formatHashrate(1_000_000), '1.00 MH/s');
  assert.equal(formatHashrate(1_000_000_000), '1.00 GH/s');
  assert.equal(formatHashrate(1_000_000_000_000), '1.00 TH/s');
});
