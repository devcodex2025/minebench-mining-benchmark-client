import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('private reward balance is event-driven and has no periodic component polling', () => {
  const dashboard = read('src/App.tsx');
  const walletButton = read('src/components/SolanaAuthButton.tsx');
  const mining = read('src/pages/Mining.tsx');

  assert.doesNotMatch(dashboard, /setInterval\(syncConfirmed/);
  assert.doesNotMatch(walletButton, /setInterval\([^)]*refreshWallet/);
  assert.doesNotMatch(mining, /verifiedSharesIntervalRef/);
  assert.match(walletButton, /subscribeToRewardEvents/);
});

test('mining reports cannot trigger a private reward refresh', () => {
  for (const file of ['src/pages/Mining.tsx', 'src/pages/Benchmark.tsx', 'src/pages/StressTest.tsx']) {
    const source = read(file);
    assert.doesNotMatch(source, /reportMiningStats\([\s\S]{0,1200}fetchMiningStats/, `${file} refreshes rewards after a report`);
  }
});

test('server events carry no client-provided user or reward amount', () => {
  const stream = read('src/lib/reward-event-stream.ts');

  assert.match(stream, /method: 'GET'/);
  assert.doesNotMatch(stream, /body:/);
  assert.doesNotMatch(stream, /userId|walletPublicKey|amount/);
});
