import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SBOM_SPEC_VERSION,
  buildSbom,
  componentsFromCargoMetadata,
  componentsFromLockfile,
} from './generate-sbom.mjs';

const lock = {
  lockfileVersion: 3,
  packages: {
    '': { name: 'MineBench-Client', version: '0.9.0' },
    'node_modules/react': { version: '18.3.1' },
    'node_modules/@tauri-apps/api': { version: '2.11.0' },
    'node_modules/vite': { version: '7.1.7', dev: true },
    'node_modules/fsevents': { version: '2.3.3', optional: true },
  },
};

const metadata = {
  packages: [
    // Our own workspace crates have no source: they are in the root component.
    { name: 'app', version: '0.1.0', source: null },
    { name: 'serde', version: '1.0.228', source: 'registry+https://github.com/rust-lang/crates.io-index' },
    { name: 'semver', version: '1.0.28', source: 'registry+https://github.com/rust-lang/crates.io-index' },
  ],
};

test('the lock file describes the npm side, dev dependencies marked as excluded', () => {
  const components = componentsFromLockfile(lock);

  assert.deepEqual(
    components.map(({ purl, scope }) => [purl, scope]),
    [
      ['pkg:npm/react@18.3.1', 'required'],
      ['pkg:npm/@tauri-apps/api@2.11.0', 'required'],
      ['pkg:npm/vite@7.1.7', 'excluded'],
      ['pkg:npm/fsevents@2.3.3', 'optional'],
    ]
  );
  assert.ok(
    !components.some(({ name }) => name === 'MineBench-Client'),
    'the project itself is the root component, not a dependency'
  );
});

test('cargo metadata contributes registry crates and skips the workspace', () => {
  assert.deepEqual(
    componentsFromCargoMetadata(metadata).map(({ purl }) => purl),
    ['pkg:cargo/serde@1.0.228', 'pkg:cargo/semver@1.0.28']
  );
});

test('the document is deterministic and identifies the release', () => {
  const first = buildSbom({ lock, metadata, version: '0.9.0' });
  const second = buildSbom({
    // Same content, different order: the document must not depend on it.
    lock: { packages: Object.fromEntries(Object.entries(lock.packages).reverse()) },
    metadata: { packages: [...metadata.packages].reverse() },
    version: '0.9.0',
  });

  assert.equal(first.bomFormat, 'CycloneDX');
  assert.equal(first.specVersion, SBOM_SPEC_VERSION);
  assert.deepEqual(first.metadata.component, {
    type: 'application',
    name: 'MineBench Client',
    version: '0.9.0',
  });
  assert.deepEqual(first, second, 'the same input must produce the same document');
  assert.deepEqual(
    first.components.map(({ purl }) => purl),
    [...first.components.map(({ purl }) => purl)].sort(),
    'components are sorted'
  );
  assert.ok(!JSON.stringify(first).includes('serialNumber'), 'no random ids: the file must be diffable');
});

test('an identical purl from both sides is listed once', () => {
  const duplicate = {
    packages: [{ name: 'shared', version: '1.0.0', source: 'registry+https://example.test/index' }],
  };
  const sbom = buildSbom({
    lock: { packages: { 'node_modules/shared': { version: '1.0.0' } } },
    metadata: duplicate,
    version: '0.9.0',
  });

  const purls = sbom.components.map(({ purl }) => purl);
  assert.equal(new Set(purls).size, purls.length, 'no duplicate purls');
});
