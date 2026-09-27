import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import { Cpu, Flame, Gauge, Play, Square, Thermometer, Timer, Zap } from '../components/icons';
import { useTheme } from '../contexts/ThemeContext';
import { cn, formatHashrate } from '../lib/utils';
import { p2poolAPI } from '../services/p2poolAPI';
import { useCpuTelemetry } from '../services/cpuTelemetry';
import {
    formatClockGhz,
    formatPercent,
    formatRpm,
    formatTemperature,
    formatWatts,
} from '../lib/cpu-telemetry';
import type { CpuTelemetry } from '../lib/cpu-telemetry';
import { useMinerStore } from '../store/useMinerStore';
import { SolanaAuthService, useSolanaAuth } from '../services/solanaAuth';
import { nativeApi } from '../lib/native-api';

type StressSample = {
    time: string;
    /** Seconds since the session started, or -1 for a sample taken before it. */
    second: number;
    /** Whether this sample belongs to a running session, which is what the
     *  summary is computed from - the idle preview must never pollute it. */
    session: boolean;
    hashrate: number;
    temp: number | null;
    clock: number | null;
    power: number | null;
};

/**
 * The sensor series feeds the chart and the session statistics; the live tiles
 * read the current telemetry reading directly.
 */
const DURATIONS = [
    { label: '15 min', seconds: 15 * 60 },
    { label: '30 min', seconds: 30 * 60 },
    { label: '1 hour', seconds: 60 * 60 },
    { label: '4 hours', seconds: 4 * 60 * 60 }
];

/**
 * The sensor series is recorded once a second, matching the shared telemetry
 * monitor, so the chart moves every second a test runs.
 */
const SAMPLE_INTERVAL_MS = 1000;

/** Four hours at 1 Hz: the longest session the page offers. */
const SAMPLE_LIMIT = 4 * 60 * 60;

/**
 * How much of the series is drawn. A four-hour run is 14400 points, which no
 * chart renders legibly; the newest quarter hour is what a live view is for,
 * and the session statistics still cover the whole run.
 */
const CHART_WINDOW = 15 * 60;

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
    const m = Math.floor((seconds % 3600) / 60);
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

const maximum = (values: Array<number | null | undefined>) => {
    const known = values.filter((value): value is number =>
        typeof value === 'number' && Number.isFinite(value)
    );
    return known.length ? Math.max(...known) : null;
};

