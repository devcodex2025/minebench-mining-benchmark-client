import assert from 'node:assert/strict';
import test from 'node:test';

import { rollbackTargetsFrom, type ChannelPool } from './appUpdate.ts';

const poolOf = (
  versions: string[],
  revoked: { version: string; reason?: string }[] = [],
  killSwitch: ChannelPool['killSwitch'] = null
): ChannelPool => ({
  latest: versions[0] ?? null,
  versions: versions.map((version) => ({ version })),
  revoked,
  killSwitch,
});

test('rollback offers only older versions this channel still carries', () => {
  const pool = poolOf(['0.9.0', '0.8.49', '0.8.48']);
  assert.deepEqual(rollbackTargetsFrom(pool, '0.9.0'), ['0.8.49', '0.8.48'], 'newest first');
  assert.deepEqual(rollbackTargetsFrom(pool, '0.8.49'), ['0.8.48'], 'the running version is not a target');
  assert.deepEqual(rollbackTargetsFrom(pool, '0.8.48'), [], 'nothing older is offered');
});

test('nothing newer is ever a rollback target', () => {
  const pool = poolOf(['0.10.0', '0.9.1', '0.9.0']);
  assert.deepEqual(rollbackTargetsFrom(pool, '0.9.0'), [], 'a newer version is an update, not a rollback');
});

test('a revoked version cannot be a rollback target', () => {
  const pool = poolOf(['0.9.0', '0.8.49', '0.8.48'], [{ version: '0.8.49', reason: 'payout regression' }]);

  assert.deepEqual(rollbackTargetsFrom(pool, '0.9.0'), ['0.8.48']);
});

test('a kill switch holds back every version below it', () => {
  const pool = poolOf(['0.9.0', '0.8.49', '0.8.48'], [], {
    minVersion: '0.8.49',
    message: 'payout regression',
    block: true,
  });

  // The version the gate names is allowed; anything below it is not offered.
  assert.deepEqual(rollbackTargetsFrom(pool, '0.9.0'), ['0.8.49']);
});

test('prerelease channels compare by semantic version, not string order', () => {
  const pool = poolOf(['0.10.0-canary.2', '0.10.0-canary.1']);

  // 0.10.0-canary.1 < 0.10.0-canary.2 < 0.10.0, so a stable version is newer than
  // every candidate and has no rollback targets inside this pool.
  assert.deepEqual(rollbackTargetsFrom(pool, '0.10.0-canary.2'), ['0.10.0-canary.1']);
  assert.deepEqual(rollbackTargetsFrom(pool, '0.10.0'), []);
});
