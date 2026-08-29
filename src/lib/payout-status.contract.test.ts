import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const statusCardSource = readFileSync(
  new URL('../components/PayoutStatusCard.tsx', import.meta.url),
  'utf8'
);
const serviceSource = readFileSync(
  new URL('../services/solanaAuth.ts', import.meta.url),
  'utf8'
);

assert.match(
  serviceSource,
  /getLatestPayoutStatus[\s\S]*['"]\/api\/rewards\/payout\/status['"]/,
  'Payout status must be loaded from the authenticated backend endpoint'
);
assert.match(
  statusCardSource,
  /minebench:payout-status:\$\{wallet\}[\s\S]*localStorage[\s\S]*void refresh\(\)/,
  'Local payout data must be treated as cache and immediately refreshed from backend'
);
assert.match(
  statusCardSource,
  /batchFilled[\s\S]*batchTargetSize[\s\S]*batchRemaining/,
  'Payout status must display batch fill and remaining slots'
);

console.log('Payout status backend-source contract tests passed');
