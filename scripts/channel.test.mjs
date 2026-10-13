import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  LEGACY_MANIFEST_NAME,
  applyKillSwitch,
  artifactsOf,
  assertChannelVersion,
  channelForRef,
  clearKillSwitch,
  collectPublishable,
  compareVersions,
  deleteList,
  emptyState,
  killSwitchFor,
  latestFileName,
  nextNightlyVersion,
  planRender,
  poolFileName,
  prunePools,
  publish,
  removeFiles,
  resolveBuild,
  revoke,
  writePlan,
} from './channel.mjs';

const manifestFor = (version, targets = ['windows-x86_64', 'linux-x86_64']) => ({
  version,
  notes: `MineBench Client v${version}`,
  pub_date: '2026-10-12T00:00:00Z',
  platforms: Object.fromEntries(
    targets.map((target) => [
      target,
      {
        signature: `sig-${target}`,
        url: `https://bitbucket.org/minebenchapp/minebench-client/downloads/mbc-${version}-${target}.exe`,
      },
    ])
  ),
});

const entryFor = (channel, version) => {
  const manifest = manifestFor(version);
  return {
    version,
    publishedAt: manifest.pub_date,
    commit: null,
    by: null,
    notes: manifest.notes,
    artifacts: artifactsOf(manifest),
    manifest,
  };
};

const stateWith = (channel, versions) => {
  const base = emptyState();
  return {
    ...base,
    channels: { ...base.channels, [channel]: versions.map((version) => entryFor(channel, version)) },
  };
};

test('semver precedence follows the specification', () => {
  assert.equal(compareVersions('0.9.0', '0.9.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.9.0-canary.2', '0.9.0-canary.10'), -1);
  assert.equal(compareVersions('0.9.0-canary.1', '0.9.0'), -1);
  assert.equal(compareVersions('0.9.0-nightly.20261012.1', '0.9.0-nightly.20261011.1'), 1);
  assert.equal(compareVersions('0.9.0+build.7', '0.9.0'), 0, 'build metadata is ignored');
  assert.equal(compareVersions('0.9.0-canary', '0.9.0-canary.1'), -1);
});

test('a version must match its channel shape', () => {
  assert.doesNotThrow(() => assertChannelVersion('stable', '0.9.0'));
  assert.doesNotThrow(() => assertChannelVersion('canary', '0.9.0-canary.3'));
  assert.doesNotThrow(() => assertChannelVersion('nightly', '0.9.0-nightly.20261012.1'));

  assert.throws(() => assertChannelVersion('stable', '0.9.0-canary.3'));
  assert.throws(() => assertChannelVersion('canary', '0.9.0'));
  assert.throws(() => assertChannelVersion('nightly', '0.9.0-nightly.2026-10-12.1'));
});

test('the stable pool keeps the three newest versions', () => {
  const pruned = prunePools(stateWith('stable', ['0.9.0', '0.8.49', '0.8.48', '0.8.47']));

  assert.deepEqual(
    pruned.state.channels.stable.map((entry) => entry.version),
    ['0.9.0', '0.8.49', '0.8.48']
  );
  assert.deepEqual(pruned.removed.map(({ entry }) => entry.version), ['0.8.47']);
});

test('publishing a stable release retires the candidates it supersedes', () => {
  const base = emptyState();
  const state = {
    ...base,
    channels: {
      nightly: [],
      canary: [
        entryFor('canary', '0.9.0-canary.2'),
        entryFor('canary', '0.9.0-canary.1'),
        entryFor('canary', '0.10.0-canary.1'),
      ],
      stable: [entryFor('stable', '0.9.0')],
    },
  };

  const pruned = prunePools(state);
  assert.deepEqual(
    pruned.state.channels.canary.map((entry) => entry.version),
    ['0.10.0-canary.1']
  );
  assert.deepEqual(
    pruned.removed.map(({ entry }) => entry.version).sort(),
    ['0.9.0-canary.1', '0.9.0-canary.2']
  );
});

test('the nightly pool keeps only the newest build', () => {
  const pruned = prunePools(
    stateWith('nightly', ['0.10.0-nightly.20261012.1', '0.10.0-nightly.20261011.1'])
  );

  assert.deepEqual(
    pruned.state.channels.nightly.map((entry) => entry.version),
    ['0.10.0-nightly.20261012.1']
  );
  assert.deepEqual(pruned.removed.map(({ entry }) => entry.version), ['0.10.0-nightly.20261011.1']);
});

test('a revoked version leaves its pool and its files are reported for deletion', () => {
  const pruned = revoke(stateWith('stable', ['0.9.0', '0.8.49']), {
    version: '0.8.49',
    channel: 'stable',
    reason: 'payout regression',
    by: 'admin',
  });

  assert.deepEqual(pruned.state.channels.stable.map((entry) => entry.version), ['0.9.0']);
  assert.equal(pruned.state.revoked[0].reason, 'payout regression');

  const doomed = deleteList(pruned.removed);
  assert.ok(doomed.includes('manifest-stable-0.8.49.json'));
  assert.ok(doomed.includes('mbc-0.8.49-windows-x86_64.exe'));
  assert.ok(doomed.includes('mbc-0.8.49-windows-x86_64.exe.sig'));
});

