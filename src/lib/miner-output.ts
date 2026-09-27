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

export function getAcceptedShareCount(summary: any): number {
    const candidates = [
        summary?.results?.shares_good,
        summary?.results?.accepted,
        summary?.connection?.accepted,
        summary?.shares?.accepted,
        summary?.accepted,
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value >= 0) return Math.floor(value);
    }

    return 0;
}

export function getCpuHashrate(summary: any): number {
    const candidates = [
        summary?.hashrate?.total?.[0],
        summary?.hashrate?.current,
        typeof summary?.hashrate === 'number' ? summary.hashrate : undefined,
    ];

    for (const candidate of candidates) {
        const value = Number(candidate);
        if (Number.isFinite(value) && value > 0) return value;
    }

    return 0;
}

export function getAcceptedShareCountFromOutput(message: string): number | null {
    const match = String(message || '').match(/\baccepted\s*\((\d+)\s*\/\s*\d+\)/i);
    if (!match) return null;

    const value = Number(match[1]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

export function shouldStartBenchmarkMeasurement(
    acceptedShares: number,
    measurementStarted: boolean,
    stopInFlight: boolean,
): boolean {
    return acceptedShares > 0 && !measurementStarted && !stopInFlight;
}

export function shouldAutoStopBenchmark(
    timeLeft: number | null,
    isActive: boolean,
    measurementStarted: boolean,
    stopInFlight: boolean,
): boolean {
    return timeLeft === 0 && isActive && measurementStarted && !stopInFlight;
}
