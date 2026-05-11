import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Cpu, Flame, Gauge, Play, Square, Thermometer, Timer, Zap } from '../components/icons';
import { useTheme } from '../contexts/ThemeContext';
import { cn, formatHashrate } from '../lib/utils';
import { p2poolAPI } from '../services/p2poolAPI';
import { useMinerStore } from '../store/useMinerStore';
import { SolanaAuthService, useSolanaAuth } from '../services/solanaAuth';

type StressSample = {
    time: string;
    second: number;
    hashrate: number;
    temp: number | null;
    power: number | null;
};

const DURATIONS = [
    { label: '15 min', seconds: 15 * 60 },
    { label: '30 min', seconds: 30 * 60 },
    { label: '1 hour', seconds: 60 * 60 },
    { label: '4 hours', seconds: 4 * 60 * 60 }
];

const getErrorMessage = (err: any) => {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    try {
        return JSON.stringify(err);
    } catch {
        return String(err);
    }
};

const formatDuration = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(safeSeconds / 3600);
    const m = Math.floor((safeSeconds % 3600) / 60);
    const s = safeSeconds % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

const averagePositive = (values: Array<number | null | undefined>) => {
    const positive = values.filter((value): value is number =>
        typeof value === 'number' && Number.isFinite(value) && value > 0
    );
    if (!positive.length) return null;
    return positive.reduce((sum, value) => sum + value, 0) / positive.length;
};

const isPositiveNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