test('revoking requires a reason', () => {
  assert.throws(() => revoke(stateWith('stable', ['0.9.0']), { version: '0.9.0' }), /reason/);
});

test('rendered manifests point every channel at its own pool', () => {
  const base = emptyState();
  const state = {
    ...base,
    channels: {
      nightly: [entryFor('nightly', '0.10.0-nightly.20261012.1')],
      canary: [entryFor('canary', '0.10.0-canary.1')],
      stable: [entryFor('stable', '0.9.0'), entryFor('stable', '0.8.49')],
    },
  };

  const files = planRender(state).files;

  // The endpoint every pre-0.9 client is compiled with must stay on stable.
  assert.equal(files.get(LEGACY_MANIFEST_NAME).version, '0.9.0');
  assert.equal(files.get(latestFileName('stable')).version, '0.9.0');
  assert.equal(files.get(latestFileName('canary')).version, '0.10.0-canary.1');
  assert.equal(files.get('manifest-canary-0.10.0-canary.1.json').version, '0.10.0-canary.1');

  const canaryPool = files.get(poolFileName('canary'));
  assert.equal(canaryPool.schemaVersion, 1);
  assert.equal(canaryPool.latest, '0.10.0-canary.1');
  assert.deepEqual(canaryPool.versions.map((version) => version.version), ['0.10.0-canary.1']);
  assert.deepEqual(canaryPool.revoked, []);

  const stablePool = files.get(poolFileName('stable'));
  assert.deepEqual(stablePool.versions.map((version) => version.version), ['0.9.0', '0.8.49']);
  assert.equal(stablePool.versions[0].manifest, 'manifest-stable-0.9.0.json');
});

