import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifyHost,
  evaluateChannelConfig,
  hostOf,
  isProductionHost,
  loadEnvironment,
} from './check-channel-config.mjs';

const PRODUCTION = {
  VITE_API_BASE_URL: 'https://backend.minebench.cloud/api',
  VITE_BACKEND_URL: 'https://backend.minebench.cloud',
  VITE_PRIMARY_POOL_HOST: 'xmr.minebench.cloud',
  VITE_PRIMARY_RPC_HOST: 'xmr.minebench.cloud',
  VITE_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
};

const LOCAL = {
  VITE_API_BASE_URL: 'http://localhost:8000/api',
  VITE_BACKEND_URL: 'http://127.0.0.1:3000',
  VITE_PRIMARY_POOL_HOST: 'localhost',
  VITE_PRIMARY_RPC_HOST: 'localhost',
  VITE_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
};

test('hostOf reads a host from every shape the config uses', () => {
  assert.equal(hostOf('https://backend.minebench.cloud/api'), 'backend.minebench.cloud');
  assert.equal(hostOf('xmr.minebench.cloud:3333'), 'xmr.minebench.cloud');
  assert.equal(hostOf('ws://localhost:3000/sync'), 'localhost');
  assert.equal(hostOf('http://user@10.0.0.5:8080/x'), '10.0.0.5');
  assert.equal(hostOf('  xmr.minebench.cloud  '), 'xmr.minebench.cloud');
});

test('production hosts are the minebench.cloud domain only', () => {
  assert.equal(isProductionHost('minebench.cloud'), true);
  assert.equal(isProductionHost('xmr.minebench.cloud'), true);
  assert.equal(isProductionHost('notminebench.cloud'), false);
  assert.equal(isProductionHost('minebench.cloud.evil.test'), false);
});

test('classifyHost separates production, local and test endpoints', () => {
  assert.equal(classifyHost('minebench', 'backend.minebench.cloud'), 'production');
  assert.equal(classifyHost('minebench', 'localhost'), 'local');
  assert.equal(classifyHost('minebench', 'staging.example.test'), 'test');
  assert.equal(classifyHost('solana', 'api.mainnet-beta.solana.com'), 'production');
  assert.equal(classifyHost('solana', 'api.devnet.solana.com'), 'test');
});

test('stable and canary are safe with nothing set, nightly is not', () => {
  for (const channel of ['stable', 'canary']) {
    // The code falls back to compiled production defaults, so an unset variable
    // is the normal release case.
    const result = evaluateChannelConfig(channel, {});
    assert.equal(result.ok, true, `${channel} must be safe with no endpoints set`);
  }

  const nightly = evaluateChannelConfig('nightly', {});
  assert.equal(nightly.ok, false);
  assert.equal(nightly.violations.length, 5, 'every endpoint must be given explicitly');
});

test('a release build must not point at a local or test endpoint', () => {
  for (const channel of ['stable', 'canary']) {
    const local = evaluateChannelConfig(channel, LOCAL);
    assert.equal(local.ok, false, `${channel} must reject local endpoints`);
    // Four endpoints are local, and devnet Solana is test infrastructure.
    assert.equal(local.violations.filter(({ problem }) => problem.includes('local')).length, 4);

    const staging = evaluateChannelConfig(channel, {
      ...PRODUCTION,
      VITE_BACKEND_URL: 'https://staging.example.test',
    });
    assert.equal(staging.ok, false);
    assert.deepEqual(staging.violations, [
      {
        variable: 'VITE_BACKEND_URL',
        value: 'https://staging.example.test',
        problem: `a ${channel} build must use production infrastructure`,
      },
    ]);

    assert.equal(evaluateChannelConfig(channel, PRODUCTION).ok, true);
  }
});

test('a nightly build must not reach production', () => {
  const production = evaluateChannelConfig('nightly', PRODUCTION);
  assert.equal(production.ok, false);
  assert.equal(production.violations.length, 5);

  // Mainnet Solana is production infrastructure too, even though the host is not
  // a minebench.cloud domain.
  const mainnetOnly = evaluateChannelConfig('nightly', {
    ...LOCAL,
    VITE_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
  });
  assert.equal(mainnetOnly.ok, false);
  assert.deepEqual(mainnetOnly.violations.map(({ variable }) => variable), ['VITE_SOLANA_RPC_URL']);

  assert.equal(evaluateChannelConfig('nightly', LOCAL).ok, true);
});

test('loadEnvironment merges the channel files with the process environment', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'minebench-channel-env-'));
  const previous = process.env.VITE_BACKEND_URL;
  try {
    fs.writeFileSync(
      path.join(cwd, '.env'),
      'VITE_BACKEND_URL=https://backend.minebench.cloud\nVITE_PRIMARY_POOL_HOST=xmr.minebench.cloud\n'
    );
    fs.writeFileSync(path.join(cwd, '.env.nightly'), 'VITE_BACKEND_URL=http://localhost:8000\n');

    const fromFiles = loadEnvironment('nightly', cwd);
    assert.equal(fromFiles.VITE_BACKEND_URL, 'http://localhost:8000', 'the mode file wins');
    assert.equal(fromFiles.VITE_PRIMARY_POOL_HOST, 'xmr.minebench.cloud');

    process.env.VITE_BACKEND_URL = 'http://localhost:9000';
    assert.equal(loadEnvironment('nightly', cwd).VITE_BACKEND_URL, 'http://localhost:9000');
  } finally {
    if (previous === undefined) delete process.env.VITE_BACKEND_URL;
    else process.env.VITE_BACKEND_URL = previous;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