const StressTest: React.FC = () => {
    const { theme } = useTheme();
    const { user } = useSolanaAuth();
    const status = useMinerStore((state) => state.status);
    const setStatus = useMinerStore((state) => state.setStatus);
    const addLog = useMinerStore((state) => state.addLog);
    const wallet = useMinerStore((state) => state.wallet);
    const workerName = useMinerStore((state) => state.workerName);
    const poolUrl = useMinerStore((state) => state.poolUrl);
    const deviceType = useMinerStore((state) => state.deviceType);
    const cpuName = useMinerStore((state) => state.cpuName);
    const cpuCores = useMinerStore((state) => state.cpuCores);
    const setCpuInfo = useMinerStore((state) => state.setCpuInfo);

    const [selectedDuration, setSelectedDuration] = useState(DURATIONS[0].seconds);
    const [samples, setSamples] = useState<StressSample[]>([]);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [finalSummary, setFinalSummary] = useState<null | {
        avgHashrate: number;
        maxHashrate: number;
        avgTemp: number | null;
        maxTemp: number | null;
        avgPower: number | null;
        maxPower: number | null;
        duration: number;
    }>(null);

    const startedAtRef = useRef<number | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const stopRequestedRef = useRef(false);
    const samplesRef = useRef<StressSample[]>([]);

    const isActive = status === 'running' || status === 'starting';
    const maxStressThreads = Math.max(1, cpuCores - 1);
    const remaining = Math.max(0, selectedDuration - elapsed);

    useEffect(() => {
        const loadCpuInfo = async () => {
            try {
                const [name, cores] = await Promise.all([
                    window.electron.invoke('get-cpu-name'),
                    window.electron.invoke('get-cpu-cores')
                ]);
                setCpuInfo(name, cores);
            } catch {
                // CPU info is helpful but not required to run the stress test.
            }
        };
        loadCpuInfo();
    }, [setCpuInfo]);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    useEffect(() => {
        samplesRef.current = samples;
    }, [samples]);

    const metrics = useMemo(() => {
        const hashrates = samples.map((sample) => sample.hashrate).filter((value) => Number.isFinite(value) && value > 0);
        const temps = samples.map((sample) => sample.temp).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
        const powers = samples.map((sample) => sample.power).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

        return {
            currentHashrate: hashrates.at(-1) || 0,
            maxHashrate: hashrates.length ? Math.max(...hashrates) : 0,
            currentTemp: temps.at(-1) ?? null,
            maxTemp: temps.length ? Math.max(...temps) : null,
            currentPower: powers.at(-1) ?? null,
            maxPower: powers.length ? Math.max(...powers) : null,
            avgTemp: averagePositive(temps),
            avgPower: averagePositive(powers)
        };
    }, [samples]);

    const pollStats = async () => {
        if (!startedAtRef.current) return;

        const endpoints = [
            'http://127.0.0.1:4077/2/summary',
            'http://127.0.0.1:4077/api/v1/summary',
            'http://127.0.0.1:4077/api/stats',
            'http://127.0.0.1:4077/summary'
        ];

        let data: any = null;
        for (const url of endpoints) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 2000);
                const res = await fetch(url, { signal: controller.signal }).catch(() => null);
                clearTimeout(timeoutId);
                if (res?.ok) {
                    data = await res.json();
                    break;
                }
            } catch {
                // Try the next endpoint.
            }
        }

        if (!data) return;

        const hashrate = Number(
            data.hashrate?.total?.[0] ??
            data.hashrate?.current ??
            data.hashrate ??
            0
        );

        const [tempRes, powerRes] = await Promise.all([
            window.electron.invoke('get-cpu-temp').catch(() => null),
            window.electron.invoke('get-cpu-power').catch(() => null)
        ]);

        const temp = tempRes?.success && Number.isFinite(tempRes.temp) ? Number(tempRes.temp) : null;
        const power = powerRes?.success && Number.isFinite(powerRes.power) ? Number(powerRes.power) : null;
        if (!isPositiveNumber(temp) || !isPositiveNumber(power)) {
            setError('Stress test stopped because temperature or power telemetry became unavailable.');
            await stopStressTest();
            return;
        }
        const second = Math.floor((Date.now() - startedAtRef.current) / 1000);

        setSamples((prev) => {
            const nextSamples = [
                ...prev.slice(-719),
                {
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                    second,
                    hashrate: Number.isFinite(hashrate) ? hashrate : 0,
                    temp,
                    power
                }
            ];
            samplesRef.current = nextSamples;
            return nextSamples;
        });
    };

    const stopStressTest = async () => {
        if (stopRequestedRef.current) return;
        stopRequestedRef.current = true;

        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        timerRef.current = null;
        pollRef.current = null;
        setStatus('stopping');

        const currentSamples = samplesRef.current;
        const hashrates = currentSamples.map((sample) => sample.hashrate).filter((value) => Number.isFinite(value) && value > 0);
        const temps = currentSamples.map((sample) => sample.temp);
        const powers = currentSamples.map((sample) => sample.power);
        const duration = startedAtRef.current ? Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000)) : elapsed;

        try {
            await window.electron.invoke('save-miner-logs', {
                systemLogs: useMinerStore.getState().logs,
                minerLogs: currentSamples.map((sample) =>
                    `${sample.time} | ${formatHashrate(sample.hashrate)} | ${sample.temp ?? 'N/A'} C | ${sample.power ?? 'N/A'} W`
                ),
                sessionType: 'stress-test',
                device: 'cpu'
            }).catch(() => {});

            await window.electron.invoke('stop-benchmark', {
                avg_hashrate: hashrates.length ? hashrates.reduce((sum, value) => sum + value, 0) / hashrates.length : 0,
                max_hashrate: hashrates.length ? Math.max(...hashrates) : 0,
                wallet
            });
            if (user?.publicKey) {
                await SolanaAuthService.getInstance().reportMiningStats({
                    hashrate: hashrates.length ? hashrates.reduce((sum, value) => sum + value, 0) / hashrates.length : 0,
                    shares: currentSamples.length,
                    source: 'stress-test',
                    referenceId: `stress-test-${user.publicKey}-${Date.now()}`,
                    metadata: {
                        workerName,
                        duration,
                        samples: currentSamples.length
                    }
                }).catch((err) => {
                    console.warn('[StressTest] Failed to report mining stats:', err);
                });
            }
            addLog('Stress test stopped');
        } catch (err: any) {
            setError(getErrorMessage(err));
            addLog(`Stress test stop failed: ${getErrorMessage(err)}`);
        } finally {
            setFinalSummary({
                avgHashrate: hashrates.length ? hashrates.reduce((sum, value) => sum + value, 0) / hashrates.length : 0,
                maxHashrate: hashrates.length ? Math.max(...hashrates) : 0,
                avgTemp: averagePositive(temps),
                maxTemp: averagePositive(temps) === null ? null : Math.max(...temps.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))),
                avgPower: averagePositive(powers),
                maxPower: averagePositive(powers) === null ? null : Math.max(...powers.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))),
                duration
            });
            startedAtRef.current = null;
            stopRequestedRef.current = false;
            setStatus('completed');
        }
    };

    const startStressTest = async () => {
        if (isActive) return;
        if (!p2poolAPI.validateMoneroAddress(wallet)) {
            setError('Monero wallet address is invalid.');
            return;
        }

        setError(null);
        setFinalSummary(null);
        setSamples([]);
        setElapsed(0);
        stopRequestedRef.current = false;

        try {
            const [tempRes, powerRes] = await Promise.all([
                window.electron.invoke('get-cpu-temp').catch(() => null),
                window.electron.invoke('get-cpu-power').catch(() => null)
            ]);
            const temp = tempRes?.success && Number.isFinite(tempRes.temp) ? Number(tempRes.temp) : null;
            const power = powerRes?.success && Number.isFinite(powerRes.power) ? Number(powerRes.power) : null;
            if (!isPositiveNumber(temp) || !isPositiveNumber(power)) {
                setError(
                    'Stress test requires CPU temperature and power telemetry. Power can use a native sensor or MineBench estimated watts, but telemetry is currently unavailable on this device.'
                );
                return;
            }

            await window.electron.invoke('start-benchmark', {
                type: 'cpu',
                wallet,
                worker: `${workerName}-stress`,
                threads: maxStressThreads,
                cpuPriority: 2,
                randomxMode: 'fast',
                hugePages: true,
                donateLevel: 0,
                poolUrl,
                manualPoolSelection: true
            });

            startedAtRef.current = Date.now();
            setStatus('running');
            addLog(`Stress test started: ${formatDuration(selectedDuration)} | ${maxStressThreads}/${cpuCores} threads | Fast RandomX`);

            timerRef.current = setInterval(() => {
                if (!startedAtRef.current) return;
                const nextElapsed = Math.floor((Date.now() - startedAtRef.current) / 1000);
                setElapsed(nextElapsed);
                if (nextElapsed >= selectedDuration) {
                    stopStressTest();
                }
            }, 1000);

            pollRef.current = setInterval(pollStats, 3000);
            pollStats();
        } catch (err: any) {
            setStatus('error');
            setError(getErrorMessage(err));
            addLog(`Stress test start failed: ${getErrorMessage(err)}`);
        }
    };

    const combinedData = samples.filter((sample) =>
        isPositiveNumber(sample.hashrate) &&
        isPositiveNumber(sample.temp) &&
        isPositiveNumber(sample.power)
    );

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className={cn("text-3xl font-light tracking-tight", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                        Stress Test
                    </h1>
                    <p className={cn("text-sm mt-1", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                        Sustained CPU miner load with live temperature and wattage telemetry
                    </p>
                </div>
                <div className={cn(
                    "px-3 py-1.5 rounded-full border text-xs font-semibold",
                    isActive
                        ? 'bg-red-500/10 border-red-500/25 text-red-500'
                        : theme === 'light'
                            ? 'bg-white border-zinc-200 text-zinc-700'
                            : 'bg-white/5 border-white/10 text-zinc-400'
                )}>
                    {isActive ? 'Stress Running' : status === 'completed' ? 'Completed' : 'Ready'}
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
                <section className={cn("rounded-xl border p-5 space-y-5", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}>
                    <div>
                        <div className={cn("text-xs uppercase tracking-widest mb-3", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Duration</div>
                        <div className="grid grid-cols-2 gap-2">
                            {DURATIONS.map((duration) => (
                                <button
                                    key={duration.seconds}
                                    onClick={() => setSelectedDuration(duration.seconds)}
                                    disabled={isActive}
                                    className={cn(
                                        "h-10 rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50",
                                        selectedDuration === duration.seconds
                                            ? 'bg-yellow-500 text-zinc-950 border-yellow-500'
                                            : theme === 'light'
                                                ? 'bg-zinc-50 border-zinc-200 text-zinc-700 hover:bg-zinc-100'
                                                : 'bg-zinc-950/50 border-white/10 text-zinc-300 hover:bg-white/5'
                                    )}
                                >
                                    {duration.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={cn("rounded-lg border p-4 space-y-3", theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-zinc-950/50 border-white/10')}>
                        <div className="flex items-center justify-between text-sm">
                            <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Threads</span>
                            <span className={cn("font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{maxStressThreads} / {cpuCores || 1}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>RandomX</span>
                            <span className="font-mono text-yellow-500">Fast</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Huge Pages</span>
                            <span className="font-mono text-emerald-500">Enabled</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                            <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Priority</span>
                            <span className="font-mono text-amber-500">Normal</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <Metric label="Elapsed" value={formatDuration(elapsed)} icon={<Timer size={14} />} theme={theme} />
                        <Metric label="Remaining" value={formatDuration(remaining)} icon={<Gauge size={14} />} theme={theme} />
                        <Metric label="Temp" value={metrics.currentTemp !== null ? `${metrics.currentTemp.toFixed(0)} C` : 'N/A'} icon={<Thermometer size={14} />} theme={theme} />
                        <Metric label="Power" value={metrics.currentPower !== null ? `${metrics.currentPower.toFixed(0)} W` : 'N/A'} icon={<Zap size={14} />} theme={theme} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={startStressTest}
                            disabled={isActive}
                            className={cn(
                                "h-11 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50",
                                theme === 'light'
                                    ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                    : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                            )}
                        >
                            <Play size={16} /> Start
                        </button>
                        <button
                            onClick={stopStressTest}
                            disabled={!isActive}
                            className="h-11 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                        >
                            <Square size={16} /> Stop
                        </button>
                    </div>

                    {error && (
                        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">
                            {error}
                        </div>
                    )}
                </section>

                <section className="space-y-6 min-w-0">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <Metric label="Current Hashrate" value={formatHashrate(metrics.currentHashrate)} icon={<Cpu size={14} />} theme={theme} large />
                        <Metric label="Peak Hashrate" value={formatHashrate(metrics.maxHashrate)} icon={<Flame size={14} />} theme={theme} large />
                        <Metric label="Samples" value={`${samples.length}`} icon={<ActivityDot />} theme={theme} large />
                    </div>

                    <ChartPanel
                        title="Stress Telemetry"
                        subtitle={metrics.maxTemp !== null && metrics.maxPower !== null ? `Peak ${metrics.maxTemp.toFixed(0)} C / ${metrics.maxPower.toFixed(0)} W` : 'Waiting for telemetry'}
                        theme={theme}
                    >
                        {combinedData.length > 0 ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={combinedData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke={theme === 'light' ? '#e4e4e7' : '#27272a'} />
                                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke={theme === 'light' ? '#71717a' : '#a1a1aa'} />
                                    <YAxis yAxisId="hashrate" tick={{ fontSize: 11 }} stroke="#38bdf8" tickFormatter={(value) => formatHashrate(Number(value)).replace('/s', '')} />
                                    <YAxis yAxisId="temp" orientation="right" unit=" C" tick={{ fontSize: 11 }} stroke="#f59e0b" />
                                    <YAxis yAxisId="power" orientation="right" unit=" W" tick={{ fontSize: 11 }} stroke="#22c55e" hide />
                                    <Tooltip
                                        formatter={(value, name) => {
                                            if (name === 'hashrate') return [formatHashrate(Number(value)), 'Hashrate'];
                                            if (name === 'temp') return [`${Number(value).toFixed(1)} C`, 'Temperature'];
                                            return [`${Number(value).toFixed(1)} W`, 'Power'];
                                        }}
                                    />
                                    <Legend />
                                    <Line yAxisId="hashrate" type="monotone" dataKey="hashrate" name="hashrate" stroke="#38bdf8" strokeWidth={2.5} dot={false} />
                                    <Line yAxisId="temp" type="monotone" dataKey="temp" name="temp" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                                    <Line yAxisId="power" type="monotone" dataKey="power" name="power" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : <EmptyChart theme={theme} label="Hashrate, temperature, and power telemetry will appear here" />}
                    </ChartPanel>

                    {finalSummary && (
                        <div className={cn("rounded-xl border p-5 grid grid-cols-2 md:grid-cols-4 gap-4", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}>
                            <Metric label="Avg Hashrate" value={formatHashrate(finalSummary.avgHashrate)} icon={<Gauge size={14} />} theme={theme} />
                            <Metric label="Avg Temp" value={finalSummary.avgTemp !== null ? `${finalSummary.avgTemp.toFixed(1)} C` : 'N/A'} icon={<Thermometer size={14} />} theme={theme} />
                            <Metric label="Avg Power" value={finalSummary.avgPower !== null ? `${finalSummary.avgPower.toFixed(1)} W` : 'N/A'} icon={<Zap size={14} />} theme={theme} />
                            <Metric label="Duration" value={formatDuration(finalSummary.duration)} icon={<Timer size={14} />} theme={theme} />
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

const ActivityDot = () => <Flame size={14} />;

const Metric = ({ label, value, icon, theme, large = false }: { label: string; value: string; icon: React.ReactNode; theme: string; large?: boolean }) => (
    <div className={cn("rounded-lg border p-3", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/70 border-white/10')}>
        <div className={cn("flex items-center gap-2 text-[10px] uppercase tracking-widest", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
            {icon}
            <span>{label}</span>
        </div>
        <div className={cn("font-mono mt-1", large ? 'text-xl font-bold' : 'text-sm font-semibold', theme === 'light' ? 'text-zinc-900' : 'text-white')}>
            {value}
        </div>
    </div>
);

const ChartPanel = ({ title, subtitle, theme, children }: { title: string; subtitle: string; theme: string; children: React.ReactNode }) => (
    <div className={cn("rounded-xl border p-5", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}>
        <div className="flex items-center justify-between mb-4 gap-4">
            <h2 className={cn("text-sm font-semibold uppercase tracking-widest", theme === 'light' ? 'text-zinc-700' : 'text-zinc-300')}>{title}</h2>
            <span className={cn("text-xs font-mono", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>{subtitle}</span>
        </div>
        {children}
    </div>
);

const EmptyChart = ({ theme, label }: { theme: string; label: string }) => (
    <div className={cn("h-[260px] rounded-lg border border-dashed flex items-center justify-center text-sm", theme === 'light' ? 'border-zinc-200 bg-zinc-50 text-zinc-500' : 'border-white/10 bg-white/[0.03] text-zinc-500')}>
        {label}
    </div>
);

export default StressTest;