test('writePlan writes every rendered file next to each other', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-channel-'));
  try {
    const written = writePlan(planRender(stateWith('stable', ['0.9.0'])), out);
    assert.ok(written.includes(LEGACY_MANIFEST_NAME));

    const legacy = JSON.parse(fs.readFileSync(path.join(out, LEGACY_MANIFEST_NAME), 'utf8'));
    const stableLatest = JSON.parse(
      fs.readFileSync(path.join(out, latestFileName('stable')), 'utf8')
    );
    assert.equal(legacy.version, stableLatest.version);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('removeFiles drops what must not be published again', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-channel-remove-'));
  try {
    fs.writeFileSync(path.join(out, 'manifest-canary-0.9.0-canary.1.json'), '{}');
    fs.writeFileSync(path.join(out, 'canary-latest.json'), '{}');

    const removed = removeFiles(out, ['manifest-canary-0.9.0-canary.1.json', 'absent.json']);

    assert.deepEqual(removed, ['manifest-canary-0.9.0-canary.1.json']);
    assert.ok(!fs.existsSync(path.join(out, 'manifest-canary-0.9.0-canary.1.json')));
    assert.ok(fs.existsSync(path.join(out, 'canary-latest.json')));
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('an empty pool leaves no pointer behind', () => {
  const files = planRender(emptyState()).files;

  assert.ok(!files.has(LEGACY_MANIFEST_NAME));
  assert.deepEqual([...planRender(emptyState()).obsolete].sort(), [
    'canary-latest.json',
    'latest.json',
    'nightly-latest.json',
    'stable-latest.json',
  ]);
});

test('a CI ref names the channel it may build', () => {
  assert.equal(channelForRef({ branch: 'main' }), 'nightly');
  assert.equal(channelForRef({ tag: 'v0.9.0-canary.3' }), 'canary');
  assert.equal(channelForRef({ tag: 'v0.9.0' }), 'stable');
  assert.equal(channelForRef({ tag: 'v0.9.0-nightly.20261012.1' }), 'nightly');

  assert.throws(() => channelForRef({ tag: 'v0.9.0-rc.1' }), /does not match any channel/);
  assert.throws(() => channelForRef({ branch: 'feature/x' }), /cannot tell the channel/);
});

test('the next nightly stays ahead of stable and counts within a day', () => {
  const base = emptyState();
  const withStable = {
    ...base,
    channels: { ...base.channels, stable: [entryFor('stable', '0.9.0')] },
  };

  assert.equal(nextNightlyVersion(withStable, { date: '20261012' }), '0.9.1-nightly.20261012.1');

  const withNightly = {
    ...withStable,
    channels: {
      ...withStable.channels,
      nightly: [entryFor('nightly', '0.9.1-nightly.20261012.1')],
    },
  };
  assert.equal(nextNightlyVersion(withNightly, { date: '20261012' }), '0.9.1-nightly.20261012.2');
  assert.equal(nextNightlyVersion(withNightly, { date: '20261013' }), '0.9.1-nightly.20261013.1');

  assert.throws(() => nextNightlyVersion(emptyState()), /no stable or nightly version/);
  assert.equal(
    nextNightlyVersion(emptyState(), { date: '20261012', fallback: '0.8.49' }),
    '0.8.50-nightly.20261012.1'
  );
});

test('resolveBuild reads the ref, honours overrides and validates the result', () => {
  const base = emptyState();
  const withStable = {
    ...base,
    channels: { ...base.channels, stable: [entryFor('stable', '0.9.0')] },
  };

  assert.deepEqual(resolveBuild({ BITBUCKET_TAG: 'v0.9.1-canary.1' }, base), {
    channel: 'canary',
    version: '0.9.1-canary.1',
  });
  assert.deepEqual(resolveBuild({ BITBUCKET_BRANCH: 'main', MINEBENCH_DATE: '20261012' }, withStable), {
    channel: 'nightly',
    version: '0.9.1-nightly.20261012.1',
  });
  assert.deepEqual(
    resolveBuild({ MINEBENCH_CHANNEL: 'stable', MINEBENCH_VERSION: 'v0.9.1' }, withStable),
    { channel: 'stable', version: '0.9.1' }
  );

  // A manual run cannot publish a release candidate as stable.
  assert.throws(
    () => resolveBuild({ MINEBENCH_CHANNEL: 'stable', MINEBENCH_VERSION: '0.9.1-canary.2' }, withStable),
    /not a valid stable version/
  );
});

test('a kill switch gates old versions without removing them from the pool', () => {
  const state = stateWith('stable', ['0.9.0', '0.8.49']);

  const armed = applyKillSwitch(state, {
    channel: 'stable',
    minVersion: '0.9.0',
    message: 'payout regression',
    block: true,
    by: 'admin',
  });

  // Clearing a kill switch has to re-enable the versions it gated, so they stay
  // in the pool: unlike a revocation, this is temporary.
  assert.deepEqual(
    armed.channels.stable.map((entry) => entry.version),
    ['0.9.0', '0.8.49']
  );
  assert.equal(killSwitchFor(armed, 'stable').minVersion, '0.9.0');

  const files = planRender(armed).files;
  assert.deepEqual(files.get(poolFileName('stable')).killSwitch, {
    minVersion: '0.9.0',
    message: 'payout regression',
    block: true,
  });
  assert.equal(files.get(poolFileName('canary')).killSwitch, null, 'other channels are unaffected');

  const cleared = clearKillSwitch(armed, { channel: 'stable' });
  assert.equal(killSwitchFor(cleared, 'stable'), null);
  assert.equal(planRender(cleared).files.get(poolFileName('stable')).killSwitch, null);
});

test('a kill switch must name a version of its own channel', () => {
  assert.throws(
    () => applyKillSwitch(emptyState(), { channel: 'stable', minVersion: '0.9.0-canary.1' }),
    /not a valid stable version/
  );
  assert.throws(
    () => applyKillSwitch(emptyState(), { channel: 'beta', minVersion: '0.9.0' }),
    /unknown channel/
  );
});

test('the publish set keeps the collected installers and drops what left a pool', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-publish-'));

  try {
    // The build steps collected the installers before the channel tooling ran, and
    // the directory may still hold something an earlier run left behind.
    fs.writeFileSync(path.join(out, 'mbc-0.9.0-canary.1-canary-windows-x86_64.exe'), 'installer');
    fs.writeFileSync(path.join(out, 'mbc-0.9.0-canary.1-canary-linux-x86_64.AppImage'), 'appimage');
    fs.writeFileSync(path.join(out, 'manifest-canary-0.9.0-canary.1.json'), '{}');
    fs.writeFileSync(path.join(out, 'manifest-canary-0.9.0-canary.0.json'), '{}');

    const publishable = collectPublishable(
      out,
      ['canary-latest.json', 'canary-versions.json'],
      ['manifest-canary-0.9.0-canary.0.json']
    );

    assert.ok(
      publishable.includes('mbc-0.9.0-canary.1-canary-windows-x86_64.exe'),
      'the installers are what clients download: they must be published'
    );
    assert.ok(publishable.includes('canary-latest.json'), 'rendered pointers are published');
    assert.ok(!publishable.includes('manifest-canary-0.9.0-canary.0.json'), 'a removed version is never uploaded');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('publish enforces the channel and manifest version', () => {
  const manifest = manifestFor('0.10.0-canary.1');

  assert.throws(
    () => publish(emptyState(), { channel: 'stable', version: '0.10.0-canary.1', manifest }),
    /not a valid stable version/
  );
  assert.throws(
    () => publish(emptyState(), { channel: 'canary', version: '0.10.0-canary.2', manifest }),
    /does not match/
  );

  const result = publish(emptyState(), {
    channel: 'canary',
    version: '0.10.0-canary.1',
    manifest,
    commit: 'abc1234',
  });
  assert.deepEqual(result.state.channels.canary.map((entry) => entry.version), ['0.10.0-canary.1']);
  assert.equal(result.state.channels.canary[0].commit, 'abc1234');
  assert.deepEqual(result.state.channels.canary[0].artifacts, [
    'mbc-0.10.0-canary.1-linux-x86_64.exe',
    'mbc-0.10.0-canary.1-windows-x86_64.exe',
  ]);
});
