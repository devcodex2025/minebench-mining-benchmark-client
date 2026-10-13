import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalSource = readFileSync(
  new URL('../components/ClaimRewardsModal.tsx', import.meta.url),
  'utf8'
);
const authServiceSource = readFileSync(
  new URL('../services/solanaAuth.ts', import.meta.url),
  'utf8'
);
const nativeCommandsSource = readFileSync(
  new URL('../../src-tauri/src/commands.rs', import.meta.url),
  'utf8'
);

assert.match(
  modalSource,
  /quotePayout\(amountNum\)/,
  'Claim modal must request a payout quote for the entered amount'
);
assert.match(
  authServiceSource,
  /['"]\/api\/rewards\/claim\/quote['"]/,
  'Payout quote must use the backend claim quote endpoint'
);
assert.match(
  nativeCommandsSource,
  /clean_path == "\/api\/rewards\/claim\/quote"/,
  'Native client must allow the payout quote endpoint'
);
assert.match(
  nativeCommandsSource,
  /clean_path == "\/api\/rewards\/payout\/status"/,
  'Native client must allow the payout status endpoint'
);
assert.match(
  modalSource,
  /Solana payout cost[\s\S]*quote\.totalSolCost[\s\S]*quote\.feeBmt/,
  'Claim modal must display the Solana cost and its BMT equivalent'
);
assert.match(
  modalSource,
  /quote\.ataRentSol[\s\S]*first-time BMT token account rent/,
  'Claim modal must disclose first-time token account rent'
);
assert.match(
  modalSource,
  /netAmountBmt[\s\S]*Estimated wallet amount[\s\S]*formatBmt\(netAmount\)/,
  'Claim modal must display the estimated net BMT amount the user receives'
);

assert.match(
  modalSource,
  /quote\?\.canClaim === true/,
  'Claim modal must require a successful quote before enabling submission'
);
assert.match(
  modalSource,
  /quote\.canClaim[\s\S]*estimated Solana network cost/,
  'Claim modal must block a quote that does not cover its estimated fee'
);

console.log('Claim rewards fee display contract tests passed');
