import assert from 'node:assert/strict';
import { mapRewardsBalanceToMiningStats } from './miningStatsMapper.ts';

const stats = mapRewardsBalanceToMiningStats({
  bmt_available: '12.5',
  active_shares: 7,
  paid_shares: 2,
  active_window_user_shares: '4',
  active_window_pool_shares: '9',
  active_window_reward_share_percent: '44.4444',
  current_window: {
    monero_window_number: 101,
    window_key: 'time-101',
    total_pool_shares: 9,
    total_accepted_shares: 10,
    user_accepted_shares: 5,
    reward_share_percent: 50,
    pool_hashrate: 123,
    updated_at: '2026-05-14T10:00:00.000Z'
  }
});

assert.equal(stats.totalRewards, 12.5);
assert.equal(stats.activeShares, 7);
assert.equal(stats.paidShares, 2);
assert.equal(stats.activeWindowUserShares, 5);
assert.equal(stats.activeWindowPoolShares, 10);
assert.equal(stats.activeWindowRewardSharePercent, 50);
assert.equal(stats.currentWindow?.moneroWindowNumber, 101);
assert.equal(stats.currentWindow?.updatedAt, '2026-05-14T10:00:00.000Z');

const legacyStats = mapRewardsBalanceToMiningStats({
  bmt_available: 1,
  active_window_user_shares: '4',
  active_window_pool_shares: '8',
  active_window_reward_share_percent: '50'
});

assert.equal(legacyStats.activeWindowUserShares, 4);
assert.equal(legacyStats.activeWindowPoolShares, 8);
assert.equal(legacyStats.activeWindowRewardSharePercent, 50);
assert.equal(legacyStats.currentWindow, undefined);

const emptyStats = mapRewardsBalanceToMiningStats({});

assert.equal(emptyStats.activeWindowUserShares, 0);
assert.equal(emptyStats.activeWindowPoolShares, 0);
assert.equal(emptyStats.activeWindowRewardSharePercent, 0);

const stableStats = mapRewardsBalanceToMiningStats({ bmt_available: 13 }, [], stats);

assert.equal(stableStats.totalRewards, 13);
assert.equal(stableStats.activeWindowUserShares, 5);
assert.equal(stableStats.activeWindowPoolShares, 10);
assert.equal(stableStats.activeWindowRewardSharePercent, 50);
assert.equal(stableStats.currentWindow?.windowKey, 'time-101');

const nextWindowStats = mapRewardsBalanceToMiningStats({
  bmt_available: 14,
  current_window: {
    monero_window_number: 102,
    window_key: 'time-102',
    total_pool_shares: 0,
    total_accepted_shares: 0,
    user_accepted_shares: 0,
    reward_share_percent: 0,
    pool_hashrate: 456,
    updated_at: '2026-05-14T10:02:00.000Z'
  }
}, [], stats);

assert.equal(nextWindowStats.totalRewards, 14);
assert.equal(nextWindowStats.activeWindowUserShares, 0);
assert.equal(nextWindowStats.activeWindowPoolShares, 0);
assert.equal(nextWindowStats.activeWindowRewardSharePercent, 0);
assert.equal(nextWindowStats.currentWindow?.windowKey, 'time-102');

console.log('client verified shares mapping test passed');
