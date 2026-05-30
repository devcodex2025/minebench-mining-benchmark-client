import type { MiningDevice, UserMiningStats } from './solanaAuth';

const toNumber = (value: any) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const mapRewardsBalanceToMiningStats = (
  balanceData: any,
  devices: MiningDevice[] = [],
  previousStats?: UserMiningStats | null
): UserMiningStats => {
  const bmtBalance = toNumber(balanceData?.bmt_available ?? balanceData?.available_bmt ?? balanceData?.balance ?? 0);
  const totalBmtWithdrawn = toNumber(balanceData?.total_bmt_withdrawn ?? balanceData?.bmt_total_withdrawn ?? 0);
  const currentWindow = balanceData?.current_window || null;
  const mappedCurrentWindow = currentWindow ? {
    moneroWindowNumber: toNumber(currentWindow.monero_window_number),
    windowKey: String(currentWindow.window_key || ''),
    totalPoolShares: toNumber(currentWindow.total_pool_shares),
    totalAcceptedShares: toNumber(currentWindow.total_accepted_shares),
    userAcceptedShares: toNumber(currentWindow.user_accepted_shares),
    rewardSharePercent: toNumber(currentWindow.reward_share_percent),
    poolHashrate: toNumber(currentWindow.pool_hashrate),
    updatedAt: currentWindow.updated_at ?? null
  } : undefined;
  // Preserve the previous window only when the backend omits current_window.
  // If current_window is present, its zero values are authoritative.
  const stableCurrentWindow = mappedCurrentWindow ?? previousStats?.currentWindow ?? null;
  const stableUserShares =
    mappedCurrentWindow
      ? mappedCurrentWindow.userAcceptedShares
      : balanceData?.active_window_user_shares ?? previousStats?.activeWindowUserShares ?? 0;
  const stablePoolShares =
    mappedCurrentWindow
      ? mappedCurrentWindow.totalAcceptedShares
      : balanceData?.active_window_pool_shares ?? previousStats?.activeWindowPoolShares ?? 0;
  const stableRewardSharePercent =
    mappedCurrentWindow
      ? mappedCurrentWindow.rewardSharePercent
      : balanceData?.active_window_reward_share_percent ?? previousStats?.activeWindowRewardSharePercent ?? 0;

  return {
    totalRewards: bmtBalance,
    totalXmrMined: toNumber(balanceData?.total_xmr_mined ?? balanceData?.xmr_total_earned ?? 0),
    totalBmtEarned: toNumber(balanceData?.total_bmt_earned ?? balanceData?.bmt_total_earned ?? 0),
    totalBmtWithdrawn,
    activeBmt: toNumber(balanceData?.active_bmt ?? bmtBalance),
    paidBmt: toNumber(balanceData?.paid_bmt ?? totalBmtWithdrawn),
    activeShares: toNumber(balanceData?.active_shares ?? 0),
    paidShares: toNumber(balanceData?.paid_shares ?? 0),
    activeWindowUserShares: toNumber(stableUserShares),
    activeWindowPoolShares: toNumber(stablePoolShares),
    activeWindowRewardSharePercent: toNumber(stableRewardSharePercent),
    currentWindow: stableCurrentWindow,
    thisMonth: 0,
    thisWeek: 0,
    today: 0,
    devices,
    poolBalance: 0,
    totalBlocks: 0
  };
};
