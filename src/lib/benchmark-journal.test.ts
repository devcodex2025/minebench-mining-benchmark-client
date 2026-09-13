import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBenchmarkJournalSession,
  getBenchmarkJournal,
  recordBenchmarkAcceptedShares,
  updateBenchmarkJournalSession
} from './benchmark-journal.ts';

const values = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value)
  },
  dispatchEvent: () => true
};

test('journal is wallet scoped and records only accepted-share deltas', () => {
  const first = createBenchmarkJournalSession('wallet-a', { id: 'first', startedAt: 100, durationSeconds: 60 });
  assert.equal(first, 'first');
  recordBenchmarkAcceptedShares('wallet-a', first, 2, 110);
  recordBenchmarkAcceptedShares('wallet-a', first, 2, 120);
  recordBenchmarkAcceptedShares('wallet-a', first, 5, 130);
  updateBenchmarkJournalSession('wallet-a', first, { status: 'completed', submissionStatus: 'failed', submissionFailureReason: 'network unavailable' });

  const [session] = getBenchmarkJournal('wallet-a');
  assert.equal(session.acceptedShares, 5);
  assert.deepEqual(session.shares.map((share) => share.count), [2, 3]);
  assert.equal(session.status, 'completed');
  assert.equal(session.submissionStatus, 'failed');
  assert.equal(getBenchmarkJournal('wallet-b').length, 0);
});

test('treats unreadable local storage data as an empty journal', () => {
  values.set('minebench_benchmark_journal_v1:corrupt-wallet', '{not-json');
  assert.deepEqual(getBenchmarkJournal('corrupt-wallet'), []);
});

test('records unauthenticated benchmarks separately from every wallet', () => {
  const id = createBenchmarkJournalSession('', { id: 'anonymous-run', startedAt: 200 });
  recordBenchmarkAcceptedShares('', id, 3, 210);
  assert.equal(getBenchmarkJournal('')[0].acceptedShares, 3);
  assert.equal(getBenchmarkJournal('wallet-a').some(session => session.id === id), false);
  assert.deepEqual(getBenchmarkJournal(undefined), []);
});

test('keeps journal storage bounded for sessions and share records', () => {
  const wallet = 'bounded-wallet';
  for (let index = 0; index < 35; index++) {
    createBenchmarkJournalSession(wallet, { id: `session-${index}`, startedAt: index });
  }
  const sessions = getBenchmarkJournal(wallet);
  assert.equal(sessions.length, 30);
  assert.equal(sessions[0].id, 'session-34');
  assert.equal(sessions.at(-1)?.id, 'session-5');

  const id = createBenchmarkJournalSession(wallet, { id: 'share-cap', startedAt: 100 });
  for (let index = 1; index <= 105; index++) {
    recordBenchmarkAcceptedShares(wallet, id, index, index);
  }
  const session = getBenchmarkJournal(wallet).find((entry) => entry.id === id);
  assert.equal(session?.acceptedShares, 105);
  assert.equal(session?.shares.length, 100);
  assert.equal(session?.shares[0].count, 1);
});
