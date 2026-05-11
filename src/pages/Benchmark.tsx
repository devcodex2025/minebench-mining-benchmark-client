import React, { useEffect, useRef, useState } from 'react';
import { useMinerStore, DeviceType } from '../store/useMinerStore';
import { SolanaAuthService, useSolanaAuth } from '../services/solanaAuth';
import { MultiDeviceSyncService } from '../services/multiDeviceSync';
import { useTheme } from '../contexts/ThemeContext';
import { Play, Square, Cpu, Monitor, Timer, Zap } from '../components/icons';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { cn, formatHashrate } from '../lib/utils';
import { getEnvironmentConfig } from '../config/environment';

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

const Benchmark = () => {
    const { theme } = useTheme();
    const { user } = useSolanaAuth();
    // Select state individually to avoid unnecessary re-renders
    const status = useMinerStore(state => state.status);
    const setStatus = useMinerStore(state => state.setStatus);
    const addLog = useMinerStore(state => state.addLog);
    const deviceType = useMinerStore(state => state.deviceType);
    const setDeviceType = useMinerStore(state => state.setDeviceType);
    const wallet = useMinerStore(state => state.wallet);
    const workerName = useMinerStore(state => state.workerName);
    const updateStats = useMinerStore(state => state.updateStats);
    const history = useMinerStore(state => state.history);
    const currentHashrate = useMinerStore(state => state.currentHashrate);
    const currentTemp = useMinerStore(state => state.currentTemp);
    const currentPower = useMinerStore(state => state.currentPower);
    const resetSession = useMinerStore(state => state.resetSession);
    const pools = useMinerStore(state => state.pools);


    const [duration, setDuration] = useState<number>(60);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);
    const [finalResults, setFinalResults] = useState<{avg: number, max: number} | null>(null);
    const [sysInfo, setSysInfo] = useState<{cpu: string, cores: number, ram: string} | null>(null);
    const [showAuthWarning, setShowAuthWarning] = useState(false);
    const [pendingStart, setPendingStart] = useState(false);
    const env = getEnvironmentConfig();
    const primaryPool = pools?.['cpu'];
    const reservePool = env.enableBackupPool ? pools?.['cpu-backup'] : undefined;
    const isNodeFullySynced = env.enableBackupPool
        ? !!((primaryPool?.isSynced && primaryPool?.progress >= 99.9) || (reservePool?.isSynced && reservePool?.progress >= 99.9))
        : !!(primaryPool?.isSynced && primaryPool?.progress >= 99.9);


    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const statsIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const isBenchmarkPollingRef = useRef(false);
    const lastBenchmarkRewardReportAtRef = useRef(0);
    const benchmarkRewardSeqRef = useRef(0);
    // Keep local tracks for final calculation to avoid dependency on store sampling rate
    const localStatsRef = useRef<number[]>([]); 
    const benchmarkApiStateRef = useRef<{ connectedUrl: string | null; errorLogged: boolean }>({
        connectedUrl: null,
        errorLogged: false
    });

    const isSolanaConnected = !!user?.publicKey;

    // Multi-Device Sync initialization
    useEffect(() => {
        if (!isSolanaConnected || !user?.publicKey) return;

        const syncService = MultiDeviceSyncService.getInstance(user.publicKey);
        
        // Register this device if not already registered
        let deviceId = localStorage.getItem('minebench_device_id');
        if (!deviceId) {
            deviceId = `device-${Math.random().toString(36).substring(2, 15)}`;
            localStorage.setItem('minebench_device_id', deviceId);
        }

        syncService.registerDevice({
            deviceId,
            deviceName: `${sysInfo?.cpu || 'Unknown CPU'} (${workerName})`,
            walletPublicKey: user.publicKey,
            currentHashrate: 0,
            totalHashesComputed: 0,
            totalShares: 0,
            accumulatedRewards: 0,
            uptime: 0,
            lastUpdate: Date.now(),
            mode: status === 'running' ? 'benchmark' : 'idle'
        });

        // Start sync loop
        syncService.startSyncLoop();

        return () => {
            syncService.stopSyncLoop();
        };
    }, [isSolanaConnected, user?.publicKey, sysInfo?.cpu, workerName, status]);

    // Load System Info
    useEffect(() => {
        const loadSysInfo = async () => {
            try {
                if (!window.electron?.invoke) return;
                
                const cpu = await window.electron.invoke('get-cpu-name');
                const cores = await window.electron.invoke('get-cpu-cores');
                const stats = await window.electron.invoke('get-system-stats');
                
                // Format RAM to GB
                const ramGB = stats && stats.ramTotal 
                    ? (stats.ramTotal / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
                    : 'N/A';

                setSysInfo({
                    cpu: cpu || 'Unknown CPU',
                    cores: cores || 0,
                    ram: ramGB
                });
            } catch (e) {
                console.error("Failed to load sys info", e);
            }
        };
        loadSysInfo();
    }, []);

    // Auto-stop when timer reaches 0
    useEffect(() => {
        if (timeLeft === 0 && status === 'running') {
            stopBenchmark();
        }
    }, [timeLeft, status]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            isBenchmarkPollingRef.current = false;
            if (timerRef.current) clearInterval(timerRef.current);
            if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        };
    }, []);

    useEffect(() => {
        if (status !== 'running' || !user?.publicKey) return;

        const now = Date.now();
        if (now - lastBenchmarkRewardReportAtRef.current < 15000) return;

        const seq = ++benchmarkRewardSeqRef.current;
        lastBenchmarkRewardReportAtRef.current = now;

        SolanaAuthService.getInstance()
            .reportMiningStats({
                hashrate: currentHashrate,
                shares: localStatsRef.current.length,
                source: 'benchmark',
                referenceId: `benchmark-${user.publicKey}-${now}-${seq}`,
                metadata: {
                    deviceType,
                    workerName,
                    duration,
                    samples: localStatsRef.current.length
                }
            })
            .then(() => SolanaAuthService.getInstance().fetchMiningStats(user.publicKey))
            .catch((err) => {
                console.warn('[Benchmark] Failed to report mining stats:', err);
            });
    }, [status, user?.publicKey, currentHashrate, deviceType, workerName, duration]);

    // Listen for miner events
    useEffect(() => {
        if (!window.electron.on) {
            console.warn("window.electron.on is not defined. Restart Electron to apply preload changes.");
            return;
        }

        const cleanupLog = window.electron.on('miner-log', (msg) => {
            const message = String(msg || '').trim();
            console.log(`Miner: ${message}`);
            if (message) addLog(message);
        });
        
        const cleanupError = window.electron.on('miner-error', (msg) => {
            console.error(`Miner Error: ${msg}`);
            addLog(`Error: ${msg}`);
            // If critical error, stop
            if (msg.includes('CuDa') || msg.includes('error') || msg.includes('exited')) {
               setStatus('error');
            }
        });

        const cleanupExit = window.electron.on('miner-exit', ({ code, signal }) => {
            console.log(`Miner exited with code ${code}`);
            if (code !== 0 && status === 'running') {
                 setStatus('error');
                 addLog(`Miner exited unexpectedly (Code: ${code})`);
            } else if (status === 'stopping') {
                 setStatus('completed');
            }
        });

        return () => {
            if (cleanupLog) cleanupLog();
            if (cleanupError) cleanupError();
            if (cleanupExit) cleanupExit();
        };
    }, [status, setStatus, addLog]);

    const startBenchmark = async () => {
        if (status === 'running') return;
        if (!isNodeFullySynced) {
            addLog('Node is not fully synced (100%). Benchmark is disabled until sync completes.');
            return;
        }

        // Check if user is authenticated
        if (!user?.publicKey) {
            setShowAuthWarning(true);
            setPendingStart(true);
            return;
        }

        // User is authenticated, proceed with benchmark
        await runBenchmark();
    };

    const runBenchmark = async () => {
        resetSession();
        isBenchmarkPollingRef.current = true;
        localStatsRef.current = [];
        lastBenchmarkRewardReportAtRef.current = 0;
        benchmarkRewardSeqRef.current = 0;
        benchmarkApiStateRef.current = { connectedUrl: null, errorLogged: false };
        setFinalResults(null);
        setTimeLeft(duration);
        setShowAuthWarning(false);
        
        try {
            const res = await window.electron.invoke("start-benchmark", { 
                type: deviceType, 
                wallet, 
                worker: workerName,
                solanaWallet: user?.publicKey // Raw Solana address (no encoding)
            });
            
            setStatus('running');
            addLog(`Benchmark started: ${deviceType.toUpperCase()} | ${duration}s`);
            
            // Start Countdown
            timerRef.current = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev === null || prev <= 1) {
                        return 0; // Will trigger useEffect to stop
                    }
                    return prev - 1;
                });
            }, 1000);

            // Start Polling Stats
            statsIntervalRef.current = setInterval(() => fetchStats(), 3000);
            fetchStats(true);

        } catch (err: any) {
            isBenchmarkPollingRef.current = false;
            console.error(err);
            setStatus('error');
            addLog(`Error starting benchmark: ${getErrorMessage(err)}`);
        }
    };

    const handleAuthWarningContinue = () => {
        // User chose to continue without authentication
        setShowAuthWarning(false);
        setPendingStart(false);
        runBenchmark();
    };

    const handleAuthWarningConnect = async () => {
        // User chose to connect wallet
        setShowAuthWarning(false);
        setPendingStart(false);
        // Trigger wallet connection (assuming there's an IPC method or similar)
        try {
            await window.electron.ipcRenderer.invoke('solana-connect-wallet');
            // After successful connection, auto-start benchmark
            await runBenchmark();
        } catch (err) {
            console.error('Wallet connection failed:', err);
            addLog('Wallet connection cancelled');
        }
    };

    const averagePositive = (values: Array<number | null | undefined>) => {
        const positive = values.filter((value): value is number =>
            typeof value === 'number' && Number.isFinite(value) && value > 0
        );
        if (positive.length === 0) return null;
        return positive.reduce((sum, value) => sum + value, 0) / positive.length;
    };

    const submitBenchmarkResult = async (avg: number, max: number) => {
        if (!Number.isFinite(avg) || avg <= 0) {
            addLog('Benchmark result was not submitted: no positive hashrate samples were captured.');
            return;
        }

        const state = useMinerStore.getState();
        const deviceId = localStorage.getItem('minebench_device_id') || undefined;
        const elapsedSeconds = Math.max(1, duration - (timeLeft ?? duration));
        const avgTemp = averagePositive(state.history.map((point) => point.temp));
        const avgPower = averagePositive(state.history.map((point) => point.power));
        const record = {
            avg_hashrate: avg,
            max_hashrate: Number.isFinite(max) && max > 0 ? max : avg,
            duration_seconds: elapsedSeconds,
            device_type: deviceType.toUpperCase(),
            device_name: deviceType === 'cpu' ? (sysInfo?.cpu || 'Unknown CPU') : 'Unknown GPU',
            avg_temp: avgTemp,
            avg_power: avgPower,
            algorithm: deviceType === 'cpu' ? 'RandomX' : 'KawPow',
            coin_name: deviceType === 'cpu' ? 'XMR' : 'RVN',
            solana_wallet_address: user?.publicKey || null,
            device_uid: deviceId || `${deviceType}-${sysInfo?.cpu || workerName}`,
            created_at: new Date().toISOString()
        };

        const result = await window.electron.invoke('submit-benchmark-result', record) as any;
        const submittedId = result?.benchmark?.id;
        const submittedBenchmark = { ...record, ...(result?.benchmark || {}) };
        localStorage.setItem('minebench_latest_benchmark', JSON.stringify(submittedBenchmark));
        window.dispatchEvent(new CustomEvent('minebench:benchmark-submitted', {
            detail: submittedBenchmark
        }));
        addLog(`Benchmark result submitted${submittedId ? ` (#${submittedId})` : ''}.`);
    };

    const stopBenchmark = async () => {
        await fetchStats(true);
        isBenchmarkPollingRef.current = false;
        if (timerRef.current) clearInterval(timerRef.current);
        if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        
        setStatus('stopping');
        
        // Calculate Results
        const storeHistory = useMinerStore.getState().history || [];
        const samples = [
            ...localStatsRef.current,
            ...storeHistory.map((point) => point.hashrate)
        ].filter((value) => Number.isFinite(value) && value > 0);
        let avg = 0;
        let max = 0;
        
        if (samples.length > 0) {
             const sum = samples.reduce((a, b) => a + b, 0);
             avg = sum / samples.length;
             max = Math.max(...samples);
        } else {
             const latestHashrate = useMinerStore.getState().currentHashrate;
             if (latestHashrate > 0) {
                 avg = latestHashrate;
                 max = latestHashrate;
             }
        }
        
        setFinalResults({ avg, max });

        try {
            // Save logs to disk before stopping
            const { logs: storeLogs } = useMinerStore.getState();
            if (window.electron?.invoke) {
                await window.electron.invoke('save-miner-logs', {
                    systemLogs: storeLogs,
                    minerLogs: [],
                    sessionType: 'benchmark',
                    device: deviceType
                }).catch((err: any) => {
                    console.warn('Failed to save logs:', err);
                });
            }

            const payload = {
                avg_hashrate: avg,
                max_hashrate: max,
                wallet: user?.publicKey || null
            };

            await submitBenchmarkResult(avg, max).catch((err: any) => {
                console.error('[Benchmark] Submit failed:', err);
                addLog(`Benchmark finished, but submit failed: ${getErrorMessage(err)}`);
            });
             
            console.log('[Benchmark] Sending to stop-benchmark:', payload);
            const result = await window.electron.invoke("stop-benchmark", payload);
            console.log('[Benchmark] stop-benchmark result:', result);
            setStatus('completed');
            addLog(`Benchmark finished. Avg: ${formatHashrate(avg)}`);
        } catch (err: any) {
            console.error('[Benchmark] Error stopping:', err);
            addLog(`Error stopping benchmark: ${getErrorMessage(err)}`);
            setStatus('error');
        }
    };

    const fetchStats = async (force = false) => {
        if (!force && !isBenchmarkPollingRef.current && useMinerStore.getState().status !== 'running') return;

        try {
            const endpoints = deviceType === 'cpu'
                ? [
                    'http://127.0.0.1:4077/2/summary',
                    'http://127.0.0.1:4077/api/v1/summary',
                    'http://127.0.0.1:4077/api/stats',
                    'http://127.0.0.1:4077/summary'
                ]
                : [
                    'http://127.0.0.1:4067/summary',
                    'http://127.0.0.1:4067/api/v1/summary'
                ];

            let data: any = null;
            let successUrl: string | null = null;

            for (const actualUrl of endpoints) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    const res = await fetch(actualUrl, { signal: controller.signal }).catch(() => null);
                    clearTimeout(timeoutId);

                    if (res && res.ok) {
                        data = await res.json();
                        successUrl = actualUrl;
                        break;
                    }
                } catch {
                    // Try the next endpoint.
                }
            }

            if (!data) {
                if (!benchmarkApiStateRef.current.errorLogged) {
                    addLog(`Waiting for miner API... tried ${endpoints.length} endpoint(s)`);
                    benchmarkApiStateRef.current.errorLogged = true;
                }
                return;
            }

            if (successUrl && benchmarkApiStateRef.current.connectedUrl !== successUrl) {
                benchmarkApiStateRef.current = { connectedUrl: successUrl, errorLogged: false };
                addLog(`Connected to miner API: ${successUrl}`);
            }

            let hr = 0;
            let temp: number | null = null;
            let power: number | null = null;

            if (deviceType === 'cpu') {
                hr = data.hashrate?.total?.[0] ??
                    data.hashrate?.current ??
                    data.hashrate ??
                    0;

                const [tempRes, powerRes] = await Promise.all([
                    window.electron.invoke('get-cpu-temp'),
                    window.electron.invoke('get-cpu-power')
                ]);

                if (tempRes && tempRes.success) temp = tempRes.temp;
                if (powerRes && powerRes.success) power = powerRes.power;

                window.electron.invoke('report-stats', { temp, power }).catch(() => { });

                // Update multi-device sync
                if (user?.publicKey) {
                    const deviceId = localStorage.getItem('minebench_device_id');
                    if (deviceId) {
                        MultiDeviceSyncService.getInstance(user.publicKey).updateDevice(deviceId, {
                            currentHashrate: hr,
                            temperature: temp || undefined,
                            power: power || undefined,
                            accumulatedRewards: 0,
                            mode: 'benchmark'
                        });
                    }
                }
            } else if (data.gpus && data.gpus.length > 0) {
                const sensorFallback = await window.electron.invoke('get-gpu-sensors').catch(() => null);
                hr = data.gpus[0].hashrate ?? data.gpus[0].hash ?? 0;
                temp = data.gpus[0].temperature ?? data.gpus[0].temp ?? sensorFallback?.temp ?? null;
                power = data.gpus[0].power ?? sensorFallback?.power ?? null;
                window.electron.invoke('report-stats', { temp, power }).catch(() => { });

                // Update multi-device sync
                if (user?.publicKey) {
                    const deviceId = localStorage.getItem('minebench_device_id');
                    if (deviceId) {
                        MultiDeviceSyncService.getInstance(user.publicKey).updateDevice(deviceId, {
                            currentHashrate: hr,
                            temperature: temp || undefined,
                            power: power || undefined,
                            accumulatedRewards: 0,
                            mode: 'benchmark'
                        });
                    }
                }
            }

            if (hr > 0) {
                updateStats(hr, temp, power ?? undefined);
                localStatsRef.current.push(hr);
                console.debug(`[Benchmark] Hashrate update: ${formatHashrate(hr)} | Temp: ${temp ?? 'n/a'}°C`);
            }
        } catch (e: any) {
            console.warn('[Benchmark] fetchStats failed:', e?.message || e);
        }
    };

    return (
        <div className="space-y-6 max-w-5xl mx-auto">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className={cn("text-3xl font-light", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Benchmark Mode</h1>
                    <p className="text-zinc-500 mt-1">Test your hardware capabilities and estimate rewards.</p>
                </div>

                <div className="flex flex-col items-end gap-2">
                    <div className={cn("p-1 rounded-lg border flex gap-1",
                        theme === 'light'
                            ? 'bg-white border-zinc-200'
                            : 'bg-zinc-900 border-white/5'
                    )}>
                        <button 
                            onClick={() => status !== 'running' && setDeviceType('cpu')}
                            className={cn(
                                "px-4 py-2 rounded-md text-sm font-medium flex items-center gap-2 transition-all",
                                deviceType === 'cpu'
                                    ? (theme === 'light' ? "bg-white text-zinc-900 border border-zinc-300 shadow-sm" : "bg-zinc-800 text-white shadow-sm")
                                    : (theme === 'light' ? "text-zinc-600 hover:bg-zinc-100" : "text-zinc-500 hover:text-zinc-300")
                            )}
                        >
                            <Cpu size={16} /> Monero (CPU)
                        </button>
                    </div>
                </div>
            </div>

            {/* Main Stats Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Control Card */}
                <div className="lg:col-span-1 space-y-4">
                    <div className={cn("border rounded-xl p-6",
                      theme === 'light'
                        ? 'bg-white border-zinc-200'
                        : 'bg-zinc-900/50 border-white/5'
                    )}>
                        {/* System Info Block */}
                        {sysInfo && (
                            <div className={cn("mb-6 pb-6 border-b border-dashed", 
                                theme === 'light' ? 'border-zinc-200' : 'border-white/5'
                            )}>
                                <div className="space-y-3">
                                    <div className="flex items-start gap-3">
                                        <div className={cn("p-2 rounded-md", 
                                            theme === 'light' ? "bg-zinc-100/80" : "bg-white/5"
                                        )}>
                                            <Cpu className={cn("w-4 h-4", theme === 'light' ? "text-zinc-600" : "text-zinc-400")} />
                                        </div>
                                        <div>
                                            <div className={cn("text-xs font-medium uppercase tracking-wider mb-1", 
                                                theme === 'light' ? "text-zinc-500" : "text-zinc-500"
                                            )}>Processor</div>
                                            <div className={cn("text-sm font-medium leading-tight", 
                                                theme === 'light' ? "text-zinc-800" : "text-zinc-200"
                                            )}>
                                                {sysInfo.cpu}
                                                <span className={cn("ml-2 text-xs", theme === 'light' ? "text-zinc-400" : "text-zinc-500")}>
                                                    ({sysInfo.cores} Cores)
                                                </span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-start gap-3">
                                        <div className={cn("p-2 rounded-md", 
                                            theme === 'light' ? "bg-zinc-100/80" : "bg-white/5"
                                        )}>
                                            <Zap className={cn("w-4 h-4", theme === 'light' ? "text-zinc-600" : "text-zinc-400")} />
                                        </div>
                                        <div>
                                            <div className={cn("text-xs font-medium uppercase tracking-wider mb-1", 
                                                theme === 'light' ? "text-zinc-500" : "text-zinc-500"
                                            )}>Memory</div>
                                            <div className={cn("text-sm font-medium", 
                                                theme === 'light' ? "text-zinc-800" : "text-zinc-200"
                                            )}>
                                                {sysInfo.ram} RAM
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-between items-center mb-6">
                            <span className={cn("text-sm font-medium", theme === 'light' ? 'text-zinc-700' : 'text-zinc-400')}>Session Duration</span>
                            <select 
                                value={duration}
                                onChange={(e) => setDuration(Number(e.target.value))}
                                disabled={status === 'running'}
                                className={cn("border rounded px-2 py-1 text-sm outline-none focus:border-emerald-500/50",
                                  theme === 'light'
                                    ? 'bg-zinc-100 border-zinc-300 text-zinc-900'
                                    : 'bg-zinc-950 border-zinc-800 text-zinc-300'
                                )}>
                                <option value={60}>1 Minute</option>
                                <option value={180}>3 Minutes</option>
                                <option value={300}>5 Minutes</option>
                            </select>
                        </div>

                        <div className={cn("mb-8 flex flex-col items-center justify-center py-6 border-b border-dashed",
                          theme === 'light' ? 'border-zinc-200' : 'border-white/5'
                        )}>
                             <div className={cn("text-5xl font-mono font-light tracking-tighter",
                               theme === 'light' ? 'text-zinc-900' : 'text-white'
                             )}>
                                {status === 'running' && timeLeft !== null ? timeLeft : duration}
                                <span className={cn("text-lg ml-1", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}> s</span>
                             </div>
                             <span className="text-xs text-zinc-500 mt-2 uppercase tracking-widest">
                                {status === 'running' ? 'Time Remaining' : 'Duration'}
                             </span>
                        </div>

                        <button
                            onClick={status === 'running' ? stopBenchmark : startBenchmark}
                            disabled={status === 'stopping' || (!isNodeFullySynced && status !== 'running')}
                            className={cn(
                                "w-full py-4 rounded-lg font-bold text-sm tracking-wide transition-all transform active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed",
                                status === 'running' 
                                    ? "bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20"
                                    : (theme === 'light'
                                        ? "bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-[0_0_20px_rgba(16,185,129,0.25)]"
                                        : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]")
                            )}
                        >
                            <div className="flex items-center justify-center gap-2">
                                {status === 'running' ? (
                                    <><Square size={18} fill="currentColor" /> STOP TEST</>
                                ) : (
                                    <><Play size={18} fill="currentColor" /> START BENCHMARK</>
                                )}
                            </div>
                        </button>

                        {!isNodeFullySynced && status !== 'running' && (
                            <div className={cn("mt-3 p-3 rounded-lg border text-xs",
                                theme === 'light'
                                    ? 'bg-yellow-50 border-yellow-200 text-yellow-700'
                                    : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400'
                            )}>
                                Node sync must be 100% to start benchmark.
                            </div>
                        )}

                        {/* Status Indicator */}
                        {status === 'running' && (
                            <div className={cn("p-3 rounded-lg border text-xs",
                                theme === 'light'
                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                    : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                            )}>
                                <div className="flex items-center gap-2 mb-1">
                                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                                    <span className="font-semibold">Benchmark Running</span>
                                </div>
                                <p className="text-xs opacity-75">
                                    {currentHashrate > 0 
                                        ? `Mining at ${formatHashrate(currentHashrate)} - Check chart for updates`
                                        : `Waiting for miner to start... (checking port ${deviceType === 'cpu' ? '4077' : '4067'})`
                                    }
                                </p>
                            </div>
                        )}

                        {status === 'error' && (
                            <div className={cn("p-3 rounded-lg border text-xs",
                                theme === 'light'
                                    ? 'bg-red-50 border-red-200 text-red-700'
                                    : 'bg-red-500/10 border-red-500/30 text-red-400'
                            )}>
                                <p className="font-semibold mb-1">Benchmark Error</p>
                                <p className="text-xs opacity-75">
                                    Check console (F12) for details. Ensure miner is properly installed.
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Live Metrics */}
                    {(Number.isFinite(currentPower as number) && (currentPower as number) > 0) || (Number.isFinite(currentTemp as number) && (currentTemp as number) > 0) ? (
                        <div className="grid grid-cols-2 gap-4">
                            {Number.isFinite(currentPower as number) && (currentPower as number) > 0 && (
                                <div className={cn("border rounded-xl p-4",
                                    theme === 'light'
                                        ? 'bg-white border-zinc-200'
                                        : 'bg-zinc-900/50 border-white/5'
                                )}>
                                    <div className={cn("flex items-center gap-2 mb-2 text-xs",
                                        theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
                                    )}>
                                        <Zap size={14} /> <span>Power</span>
                                    </div>
                                    <div className={cn("text-xl font-mono",
                                        theme === 'light' ? 'text-zinc-900' : 'text-white'
                                    )}>{(currentPower as number).toFixed(0)} <span className={cn("text-xs", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>W</span></div>
                                </div>
                            )}
                            {Number.isFinite(currentTemp as number) && (currentTemp as number) > 0 && (
                                <div className={cn("border rounded-xl p-4",
                                    theme === 'light'
                                        ? 'bg-white border-zinc-200'
                                        : 'bg-zinc-900/50 border-white/5'
                                )}>
                                    <div className={cn("flex items-center gap-2 mb-2 text-xs",
                                        theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
                                    )}>
                                        <Timer size={14} /> <span>Temp</span>
                                    </div>
                                    <div className={cn("text-xl font-mono",
                                        theme === 'light' ? 'text-zinc-900' : 'text-white'
                                    )}>{(currentTemp as number).toFixed(1)} <span className={cn("text-xs", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>C</span></div>
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>

                {/* Chart Area */}
                <div className={cn("lg:col-span-2 border rounded-xl p-6 flex flex-col",
                  theme === 'light'
                    ? 'bg-white border-zinc-200'
                    : 'bg-zinc-900/50 border-white/5'
                )}>
                     <h3 className={cn("text-sm font-medium mb-6 flex justify-between",
                       theme === 'light' ? 'text-zinc-700' : 'text-zinc-400'
                     )}>
                        <span>Real-time Hashrate</span>
                        <span className={cn("font-mono", theme === 'light' ? 'text-emerald-600' : 'text-emerald-400')}>{formatHashrate(currentHashrate)}</span>
                     </h3>
                     
                     <div className="flex-1 w-full min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={history}>
                                <defs>
                                    <linearGradient id="colorHr" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <Tooltip 
                                    contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px' }}
                                    itemStyle={{ color: '#10b981', fontFamily: 'monospace' }}
                                    labelStyle={{ color: '#71717a', fontSize: '12px' }}
                                    formatter={(value: any) => [formatHashrate(Number(value)), "Hashrate"]}
                                />
                                <XAxis dataKey="time" hide />
                                <YAxis hide domain={['auto', 'auto']} />
                                <Area 
                                    type="monotone" 
                                    dataKey="hashrate" 
                                    stroke="#10b981" 
                                    fillOpacity={1} 
                                    fill="url(#colorHr)" 
                                    strokeWidth={2}
                                    animationDuration={500}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                     </div>
                </div>
            </div>

            {/* Results Section */}
            {finalResults && status !== 'running' && (
                <div className={cn("border rounded-xl p-6 animate-in slide-in-from-bottom-2",
                    theme === 'light'
                        ? 'border-emerald-400/30 bg-emerald-500/5'
                        : 'border-emerald-500/20 bg-emerald-500/5'
                )}>
                    <h3 className={cn("font-medium mb-4 flex items-center gap-2",
                        theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'
                    )}>
                        Included in 1.0 DB Report
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                        <div>
                            <div className={cn("text-xs uppercase tracking-widest",
                                theme === 'light' ? 'text-emerald-700/70' : 'text-emerald-500/60'
                            )}>Average Speed</div>
                            <div className={cn("text-2xl font-mono mt-1",
                                theme === 'light' ? 'text-zinc-900' : 'text-white'
                            )}>{formatHashrate(finalResults.avg)}</div>
                        </div>
                        <div>
                            <div className={cn("text-xs uppercase tracking-widest",
                                theme === 'light' ? 'text-emerald-700/70' : 'text-emerald-500/60'
                            )}>Max Peak</div>
                            <div className={cn("text-2xl font-mono mt-1",
                                theme === 'light' ? 'text-zinc-900' : 'text-white'
                            )}>{formatHashrate(finalResults.max)}</div>
                        </div>
                        <div>
                            <div className="text-xs text-emerald-500/60 uppercase tracking-widest">Algorithm</div>
                            <div className="text-2xl font-mono text-white mt-1">{deviceType === 'cpu' ? 'RandomX' : 'XMR-GPU'}</div>
                        </div>
                        <div>
                             <div className="text-xs text-emerald-500/60 uppercase tracking-widest">Reported Shares</div>
                             <div className="text-2xl font-mono text-white mt-1">
                                {localStatsRef.current.length.toLocaleString()}
                             </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Authentication Warning Modal */}
            {showAuthWarning && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className={cn("border rounded-xl p-8 max-w-md w-full",
                        theme === 'light'
                            ? 'bg-white border-zinc-200'
                            : 'bg-zinc-950 border-zinc-800'
                    )}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className={cn("p-2 rounded-lg",
                                theme === 'light' ? 'bg-yellow-100' : 'bg-yellow-500/10'
                            )}>
                                <svg className={cn("w-6 h-6", theme === 'light' ? 'text-yellow-600' : 'text-yellow-400')} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <h2 className={cn("text-lg font-bold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                                Wallet Not Connected
                            </h2>
                        </div>

                        <p className={cn("mb-6 text-sm leading-relaxed", theme === 'light' ? 'text-zinc-600' : 'text-zinc-300')}>
                            Benchmarks run without wallet authentication will not be counted for reward calculations. 
                            Would you like to connect your Solana wallet now?
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={handleAuthWarningContinue}
                                className={cn(
                                    "flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all",
                                    theme === 'light'
                                        ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
                                        : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
                                )}
                            >
                                Continue Without Wallet
                            </button>
                            <button
                                onClick={handleAuthWarningConnect}
                                className={cn(
                                    "flex-1 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all",
                                    theme === 'light'
                                        ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                                        : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                                )}
                            >
                                Connect Wallet
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Benchmark;
