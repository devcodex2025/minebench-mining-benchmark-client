type SharesSnapshot = {
    activeShares?: number;
    paidShares?: number;
} | null;

export const getVerifiedSharesTotal = (stats: SharesSnapshot): number | null => {
    if (!stats) return null;

    const activeShares = Number(stats.activeShares);
    const paidShares = Number(stats.paidShares);
    if (!Number.isFinite(activeShares) && !Number.isFinite(paidShares)) return null;

    return Math.max(Number.isFinite(activeShares) ? activeShares : 0, 0)
        + Math.max(Number.isFinite(paidShares) ? paidShares : 0, 0);
};

export const getVerifiedSharesDelta = (
    before: number | null,
    after: number | null
): number | null => {
    if (before === null || after === null || after < before) return null;
    return after - before;
};
