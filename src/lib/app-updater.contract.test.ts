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

test('update button installs through Tauri before using the downloads fallback', () => {
  const service = read('src/services/appUpdate.ts');
  const settings = read('src/pages/Settings.tsx');

  assert.match(service, /downloadAndInstall/);
  assert.match(service, /await relaunch\(\)/);
  assert.match(settings, /installAppUpdate/);
});
