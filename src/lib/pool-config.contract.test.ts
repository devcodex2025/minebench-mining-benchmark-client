import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fallback = JSON.parse(
  readFileSync(new URL('../../config/fallback.json', import.meta.url), 'utf8')
) as {
  poolConfigAllowlist: string[];
  defaults: Record<string, unknown>;
};

// The backend-advertised default (BMT) endpoint must be accepted, and the
// direct (XMR) endpoint stays allowed. Order is part of the contract: BMT first.
assert.deepEqual(
  fallback.poolConfigAllowlist,
  ['bmt.minebench.cloud', 'xmr.minebench.cloud'],
  'poolConfigAllowlist must allow the BMT (default) host first, then the direct XMR host'
);

// Default/backup pool fallbacks resolve to the app (BMT) endpoint.
assert.equal(fallback.defaults.primaryPoolHost, 'bmt.minebench.cloud');
assert.equal(fallback.defaults.primaryHost, 'bmt.minebench.cloud');
assert.equal(fallback.defaults.backupPoolHost, 'bmt.minebench.cloud');
assert.equal(fallback.defaults.backupHost, 'node.monerodevs.org');

// RPC hosts are intentionally unchanged (out of scope).
assert.equal(fallback.defaults.primaryRpcHost, 'xmr.minebench.cloud');
assert.equal(fallback.defaults.backupRpcHost, 'node.monerodevs.org');

const environmentSource = readFileSync(
  new URL('../config/environment.ts', import.meta.url),
  'utf8'
);

// Last-resort literals must also resolve to the app/default BMT host.
assert.match(
  environmentSource,
  /const primaryPoolHostFallback = [^;]*\|\| 'bmt\.minebench\.cloud';/,
  'primary pool host fallback literal must be bmt.minebench.cloud'
);
assert.match(
  environmentSource,
  /const backupPoolHostFallback = [^;]*\|\| 'bmt\.minebench\.cloud';/,
  'backup pool host fallback literal must be bmt.minebench.cloud'
);

console.log('Pool fallback / allowlist contract tests passed');
