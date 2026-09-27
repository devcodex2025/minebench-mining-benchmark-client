export interface WarmupPreset {
    id: string;
    label: string;
    threads: number;
    cpuPriority: number;
    randomxMode: 'fast' | 'light';
    hugePages: boolean;
}

export interface WarmupResult {
    preset: WarmupPreset;
    hashrate: number;
    samples: number;
    error?: string;
}

export interface WarmupProgress {
    phase: 'starting' | 'settling' | 'sampling' | 'selecting' | 'ready';
    preset: WarmupPreset;
    index: number;
    total: number;
    seconds: number;
    results: WarmupResult[];
}

export function buildWarmupPresets(cores: number, safeMode: boolean): WarmupPreset[] {
    const count = Number.isFinite(cores) ? Math.max(1, Math.floor(cores)) : 1;
    const threads = safeMode ? [count] : [...new Set([Math.max(1, Math.floor(count / 2)), Math.max(1, Math.floor(count * 0.75)), count])];
    return threads.map(value => ({
        id: `threads-${value}`,
        label: safeMode ? 'Low-memory' : value === count ? 'All threads' : `${Math.round(value / count * 100)}% threads`,
        threads: value,
        cpuPriority: 2,
        randomxMode: safeMode ? 'light' : 'fast',
        hugePages: !safeMode,
    }));
}

export function selectWarmupWinner(results: WarmupResult[]): WarmupResult | undefined {
    return results.filter(result => !result.error && result.samples >= 3 && Number.isFinite(result.hashrate) && result.hashrate > 0)
        .reduce<WarmupResult | undefined>((best, result) => !best || result.hashrate > best.hashrate ? result : best, undefined);
}

function waitForWarmup(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
        signal.addEventListener('abort', abort, { once: true });
    });
}

// Compare fresh 10-second miner averages after settling; never score initialization or missing data.
export async function runBenchmarkWarmup(options: {
    presets: WarmupPreset[];
    signal: AbortSignal;
    start: (preset: WarmupPreset) => Promise<void>;
    sample: () => { hashrate: number; sampledAt: number } | null;
    progress: (progress: WarmupProgress) => void;
    now?: () => number;
    wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<WarmupResult> {
    const { presets, signal, start, sample, progress } = options;
    const now = options.now ?? Date.now;
    const wait = options.wait ?? waitForWarmup;
    const results: WarmupResult[] = [];
    let runningPreset: string | undefined;
    const measure = async (preset: WarmupPreset, index: number, score: boolean) => {
        signal.throwIfAborted();
        progress({ phase: score ? 'starting' : 'selecting', preset, index, total: presets.length, seconds: 0, results: [...results] });
        runningPreset = undefined;
        await start(preset);
        signal.throwIfAborted();
        runningPreset = preset.id;
        const started = now();
        let firstHashrateAt: number | null = null;
        let lastSampleAt = -1;
        const samples: number[] = [];
        while (now() - started < 150_000) {
            signal.throwIfAborted();
            const current = sample();
            const fresh = current && current.sampledAt >= started && current.sampledAt <= now() && now() - current.sampledAt < 10_000 && current.hashrate > 0 && Number.isFinite(current.hashrate);
            if (fresh && firstHashrateAt === null) firstHashrateAt = now();
            const elapsed = firstHashrateAt === null ? 0 : now() - firstHashrateAt;
            const settling = firstHashrateAt === null || elapsed < 15_000;
            progress({ phase: settling ? 'settling' : 'sampling', preset, index, total: presets.length,
                seconds: Math.floor((settling ? now() - started : elapsed - 15_000) / 1000), results: [...results] });
            if (!settling && fresh && current.sampledAt > lastSampleAt) {
                lastSampleAt = current.sampledAt;
                samples.push(current.hashrate);
                if (!score) return { preset, hashrate: current.hashrate, samples: 1 };
            }
            if (elapsed >= 39_000 && samples.length >= 3) {
                return { preset, hashrate: samples.reduce((sum, value) => sum + value, 0) / samples.length, samples: samples.length };
            }
            await wait(1000, signal);
        }
        throw new Error('No stable hashrate samples within 150 seconds. Check miner and pool connection.');
    };
    for (let index = 0; index < presets.length; index++) {
        try {
            results.push(await measure(presets[index], index, true));
        } catch (error) {
            signal.throwIfAborted();
            results.push({ preset: presets[index], hashrate: 0, samples: 0, error: error instanceof Error ? error.message : String(error) });
        }
    }
    const winner = selectWarmupWinner(results);
    if (!winner) throw new Error('Warm-up failed: no preset produced enough hashrate samples. Check the miner log and retry.');
    if (winner.preset.id !== runningPreset) await measure(winner.preset, presets.findIndex(preset => preset.id === winner.preset.id), false);
    signal.throwIfAborted();
    progress({ phase: 'ready', preset: winner.preset, index: presets.length, total: presets.length, seconds: 0, results: [...results] });
    return winner;
}
