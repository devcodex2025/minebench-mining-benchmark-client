const GIB = 1024 * 1024 * 1024;

export interface BenchmarkSystemCapabilities {
    cores: number;
    ramBytes: number;
}

export interface BenchmarkSafetyMode {
    enabled: boolean;
    threads: number;
    reasons: string[];
}

export function getBenchmarkSafetyMode(system: BenchmarkSystemCapabilities): BenchmarkSafetyMode {
    const cores = Math.max(1, Math.floor(system.cores || 1));
    const hasKnownRam = system.ramBytes > 0;
    const ramGiB = hasKnownRam ? system.ramBytes / GIB : 0;
    const enabled = hasKnownRam && ramGiB <= 4 && cores <= 2;
    const reasons = enabled
        ? ['4 GB RAM or less and 2 or fewer CPU threads']
        : [];

    return {
        enabled,
        threads: cores,
        reasons
    };
}
