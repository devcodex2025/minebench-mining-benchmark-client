export type MinerMsrStatus = 'unknown' | 'enabled' | 'unavailable';

const ANSI_ESCAPE = /\x1B\[[0-?]*[ -\/]*[@-~]/g;

/**
 * Extract the result of XMRig's attempt to apply the RandomX MSR preset.
 * XMRig reports this only during miner startup, so the absence of a line must
 * stay unknown rather than being interpreted as disabled.
 */
export function getMinerMsrStatusFromOutput(message: string): MinerMsrStatus | null {
    const line = String(message || '').replace(ANSI_ESCAPE, '').toLowerCase();
    if (!line.includes('msr')) return null;

    if (
        line.includes('failed to apply msr mod')
        || line.includes('cannot set msr')
        || line.includes('cannot read msr')
        || line.includes('msr mod failed')
    ) {
        return 'unavailable';
    }

    if (/msr\s+register values.*(has been )?set successfully/.test(line)) {
        return 'enabled';
    }

    return null;
}
