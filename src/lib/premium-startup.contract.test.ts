import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const authServiceSource = readFileSync(
  new URL('../services/solanaAuth.ts', import.meta.url),
  'utf8'
);
const authButtonSource = readFileSync(
  new URL('../components/SolanaAuthButton.tsx', import.meta.url),
  'utf8'
);
const settingsSource = readFileSync(new URL('../pages/Settings.tsx', import.meta.url), 'utf8');
const nativeCommandsSource = readFileSync(new URL('../../src-tauri/src/commands.rs', import.meta.url), 'utf8');

const miningStatsMethod = authServiceSource.match(
  /async fetchMiningStats[\s\S]*?\n {2}async requestPayout/
)?.[0] || '';

assert.match(
  authServiceSource,
  /loadPremiumStatusOnStartup\(\)[\s\S]*['"]\/api\/user\/premium-status['"]/,
  'Premium status must have a startup-only loader'
);
assert.match(
  settingsSource,
  /backendJson[^;]*['"]\/api\/user\/premium-status['"][\s\S]*method:\s*['"]PATCH['"]/,
  'Settings must persist the XMR payout destination through the authenticated backend'
);
assert.match(
  nativeCommandsSource,
  /"PATCH"\s*=>\s*client\.patch\(&url\)/,
  'The native backend proxy must allow PATCH for wallet persistence'
);
assert.doesNotMatch(
  miningStatsMethod,
  /premium-status/,
  'Regular mining statistics refresh must not request premium status'
);
assert.match(
  authButtonSource,
  /loadUserFromStorage\(\)[\s\S]*loadPremiumStatusOnStartup\(\)/,
  'Premium status must load while restoring the user during application startup'
);

console.log('Startup-only premium status contract tests passed');
