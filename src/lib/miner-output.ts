export type MinerOutputKind = 'connected' | 'auth-error' | 'crash' | 'other';

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
    if (line.includes('connected') || line.includes('login succeeded') || line.includes('new job')) {
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
