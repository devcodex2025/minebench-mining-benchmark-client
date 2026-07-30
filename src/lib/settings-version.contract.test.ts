import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const settingsSource = readFileSync(
  new URL('../pages/Settings.tsx', import.meta.url),
  'utf8'
);

assert.match(
  settingsSource,
  /data-testid="xmrig-current-version"/,
  'Settings must render the detected XMRig version'
);
assert.match(
  settingsSource,
  /data-testid="xmrig-update-button"/,
  'Settings must render the XMRig update action when a newer release is available'
);
assert.match(
  settingsSource,
  /nativeApi\.miner\.getVersionInfo\(\)/,
  'Settings must load version data from the native bundled binary'
);

console.log('Settings XMRig version contract tests passed');
