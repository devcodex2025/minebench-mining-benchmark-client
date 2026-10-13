export const REWARDS_DISTRIBUTED_EVENT = 'minebench:rewards-distributed';
export const PAYOUT_COMPLETED_EVENT = 'minebench:payout-completed';

export const notifyRewardsDistributed = () => {
  window.dispatchEvent(new Event(REWARDS_DISTRIBUTED_EVENT));
};

export const notifyPayoutCompleted = () => {
  window.dispatchEvent(new Event(PAYOUT_COMPLETED_EVENT));
};
