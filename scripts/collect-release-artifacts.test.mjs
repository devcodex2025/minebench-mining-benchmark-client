import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  artifactName,
  collectReleaseArtifacts,
  findArtifacts,
  main,
} from './collect-release-artifacts.mjs';

const makeBundle = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-bundle-'));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return root;
};

test('artifact names carry no spaces and keep the extension', () => {
  assert.equal(
    artifactName({
      version: '0.9.0-canary.3',
      channel: 'canary',
      target: 'windows',
      arch: 'x86_64',
      suffix: '.exe.sig',
    }),
    'mbc-0.9.0-canary.3-canary-windows-x86_64.exe.sig'
  );
});

test('linux bundles collect the installers and their signatures only', () => {
  const root = makeBundle({
    'appimage/MineBench Client_0.9.0_amd64.AppImage': 'appimage',
    'appimage/MineBench Client_0.9.0_amd64.AppImage.sig': 'sig',
    'deb/MineBench Client_0.9.0_amd64.deb': 'deb',
    'rpm/MineBench Client-0.9.0.x86_64.rpm': 'rpm',
    'appimage/notes.txt': 'ignored',
  });

  const found = findArtifacts(root, 'linux').map(({ suffix }) => suffix).sort();
  assert.deepEqual(found, ['.AppImage', '.AppImage.sig', '.deb', '.rpm']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('windows bundles collect the NSIS installer and its signature', () => {
  const root = makeBundle({
    'nsis/MineBench Client_0.9.0_x64-setup.exe': 'installer',
    'nsis/MineBench Client_0.9.0_x64-setup.exe.sig': 'sig',
    'msi/MineBench Client_0.9.0_x64_en-US.msi': 'not built by the nsis bundle',
  });

  const found = findArtifacts(root, 'windows').map(({ suffix }) => suffix).sort();
  assert.deepEqual(found, ['.exe', '.exe.sig']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('collecting renames every file into the shared output directory', () => {
  const root = makeBundle({
    'appimage/MineBench Client Nightly_0.10.0-nightly.20261012.1_amd64.AppImage': 'a',
    'appimage/MineBench Client Nightly_0.10.0-nightly.20261012.1_amd64.AppImage.sig': 's',
    'deb/MineBench Client Nightly_0.10.0-nightly.20261012.1_amd64.deb': 'd',
  });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-out-'));

  try {
    const written = collectReleaseArtifacts({
      bundleRoot: root,
      outDir: out,
      version: '0.10.0-nightly.20261012.1',
      channel: 'nightly',
      target: 'linux',
    });

    assert.deepEqual(written, [
      'mbc-0.10.0-nightly.20261012.1-nightly-linux-x86_64.AppImage',
      'mbc-0.10.0-nightly.20261012.1-nightly-linux-x86_64.AppImage.sig',
      'mbc-0.10.0-nightly.20261012.1-nightly-linux-x86_64.deb',
    ]);
    for (const name of written) assert.ok(fs.existsSync(path.join(out, name)), `${name} exists`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('a build that produced nothing fails instead of publishing an empty channel', () => {
  const root = makeBundle({});
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-out-'));

  try {
    assert.throws(
      () =>
        main([
          '--bundle', root,
          '--out', out,
          '--channel', 'stable',
          '--version', '0.9.0',
          '--target', 'windows',
        ]),
      /produced nothing to publish/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
