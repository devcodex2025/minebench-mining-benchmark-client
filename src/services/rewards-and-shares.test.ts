/**
 * Tests for reward recording, wallet balance updates, and reward-window shares
 * tracking via mapRewardsBalanceToMiningStats.
 *
 * Run with: node --import tsx/esm src/services/rewards-and-shares.test.ts
 */

import assert from 'node:assert/strict';
import { mapRewardsBalanceToMiningStats } from './miningStatsMapper.ts';

// ---------------------------------------------------------------------------
// Wallet balance (totalRewards / dbTotalBMT)
// ---------------------------------------------------------------------------

const balanceData = {
    bmt_available: '25.75',
    total_bmt_earned: '100.00',
    total_bmt_withdrawn: '74.25',
    paid_bmt: '74.25',
    minClaimBmt: '100',
};

const balanceStats = mapRewardsBalanceToMiningStats(balanceData);
assert.equal(balanceStats.totalRewards, 25.75, 'totalRewards maps from bmt_available');
assert.equal(balanceStats.totalBmtEarned, 100.0, 'totalBmtEarned maps from total_bmt_earned');
assert.equal(balanceStats.totalBmtWithdrawn, 74.25, 'totalBmtWithdrawn maps from total_bmt_withdrawn');
assert.equal(balanceStats.paidBmt, 74.25, 'paidBmt maps from completed payout total');
assert.equal(balanceStats.minClaimBmt, 100, 'minClaimBmt maps from backend configuration');

// Alternate field names (legacy)
const legacyBalance = mapRewardsBalanceToMiningStats({ available_bmt: '7.5' });
assert.equal(legacyBalance.totalRewards, 7.5, 'totalRewards maps from available_bmt (legacy field)');

// Empty payload → zeros (no crash)
const emptyBalance = mapRewardsBalanceToMiningStats({});
assert.equal(emptyBalance.totalRewards, 0);
assert.equal(emptyBalance.totalBmtEarned, 0);

// ---------------------------------------------------------------------------
// Reward window shares (activeWindowUserShares / activeWindowPoolShares)
// ---------------------------------------------------------------------------

// Backend returns current_window object
const withWindow = mapRewardsBalanceToMiningStats({
    bmt_available: '10',
    current_window: {
        monero_window_number: 5,
        window_key: 'w-5',
        total_pool_shares: 200,
        total_accepted_shares: 180,
        user_accepted_shares: 12,
        reward_share_percent: 6.67,
        pool_hashrate: 500000,
        updated_at: '2026-06-01T08:00:00.000Z',
    },
});

assert.equal(withWindow.activeWindowUserShares, 12, 'user shares from current_window.user_accepted_shares');
assert.equal(withWindow.activeWindowPoolShares, 180, 'pool shares from current_window.total_accepted_shares');
assert.equal(withWindow.activeWindowRewardSharePercent, 6.67, 'reward % from current_window.reward_share_percent');
assert.equal(withWindow.currentWindow?.windowKey, 'w-5');
assert.equal(withWindow.currentWindow?.updatedAt, '2026-06-01T08:00:00.000Z');

// Backend returns flat active_window_* fields (no current_window object)
const flatWindow = mapRewardsBalanceToMiningStats({
    bmt_available: '10',
    active_window_user_shares: '8',
    active_window_pool_shares: '150',
    active_window_reward_share_percent: '5.33',
});

assert.equal(flatWindow.activeWindowUserShares, 8, 'user shares from flat active_window_user_shares');
assert.equal(flatWindow.activeWindowPoolShares, 150);
assert.equal(flatWindow.activeWindowRewardSharePercent, 5.33);
assert.equal(flatWindow.currentWindow, null, 'currentWindow null when no current_window object');

// ---------------------------------------------------------------------------
// Reward recorded after first verified share (balance increases)
// ---------------------------------------------------------------------------

// Simulate: before first share, balance = 0
const beforeShare = mapRewardsBalanceToMiningStats({
    bmt_available: '0',
    current_window: {
        monero_window_number: 1,
        window_key: 'w-1',
        total_pool_shares: 0,
        total_accepted_shares: 0,
        user_accepted_shares: 0,
        reward_share_percent: 0,
        pool_hashrate: 0,
        updated_at: null,
    },
});
assert.equal(beforeShare.totalRewards, 0);
assert.equal(beforeShare.activeWindowUserShares, 0);

// After first share — backend credits reward
const afterShare = mapRewardsBalanceToMiningStats(
    {
        bmt_available: '50',
        current_window: {
            monero_window_number: 1,
            window_key: 'w-1',
            total_pool_shares: 100,
            total_accepted_shares: 90,
            user_accepted_shares: 1,
            reward_share_percent: 1.11,
            pool_hashrate: 300000,
            updated_at: '2026-06-01T09:00:00.000Z',
        },
    },
    [],
    beforeShare
);

assert.equal(afterShare.totalRewards, 50, 'balance updated after first share reward');
assert.equal(afterShare.activeWindowUserShares, 1, 'user share count reflects first verified share');
assert.equal(afterShare.activeWindowPoolShares, 90);
assert.notEqual(afterShare.activeWindowRewardSharePercent, 0, 'reward share percent non-zero after first share');

// ---------------------------------------------------------------------------
// Stability: window shares preserved when backend omits current_window
// ---------------------------------------------------------------------------

const preserved = mapRewardsBalanceToMiningStats(
    { bmt_available: '55' }, // no current_window
    [],
    afterShare
);

assert.equal(preserved.totalRewards, 55, 'balance updated even when current_window absent');
assert.equal(preserved.activeWindowUserShares, 1, 'window shares preserved from previous stats');
assert.equal(preserved.activeWindowPoolShares, 90, 'pool shares preserved from previous stats');
assert.equal(preserved.currentWindow?.windowKey, 'w-1', 'currentWindow preserved from previous stats');

// ---------------------------------------------------------------------------
// New reward window resets user shares to zero (authoritative from backend)
// ---------------------------------------------------------------------------

const newWindow = mapRewardsBalanceToMiningStats(
    {
        bmt_available: '55',
        current_window: {
            monero_window_number: 2,
            window_key: 'w-2',
            total_pool_shares: 0,
            total_accepted_shares: 0,
            user_accepted_shares: 0,
            reward_share_percent: 0,
            pool_hashrate: 0,
            updated_at: '2026-06-01T10:00:00.000Z',
        },
    },
    [],
    afterShare
);

assert.equal(newWindow.activeWindowUserShares, 0, 'new window zeros user shares (authoritative)');
assert.equal(newWindow.currentWindow?.windowKey, 'w-2');

// ---------------------------------------------------------------------------
// Paid shares tracking
// ---------------------------------------------------------------------------

const paidSharesStats = mapRewardsBalanceToMiningStats({
    bmt_available: '10',
    active_shares: 5,
    paid_shares: 3,
});

assert.equal(paidSharesStats.activeShares, 5);
assert.equal(paidSharesStats.paidShares, 3);

console.log('rewards-and-shares tests passed');
