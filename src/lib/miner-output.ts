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

export function shouldMarkMinerExited(
    status: string,
    nativeRunning: boolean,
): boolean {
    return !nativeRunning && (status === 'running' || status === 'starting');
}
