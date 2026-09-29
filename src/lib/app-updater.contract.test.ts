import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('Tauri updater is configured for signed Bitbucket artifacts', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  const cargo = read('src-tauri/Cargo.toml');
  const native = read('src-tauri/src/lib.rs');
  const capabilities = JSON.parse(read('src-tauri/capabilities/desktop.json'));
  const commands = read('src-tauri/src/commands.rs');

  assert.equal(config.bundle.createUpdaterArtifacts, true);
  assert.match(config.plugins.updater.endpoints[0], /bitbucket\.org/);
  assert.ok(config.plugins.updater.pubkey.length > 40);
  assert.match(cargo, /tauri-plugin-updater = "2"/);
  assert.match(native, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/);
  assert.ok(capabilities.permissions.includes('updater:default'));
  assert.match(commands, /\| "bitbucket\.org"/);
});

test('update button installs through Tauri on every platform', () => {
  const service = read('src/services/appUpdate.ts');
  const state = read('src/services/appUpdateState.ts');

  assert.match(service, /downloadAndInstall/);
  assert.match(service, /await withTimeout\(/);
  assert.match(state, /install: installAppUpdate/);
});

test('the title bar and Settings share one synchronized update store', () => {
  const titleBar = read('src/components/TitleBar.tsx');
  const settings = read('src/pages/Settings.tsx');
  const state = read('src/services/appUpdateState.ts');

  for (const [name, source] of [['TitleBar', titleBar], ['Settings', settings]] as const) {
    assert.match(source, /useAppUpdate\(\)/, `${name} must read the shared update state`);
    assert.match(source, /checkForUpdate/, `${name} must trigger the shared check`);
    assert.match(source, /startUpdate/, `${name} must trigger the shared install`);
    assert.doesNotMatch(source, /installAppUpdate/, `${name} must not install on its own`);
    assert.doesNotMatch(
      source,
      /const \[installingUpdate/,
      `${name} must not keep a private install flag`
    );
  }

  assert.match(state, /createAppUpdateStore\(\{/);
  assert.match(state, /checkStatus: getAppUpdateStatus/);
  assert.match(state, /install: installAppUpdate/);
});

test('one updater manifest covers the Windows and Linux builds', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));

  // "all" bundles the Windows installers and the Linux AppImage from the same
  // config, and the single Bitbucket manifest carries one entry per platform, so
  // the synchronized install flow behaves the same on both systems.
  assert.equal(config.bundle.targets, 'all');
  assert.equal(config.plugins.updater.endpoints.length, 1);
  assert.match(config.plugins.updater.endpoints[0], /bitbucket\.org\/.*latest\.json$/);
  assert.equal(config.plugins.updater.windows.installMode, 'passive');
  assert.ok(config.bundle.windows.nsis, 'Windows bundle settings must stay declared');
});

test('the updater can never block the UI on an unresponsive native call', () => {
  const service = read('src/services/appUpdate.ts');

  assert.match(service, /export const withTimeout/);
  assert.match(service, /AbortSignal\.timeout\(CHECK_TIMEOUT_MS\)/);
  assert.match(service, /if \(installPromise\) return installPromise;/);
  assert.match(service, /RELAUNCH_TIMEOUT_MS/);
});
