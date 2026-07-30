export type MinerOutputKind = 'connected' | 'disconnected' | 'auth-error' | 'crash' | 'other';

// Matches the standalone word "connected" but NOT "disconnected".
// A naive `includes('connected')` is true for "disconnected", which caused the
// miner to be reported as connected the moment the pool link dropped.
const CONNECTED_PATTERN = /\bconnected\b/;

export function classifyMinerOutput(message: string): MinerOutputKind {
    const line = String(message || '').toLowerCase();

    if (line.includes('login failed')) return 'auth-error';

    if (
        line.includes('fatal')
        || line.includes('exception')
        || line.includes('abort')
        || line.includes('segfault')
        || line.includes('access violation')
    ) {
        return 'crash';
    }

    // Check for a lost/failed pool connection before the "connected" check.
    // These are distinct XMRig events from a transient read/write error, which
    // is intentionally left as 'other'.
    if (
        line.includes('disconnected')
        || line.includes('connection refused')
        || line.includes('connect error')
        || line.includes('no active pools')
    ) {
        return 'disconnected';
    }

    if (CONNECTED_PATTERN.test(line) || line.includes('login succeeded') || line.includes('new job')) {
        return 'connected';
    }

    return 'other';
}

export function isTransientPoolNetworkError(message: string): boolean {
    const line = String(message || '').toLowerCase();
    return (
        line.includes('stratum')
        && (
            line.includes('connection reset by peer')
            || line.includes('read error')
            || line.includes('end of file')
            || line.includes('connection refused')
            || line.includes('connection timed out')
        )
    );
}

export function shouldMarkMinerExited(
    status: string,
    nativeRunning: boolean,
): boolean {
    return !nativeRunning && (status === 'running' || status === 'starting');
}
