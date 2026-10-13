export interface ShareDetectionState {
    /** -1 = not yet initialized (no data received this session) */
    lastShareCount: number;
}

export interface ShareDetectionResult {
    shouldAnimate: boolean;
    newLastShareCount: number;
}

/**
 * Determines whether a "Share Found" animation should fire given an incoming
 * P2Pool share-event marker and the previous session maximum.
 *
 * Rules:
 * - First observation (lastShareCount < 0): initialize the reference; no animation.
 *   This prevents spurious animations for shares found in a previous session.
 * - Subsequent observations: animate only when the count strictly increases.
 */
export function detectNewShare(
    incomingShares: number,
    state: ShareDetectionState
): ShareDetectionResult {
    const { lastShareCount } = state;

    if (lastShareCount < 0) {
        return { shouldAnimate: false, newLastShareCount: incomingShares };
    }

    if (incomingShares > lastShareCount) {
        return { shouldAnimate: true, newLastShareCount: incomingShares };
    }

    return { shouldAnimate: false, newLastShareCount: lastShareCount };
}
