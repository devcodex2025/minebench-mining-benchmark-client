import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('private reward balance uses the shared 60-second backend sync queue', () => {
  const dashboard = read('src/App.tsx');
  const walletButton = read('src/components/SolanaAuthButton.tsx');
  const mining = read('src/pages/Mining.tsx');

  assert.match(dashboard, /BACKEND_SYNC_INTERVAL_MS = 60_000/);
  assert.match(dashboard, /fetchRewardStats[\s\S]*fetchMiningStats/);
  assert.match(dashboard, /for \(const job of \[fetchPoolStats, fetchRates, fetchRewardStats\]\)/);
  assert.doesNotMatch(walletButton, /setInterval\([^)]*refreshWallet/);
  assert.doesNotMatch(mining, /poolStatsIntervalRef|ratesIntervalRef|verifiedSharesIntervalRef/);
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
