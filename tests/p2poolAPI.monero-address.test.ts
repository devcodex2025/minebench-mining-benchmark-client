import assert from 'node:assert/strict';
import { p2poolAPI } from '../src/services/p2poolAPI.ts';

// Ground truth for the two addresses below — both are live deployment wallets, taken verbatim from
// `.codex/pool-live-manifest.json`:
//   MONERO_WALLET_ADDRESS=48ghPqjkJYEKAL1ukr9YmB6B8V1g9kjMrFkrP36ZnVLxHRyFs9odvapQtjFkWRyjsG1N3ipHqiByjHUNrDZTsxG2DRRHWjj
//   POOL_FEE_WALLET      =8AqYNZxzgXsUemVoDCE1YuJd9RtWs6xr8XdJRkvRSKVTbcr18crnDG54RangKoXeBgBDcrBtmagFM8bzEe9N12R8HEaohVu
// Both were verified cryptographically (Monero base58 decode + keccak-256 checksum, the same algorithm as
// MineBench-Backend/src/modules/miner-ops/monero-address.ts): the first is a 95-character standard mainnet
// address, the second a 95-character mainnet **subaddress**. The backend validator
// (`/^[48][1-9A-HJ-NP-Za-km-z]{94}$/` plus the checksum) accepts both, and this deployment pays the pool
// fee to the subaddress. Replacing one character with `0` (not in the Monero base58 alphabet) breaks the
// checksum, and no Monero mainnet address is 106 characters long starting with `8`.
const STANDARD_ADDRESS = '48ghPqjkJYEKAL1ukr9YmB6B8V1g9kjMrFkrP36ZnVLxHRyFs9odvapQtjFkWRyjsG1N3ipHqiByjHUNrDZTsxG2DRRHWjj';
const SUBADDRESS = '8AqYNZxzgXsUemVoDCE1YuJd9RtWs6xr8XdJRkvRSKVTbcr18crnDG54RangKoXeBgBDcrBtmagFM8bzEe9N12R8HEaohVu';
const NON_BASE58_VARIANT = STANDARD_ADDRESS.replace('ghPq', 'gh0q');
const BOGUS_106 = '8' + '1'.repeat(105);

// The client's validator (src/services/p2poolAPI.ts:334-339) is
//   /^4[0-9a-zA-Z]{94}$/ || /^8[0-9a-zA-Z]{105}$/
// and it gates mining (Mining.tsx:353-356 → the start button) and the stress test
// (StressTest.tsx:269-272 → "Monero wallet address is invalid.").
const failures: string[] = [];
const check = (address: string, expected: boolean, label: string) => {
  const actual = p2poolAPI.validateMoneroAddress(address);
  if (actual !== expected) failures.push(`${label}: expected ${expected}, got ${actual}`);
};

check(STANDARD_ADDRESS, true, 'standard mainnet address must be accepted');
// A mainnet subaddress is 95 characters and differs from a standard address only in the network byte, so
// rejecting it makes the client refuse a format the backend (and this deployment) uses.
check(SUBADDRESS, true, 'valid mainnet subaddress must be accepted');
// No Monero mainnet address is 106 characters starting with 8; accepting such a string claims validity
// for something that cannot be an address.
check(BOGUS_106, false, 'a 106-character 8... string must not be accepted');
// `0`, `O`, `I` and `l` are not in the Monero base58 alphabet, and this string also fails the checksum.
check(NON_BASE58_VARIANT, false, 'a non-base58 character must not be accepted');
// Contrasts: obviously invalid input stays rejected.
check('', false, 'empty string must be rejected');
check('4abc', false, 'too-short string must be rejected');
check('x'.repeat(95), false, 'wrong prefix must be rejected');

assert.deepEqual(failures, [], `monero address validation:\n  ${failures.join('\n  ')}`);

console.log('monero address validation tests passed');