const StressTest: React.FC = () => {
    const { theme } = useTheme();
    const { user } = useSolanaAuth();
    const status = useMinerStore((state) => state.status);
    const setStatus = useMinerStore((state) => state.setStatus);
    const addLog = useMinerStore((state) => state.addLog);
    const wallet = useMinerStore((state) => state.wallet);
    const workerName = useMinerStore((state) => state.workerName);
    const poolUrl = useMinerStore((state) => state.poolUrl);
    const cpuCores = useMinerStore((state) => state.cpuCores);
    const setCpuInfo = useMinerStore((state) => state.setCpuInfo);

    // Shared 1 Hz CPU telemetry. Subscribing here also keeps the background
    // sampler active for the lifetime of this page and stops it on unmount.
    const cpuTelemetry = useCpuTelemetry();

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
        avgClock: number | null;
        duration: number;
    }>(null);

    const startedAtRef = useRef<number | null>(null);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const stopRequestedRef = useRef(false);
    const samplesRef = useRef<StressSample[]>([]);
    /** Last hashrate the pool reported, folded into the sensor series. */
    const hashrateRef = useRef(0);
    /**
     * The newest telemetry, readable from the sampling loop without making it
     * depend on the poll cycle.
     */
    const telemetryRef = useRef(cpuTelemetry);

    const isActive = status === 'running' || status === 'starting';
    const maxStressThreads = Math.max(1, cpuCores - 1);
    const remaining = Math.max(0, selectedDuration - elapsed);

    useEffect(() => {
        telemetryRef.current = cpuTelemetry;
    }, [cpuTelemetry]);

    useEffect(() => {
        const loadCpuInfo = async () => {
            try {
                if (!(window as any).__TAURI_INTERNALS__) return;
                const info = await nativeApi.system.getCpuInfo();
                setCpuInfo(info.name, info.cores);
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

    /**
     * Record one point per second for as long as the page is open.
     *
     * This is deliberately not part of the hashrate poll. That poll returns
     * early when the local pool API does not answer, and while it owned the
     * sampling the chart and the tiles stayed empty on a machine whose CPU
     * sensors were reporting perfectly well. The sensor series is the page's
     * subject, so it has its own clock.
     */
    useEffect(() => {
        const record = () => {
            const { telemetry, stale } = telemetryRef.current;
            const startedAt = startedAtRef.current;
            const point: StressSample = {
                time: new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }),
                second: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : -1,
                session: startedAt !== null,
                hashrate: hashrateRef.current,
                // A stale reading is reported as unavailable rather than frozen
                // and presented as live.
                temp: stale ? null : telemetry?.temperature_c ?? null,
                clock: stale ? null : telemetry?.clock_mhz ?? null,
                power: stale ? null : telemetry?.package_power_w ?? null
            };

            setSamples((prev) => {
                const next = [...prev, point].slice(-SAMPLE_LIMIT);
                samplesRef.current = next;
                return next;
            });
        };

        record();
        const id = setInterval(record, SAMPLE_INTERVAL_MS);
        return () => clearInterval(id);
    }, []);

    const sessionSamples = useMemo(() => samples.filter((sample) => sample.session), [samples]);

    const metrics = useMemo(() => {
        const hashrates = sessionSamples
            .map((sample) => sample.hashrate)
            .filter((value) => Number.isFinite(value) && value > 0);

        return {
            currentHashrate: hashrates.at(-1) || 0,
            maxHashrate: hashrates.length ? Math.max(...hashrates) : 0,
            maxTemp: maximum(sessionSamples.map((sample) => sample.temp)),
            maxPower: maximum(sessionSamples.map((sample) => sample.power))
        };
    }, [sessionSamples]);

    /**
     * What is drawn. The sensor series is plotted as it arrives, whatever the
     * pool is doing, so a machine without a hashrate still gets a live chart of
     * its temperature, frequency and power.
     */
    const chartData = useMemo(
        () =>
            samples.slice(-CHART_WINDOW).map((sample) => ({
                time: sample.time,
                temp: sample.temp,
                // Frequency is plotted in GHz so the axis it is read off is in
                // the unit the value is quoted in.
                clock_ghz: sample.clock === null ? null : sample.clock / 1000,
                power: sample.power
            })),
        [samples]
    );

    const pollHashrate = async () => {
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

        // Only the hashrate is taken from the pool. The CPU metrics in the
        // series come from the shared 1 Hz telemetry monitor, which is sampled
        // independently of this poll.
        if (Number.isFinite(hashrate) && hashrate > 0) {
            hashrateRef.current = hashrate;
        }
    };

    const stopStressTest = async () => {
        if (stopRequestedRef.current) return;
        stopRequestedRef.current = true;

        if (timerRef.current) clearInterval(timerRef.current);
        if (pollRef.current) clearInterval(pollRef.current);
        timerRef.current = null;
        pollRef.current = null;
        setStatus('stopping');

        const currentSamples = samplesRef.current.filter((sample) => sample.session);
        const hashrates = currentSamples.map((sample) => sample.hashrate).filter((value) => Number.isFinite(value) && value > 0);
        const temps = currentSamples.map((sample) => sample.temp);
        const powers = currentSamples.map((sample) => sample.power);
        const clocks = currentSamples.map((sample) => sample.clock);
        const duration = startedAtRef.current ? Math.max(1, Math.floor((Date.now() - startedAtRef.current) / 1000)) : elapsed;

        try {
            await nativeApi.miner.saveLogs({
                systemLogs: useMinerStore.getState().logs,
                minerLogs: currentSamples.map((sample) =>
                    `${sample.time} | ${formatHashrate(sample.hashrate)} | ${formatTemperature(sample.temp)} | ${formatWatts(sample.power)} | ${formatClockGhz(sample.clock)}`
                ),
                sessionType: 'stress-test',
                device: 'cpu'
            }).catch(() => {});

            await nativeApi.miner.stopBenchmark();
            if (user?.publicKey) {
                await SolanaAuthService.getInstance().reportMiningStats({
                    hashrate: hashrates.length ? hashrates.reduce((sum, value) => sum + value, 0) / hashrates.length : 0,
                    shares: 0,
                    source: 'stress-test',
                    referenceId: `stress-test-${user.publicKey}-${Date.now()}`,
                    metadata: {
                        workerName,
                        duration,
                        samples: currentSamples.length,
                        shareSource: 'pool-verified-only'
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
                maxTemp: maximum(temps),
                avgPower: averagePositive(powers),
                maxPower: maximum(powers),
                avgClock: averagePositive(clocks),
                duration
            });
            startedAtRef.current = null;
            // The series keeps running as the idle preview, but these samples
            // must not count towards the session that just ended.
            hashrateRef.current = 0;
            stopRequestedRef.current = false;
            setStatus('completed');
        }
    };

    const startStressTest = async () => {
        if (isActive) return;
        if (!user?.publicKey) {
            setError('Connect Solana wallet to track stress-test rewards.');
            return;
        }
        if (!p2poolAPI.validateMoneroAddress(wallet)) {
            setError('Monero wallet address is invalid.');
            return;
        }

        setError(null);
        setFinalSummary(null);
        setSamples([]);
        samplesRef.current = [];
        hashrateRef.current = 0;
        setElapsed(0);
        stopRequestedRef.current = false;

        try {
            // Telemetry availability is reported, never enforced: CPU temperature
            // and fan speed are hardware/provider dependent, so a machine without
            // them must still be able to run a stress test.
            const reading = cpuTelemetry.telemetry;
            if (!reading || reading.temperature_c === null) {
                addLog(
                    'CPU temperature is unavailable on this device; the stress test runs without it. See Settings › CPU Sensor Diagnostics.'
                );
            }

            // Ensure we have the latest config
            p2poolAPI.invalidateCache();
            try {
                await nativeApi.pool.getRuntimeConfig();
            } catch (configErr) {
                console.error('Failed to fetch pool config:', configErr);
            }

            await nativeApi.miner.startBenchmark({
                type: 'cpu',
                wallet,
                worker: `${workerName}-stress`,
                threads: maxStressThreads,
                cpuPriority: 2,
                randomxMode: 'fast',
                hugePages: true,
                donateLevel: 0,
                poolUrl,
                manualPoolSelection: true,
                solanaWallet: user.publicKey
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

            // Hashrate is polled from the local P2Pool API; the sensor series is
            // recorded by its own 1 Hz loop instead of being fetched here, so a
            // slow or absent pool cannot stall the chart.
            pollRef.current = setInterval(pollHashrate, 3000);
            pollHashrate();
        } catch (err: any) {
            setStatus('error');
            setError(getErrorMessage(err));
            addLog(`Stress test start failed: ${getErrorMessage(err)}`);
        }
    };

    /**
     * What the live tiles show. Always the current reading: a sample from the
     * series would be up to a second old by definition, and the point of the
     * panel is to show the hardware as it is right now. Stale telemetry is
     * reported as unavailable so frozen numbers are never presented as live.
     */
    const live: CpuTelemetry | null = cpuTelemetry.stale ? null : cpuTelemetry.telemetry;

    const chartSubtitle = isActive
        ? `Live · ${formatDuration(elapsed)} elapsed`
        : live
            ? 'Live · idle'
            : 'Waiting for CPU telemetry';

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className={cn("text-3xl font-light tracking-tight", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                        Stress Test
                    </h1>
                    <p className={cn("text-sm mt-1", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                        Sustained CPU miner load with live temperature, frequency, and power telemetry
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

            {/*
              1. The chart. It is the first thing on the page because it is what
              the run is judged by, and it plots the sensor series as it arrives
              rather than waiting for the pool to report a hashrate.
            */}
            <ChartPanel
                title="Real-Time Monitoring"
                subtitle={chartSubtitle}
                theme={theme}
            >
                {chartData.length > 1 ? (
                    <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke={theme === 'light' ? '#e4e4e7' : '#27272a'} />
                            <XAxis
                                dataKey="time"
                                tick={{ fontSize: 11 }}
                                minTickGap={28}
                                stroke={theme === 'light' ? '#71717a' : '#a1a1aa'}
                            />
                            {/* One axis per unit, each visible: temperature, frequency
                                and power live on scales that have nothing to do with
                                each other, so sharing one axis would misreport all
                                three. */}
                            <YAxis
                                yAxisId="temp"
                                orientation="left"
                                width={62}
                                unit=" °C"
                                domain={['auto', 'auto']}
                                tick={{ fontSize: 11 }}
                                stroke="#f59e0b"
                            />
                            <YAxis
                                yAxisId="clock"
                                orientation="right"
                                width={72}
                                unit=" GHz"
                                domain={['auto', 'auto']}
                                tickFormatter={(value) => Number(value).toFixed(2)}
                                tick={{ fontSize: 11 }}
                                stroke="#a78bfa"
                            />
                            <YAxis
                                yAxisId="power"
                                orientation="right"
                                width={62}
                                unit=" W"
                                domain={['auto', 'auto']}
                                tick={{ fontSize: 11 }}
                                stroke="#22c55e"
                            />
                            <Tooltip
                                formatter={(value: any, name: any) => {
                                    if (name === 'temp') return [formatTemperature(Number(value)), 'CPU Temperature'];
                                    if (name === 'clock_ghz') return [formatClockGhz(Number(value) * 1000), 'CPU Frequency'];
                                    if (name === 'power') return [formatWatts(Number(value)), 'CPU Power'];
                                    return [String(value), String(name)];
                                }}
                            />
                            <Legend />
                            <Line yAxisId="temp" type="monotone" dataKey="temp" name="temp" stroke="#f59e0b" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line yAxisId="clock" type="monotone" dataKey="clock_ghz" name="clock_ghz" stroke="#a78bfa" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                            <Line yAxisId="power" type="monotone" dataKey="power" name="power" stroke="#22c55e" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <EmptyChart theme={theme} label="CPU temperature, frequency, and power appear here as they are measured" />
                )}
            </ChartPanel>

            {/* 2. The controls, directly under the chart they act on. */}
            <section
                data-testid="stress-controls"
                className={cn("rounded-xl border p-5", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}
            >
                <div className="flex flex-col lg:flex-row lg:items-end gap-5">
                    <div className="lg:flex-1">
                        <div className={cn("text-xs uppercase tracking-widest mb-3", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Duration</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
                        <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-1 mt-3 text-xs font-mono", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                            <span>Elapsed {formatDuration(elapsed)}</span>
                            <span>Remaining {formatDuration(remaining)}</span>
                            <span>{maxStressThreads} / {cpuCores || 1} threads</span>
                            <span>RandomX Fast · Huge Pages</span>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 lg:w-[320px]">
                        <button
                            onClick={startStressTest}
                            disabled={isActive}
                            className={cn(
                                "h-12 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50",
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
                            className="h-12 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                        >
                            <Square size={16} /> Stop
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">
                        {error}
                    </div>
                )}
            </section>

            {/* 3. The numbers the controls are judged by, directly under them. */}
            <section data-testid="live-metrics" className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <LiveMetric
                    label="CPU Temperature"
                    value={formatTemperature(live?.temperature_c)}
                    detail={live?.temperature_c === null || live?.temperature_c === undefined
                        ? 'No CPU die sensor on this device'
                        : live.temperature_source ? `source: ${live.temperature_source}` : 'live'}
                    icon={<Thermometer size={16} />}
                    accent="text-amber-500"
                    theme={theme}
                />
                <LiveMetric
                    label="CPU Frequency"
                    value={formatClockGhz(live?.clock_mhz)}
                    detail={live?.clock_mhz
                        ? `${Math.round(live.clock_mhz)} MHz`
                        : 'No clock reading on this device'}
                    icon={<Gauge size={16} />}
                    accent="text-violet-400"
                    theme={theme}
                />
                <LiveMetric
                    label="CPU Power"
                    value={formatWatts(live?.package_power_w)}
                    detail={live?.package_power_w === null || live?.package_power_w === undefined
                        ? 'No package power sensor on this device'
                        : live.power_is_estimated ? 'estimated from load' : 'live'}
                    icon={<Zap size={16} />}
                    accent="text-emerald-500"
                    theme={theme}
                />
            </section>

            <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Metric label="Current Hashrate" value={formatHashrate(metrics.currentHashrate)} icon={<Cpu size={14} />} theme={theme} large />
                <Metric label="Peak Hashrate" value={formatHashrate(metrics.maxHashrate)} icon={<Flame size={14} />} theme={theme} large />
                <Metric label="Samples" value={`${sessionSamples.length}`} icon={<Flame size={14} />} theme={theme} large />
            </section>

            <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Metric label="Load" value={formatPercent(live?.utilization_percent)} icon={<Cpu size={14} />} theme={theme} />
                <Metric label="Fan" value={formatRpm(live?.fan_rpm)} icon={<Flame size={14} />} theme={theme} />
                <Metric label="Peak Temp" value={formatTemperature(metrics.maxTemp)} icon={<Thermometer size={14} />} theme={theme} />
                <Metric label="Peak Power" value={formatWatts(metrics.maxPower)} icon={<Zap size={14} />} theme={theme} />
            </section>

            <TelemetryStatusNote
                theme={theme}
                stale={cpuTelemetry.stale}
                telemetry={cpuTelemetry.telemetry}
            />

            {finalSummary && (
                <div className={cn("rounded-xl border p-5 grid grid-cols-2 md:grid-cols-6 gap-4", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}>
                    <Metric label="Avg Hashrate" value={formatHashrate(finalSummary.avgHashrate)} icon={<Gauge size={14} />} theme={theme} />
                    <Metric label="Avg Temp" value={formatTemperature(finalSummary.avgTemp)} icon={<Thermometer size={14} />} theme={theme} />
                    <Metric label="Peak Temp" value={formatTemperature(finalSummary.maxTemp)} icon={<Thermometer size={14} />} theme={theme} />
                    <Metric label="Avg Clock" value={formatClockGhz(finalSummary.avgClock)} icon={<Gauge size={14} />} theme={theme} />
                    <Metric label="Avg Power" value={formatWatts(finalSummary.avgPower)} icon={<Zap size={14} />} theme={theme} />
                    <Metric label="Duration" value={formatDuration(finalSummary.duration)} icon={<Timer size={14} />} theme={theme} />
                </div>
            )}
        </div>
    );
};

/**
 * One of the three metrics the page is read for: a large current value, its unit
 * carried by the formatter, and a line saying where it came from.
 */
const LiveMetric = ({
    label,
    value,
    detail,
    icon,
    accent,
    theme,
}: {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
    accent: string;
    theme: string;
}) => (
    <div className={cn("rounded-xl border p-5", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10')}>
        <div className={cn("flex items-center gap-2 text-[10px] uppercase tracking-widest", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
            <span className={accent}>{icon}</span>
            <span>{label}</span>
        </div>
        <div className={cn("font-mono mt-2 text-3xl font-bold tabular-nums", accent)}>{value}</div>
        <div className={cn("text-[11px] mt-1 truncate", theme === 'light' ? 'text-zinc-500' : 'text-zinc-500')} title={detail}>
            {detail}
        </div>
    </div>
);

/**
 * Explains where CPU sensors come from, and why optional ones are missing.
 * Windows exposes no generic CPU die temperature API, so a missing reading is
 * reported as unsupported instead of being faked or blocking the test.
 */
const TelemetryStatusNote = ({
    theme,
    stale,
    telemetry,
}: {
    theme: string;
    stale: boolean;
    telemetry: CpuTelemetry | null;
}) => {
    const base = cn(
        'rounded-lg border p-3 text-xs leading-relaxed',
        theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-600' : 'bg-white/[0.03] border-white/10 text-zinc-400'
    );

    if (stale) {
        return <div className={cn(base, 'text-amber-500')}>CPU telemetry is not updating; values shown are the last successful reading.</div>;
    }

    if (!telemetry) {
        return <div className={base}>Waiting for the first CPU telemetry reading…</div>;
    }

    const missingTemperature = telemetry.temperature_c === null;
    const missingFan = telemetry.fan_rpm === null;

    return (
        <div className={base}>
            <div>
                Provider: <span className="font-mono">{telemetry.provider_label}</span>
                {telemetry.temperature_source ? <> · source: <span className="font-mono">{telemetry.temperature_source}</span></> : null}
                {telemetry.power_is_estimated ? <> · power estimated from load</> : null}
                {<> · updated every second</>}
            </div>
            {telemetry.throttling ? (
                <div className="mt-1 text-amber-500">Clock is below the part's maximum under load (thermal or power limit).</div>
            ) : null}
            {missingTemperature ? (
                <div className="mt-1">
                    {telemetry.platform === 'windows' ? (
                        <>
                            CPU temperature is unavailable. Windows exposes no generic CPU die sensor; MineBench can
                            read it through its built-in helper, which needs one administrator approval. Enable it in
                            Settings › CPU Sensor Diagnostics.
                        </>
                    ) : telemetry.platform === 'linux' ? (
                        <>
                            No CPU temperature sensor was found under <span className="font-mono">/sys/class/hwmon</span>.
                            Load the kernel driver for your CPU (<span className="font-mono">k10temp</span> for AMD,{' '}
                            <span className="font-mono">coretemp</span> for Intel) and confirm <span className="font-mono">/sys</span> is mounted.
                        </>
                    ) : (
                        <>No CPU temperature sensor was reported by the system management controller on this Mac.</>
                    )}
                </div>
            ) : null}
            {!missingTemperature && !telemetry.temperature_reliable ? (
                <div className="mt-1 text-amber-500">
                    Temperature comes from an ACPI thermal zone, which can be a mainboard sensor rather than the CPU die.
                </div>
            ) : null}
            {missingFan ? (
                <div className="mt-1">
                    {telemetry.platform === 'windows' ? (
                        <>
                            No CPU fan reading. It comes from the motherboard's fan controller, which not every board
                            exposes; Settings › CPU Sensor Diagnostics lists the channels that were found.
                        </>
                    ) : (
                        <>No reliably identifiable CPU fan sensor on this device (fan tachometers are often not exposed).</>
                    )}
                </div>
            ) : (
                // How the fan was attributed to the CPU is shown, not implied:
                // no vendor publishes a header map for every board, so the
                // channel and the temperature source its curve follows are part
                // of the reading.
                telemetry.fan_source ? (
                    <div className="mt-1">
                        CPU fan: <span className="font-mono">{formatRpm(telemetry.fan_rpm)}</span> ·{' '}
                        <span className="font-mono">{telemetry.fan_source}</span>
                    </div>
                ) : null
            )}
        </div>
    );
};

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
    <div className={cn("h-[320px] rounded-lg border border-dashed flex items-center justify-center text-sm", theme === 'light' ? 'border-zinc-200 bg-zinc-50 text-zinc-500' : 'border-white/10 bg-white/[0.03] text-zinc-500')}>
        {label}
    </div>
);

export default StressTest;
