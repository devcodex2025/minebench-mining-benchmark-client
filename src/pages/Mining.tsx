import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Play, SquareSolid, PauseSolid, Flame, Gauge, Zap, Shield, Cpu, TrendingUp, Clock, Activity, Info, Hourglass } from '../components/icons';
import { useMinerStore } from '../store/useMinerStore';
import { SolanaAuthService, useSolanaAuth } from '../services/solanaAuth';
import { MultiDeviceSyncService } from '../services/multiDeviceSync';
import { useTheme } from '../contexts/ThemeContext';
import { cn, formatHashrate } from '../lib/utils';
import { p2poolAPI } from '../services/p2poolAPI';
import type { P2PoolPoolSnapshot, P2PoolStratumSnapshot } from '../services/p2poolAPI';
import { getEnvironmentConfig } from '../config/environment';
import { nativeApi } from '../lib/native-api';
import { backendJson } from '../lib/backend-api';

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

// Extend window type for API error logging
declare global {
    interface Window {
        __apiErrorLogged?: boolean;
        __apiConnected?: string; // Track which endpoint is connected
    }
}

// Chart component for hashrate visualization - MEMOIZED to prevent re-renders
import { ShareAnimation } from '../components/ui/ShareAnimation';

const HashRateChart: React.FC<{ data: any[]; theme: string }> = React.memo(({ data, theme }) => (
    <div className={cn("border rounded-xl p-6 space-y-4",
        theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/10'
    )}>
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-500" size={18} />
                <span className={cn("text-sm font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                    Hashrate Performance
                </span>
            </div>
            <span className={cn("text-xs px-2 py-1 rounded-full", theme === 'light' ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-800 text-zinc-400')}>
                Real-time
            </span>
        </div>

        <div className="h-[300px] w-full">
            {data.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data}>
                        <defs>
                            <linearGradient id="colorHashrate" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme === 'light' ? '#e4e4e7' : '#27272a'} />
                        <XAxis dataKey="time" tick={{ fontSize: 12 }} stroke={theme === 'light' ? '#71717a' : '#a1a1aa'} />
                        <YAxis tick={{ fontSize: 12 }} stroke={theme === 'light' ? '#71717a' : '#a1a1aa'} />
                        <Tooltip
                            contentStyle={{
                                backgroundColor: theme === 'light' ? '#fafafa' : '#18181b',
                                border: `1px solid ${theme === 'light' ? '#e4e4e7' : '#27272a'}`,
                                borderRadius: '8px'
                            }}
                            formatter={(value) => [formatHashrate(value as number), 'H/s']}
                        />
                        <Area
                            type="monotone"
                            dataKey="hashrate"
                            stroke="#10b981"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorHashrate)"
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            ) : (
                <div className={cn(
                    "h-full rounded-lg border border-dashed flex items-center justify-center text-sm",
                    theme === 'light'
                        ? 'border-zinc-200 bg-zinc-50 text-zinc-500'
                        : 'border-white/10 bg-white/[0.03] text-zinc-500'
                )}>
                    No live hashrate data yet
                </div>
            )}
        </div>
    </div>
));

HashRateChart.displayName = 'HashRateChart';

const Mining: React.FC = () => {
    const { theme } = useTheme();
    const { user, miningStats } = useSolanaAuth(); // Get Solana user and lifetime stats (XMR/BMT)
    const status = useMinerStore((state) => state.status);
    const setStatus = useMinerStore((state) => state.setStatus);
    const addLog = useMinerStore((state) => state.addLog);
    const deviceType = useMinerStore((state) => state.deviceType);
    const setDeviceType = useMinerStore((state) => state.setDeviceType);
    const wallet = useMinerStore((state) => state.wallet);
    const setWallet = useMinerStore((state) => state.setWallet);
    const workerName = useMinerStore((state) => state.workerName);
    const setWorkerName = useMinerStore((state) => state.setWorkerName);
    const donateLevel = useMinerStore((state) => state.donateLevel);
    const setDonateLevel = useMinerStore((state) => state.setDonateLevel);
    const poolUrl = useMinerStore((state) => state.poolUrl);
    const setPoolUrl = useMinerStore((state) => state.setPoolUrl);
    const manualPoolSelection = useMinerStore((state) => state.manualPoolSelection);
    const backendPoolEndpoints = useMinerStore((state) => state.backendPoolEndpoints);
    const updateStats = useMinerStore((state) => state.updateStats);
    const history = useMinerStore((state) => state.history);
    const currentHashrate = useMinerStore((state) => state.currentHashrate);
    const resetSession = useMinerStore((state) => state.resetSession);
    const pools = useMinerStore((state) => state.pools);
    const setGlobalPoolStats = useMinerStore((state) => state.setGlobalPoolStats);
    const loadSettings = useMinerStore((state) => state.loadSettings);
    const saveSettings = useMinerStore((state) => state.saveSettings);
    const fetchPublicConfig = useMinerStore((state) => state.fetchPublicConfig);
    const isPremium = useMinerStore((state) => state.isPremium);
    const premiumXmrWallet = useMinerStore((state) => state.premiumXmrWallet);

    const threads = useMinerStore((state) => state.threads);
    const setThreads = useMinerStore((state) => state.setThreads);
    const cpuName = useMinerStore((state) => state.cpuName);
    const cpuCores = useMinerStore((state) => state.cpuCores);
    const setCpuInfo = useMinerStore((state) => state.setCpuInfo);

    // Advanced xmrig settings
    const cpuPriority = useMinerStore((state) => state.cpuPriority);
    const randomxMode = useMinerStore((state) => state.randomxMode);
    const hugePages = useMinerStore((state) => state.hugePages);
    const setCpuPriority = useMinerStore((state) => state.setCpuPriority);
    const setRandomxMode = useMinerStore((state) => state.setRandomxMode);
    const setHugePages = useMinerStore((state) => state.setHugePages);

    const [showHugePagesInfo, setShowHugePagesInfo] = useState(false);
    const [stratumStats, setStratumStats] = useState<P2PoolStratumSnapshot | null>(null);
    const [poolSnapshots, setPoolSnapshots] = useState<P2PoolPoolSnapshot[]>([]);
    const [showShareAnimation, setShowShareAnimation] = useState(false);

    const statsIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const timeIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const poolStatsIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ratesIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rewardReportIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const verifiedSharesIntervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statsInFlightRef = useRef(false);
    const poolStatsInFlightRef = useRef(false);
    const ratesInFlightRef = useRef(false);
    const rewardReportInFlightRef = useRef(false);
    const verifiedSharesInFlightRef = useRef(false);
    const lastRewardReportAtRef = useRef(0);
    const lastTimerPersistAtRef = useRef(0);
    const lastShareCountRef = useRef<number | null>(null);
    const rewardReportSeqRef = useRef(0);
    const miningStartedAtRef = useRef<number | null>(null);
    const pausedElapsedRef = useRef(0);
    const [elapsedTime, setElapsedTime] = useState(0);
    const [peakHashrate, setPeakHashrate] = useState(0);
    const [poolNetworkHashrate, setPoolNetworkHashrate] = useState(300000000000); // Default Monero difficulty
    const statusRef = useRef(status);
    const userPublicKeyRef = useRef(user?.publicKey);
    const currentHashrateRef = useRef(currentHashrate);
    const stratumSharesRef = useRef(Math.max(stratumStats?.total_stratum_shares || 0, stratumStats?.shares_found || 0));
    const workerNameRef = useRef(workerName);
    const deviceTypeRef = useRef(deviceType);
    const elapsedTimeRef = useRef(0);
    const poolNetworkHashrateRef = useRef(300000000000);
    const env = getEnvironmentConfig();
    const primaryPool = pools?.['cpu'];
    const reservePool = env.enableBackupPool ? pools?.['cpu-backup'] : undefined;
    const isNodeFullySynced = env.enableBackupPool
        ? !!((primaryPool?.isSynced && primaryPool?.progress >= 99.9) || (reservePool?.isSynced && reservePool?.progress >= 99.9))
        : !!(primaryPool?.isSynced && primaryPool?.progress >= 99.9);
    const maxMiningThreads = Math.max(1, cpuCores - 1);
    const safeMiningThreads = Math.min(threads, maxMiningThreads);
    const activeWindowUserShares = Number(miningStats?.activeWindowUserShares ?? 0);
    const activeWindowPoolShares = Number(miningStats?.activeWindowPoolShares ?? 0);
    const activeWindowRewardSharePercent = Number(miningStats?.activeWindowRewardSharePercent ?? 0);
    const currentWindowUpdatedAt = miningStats?.currentWindow?.updatedAt
        ? new Date(miningStats.currentWindow.updatedAt).toLocaleTimeString()
        : null;

    const refreshVerifiedShares = useCallback(async () => {
        const publicKey = userPublicKeyRef.current;
        if (!publicKey || verifiedSharesInFlightRef.current) return;

        verifiedSharesInFlightRef.current = true;
        try {
            await SolanaAuthService.getInstance().fetchMiningStats(publicKey);
        } catch (err) {
            console.warn('[Mining] Failed to refresh verified shares:', err);
        } finally {
            verifiedSharesInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        statusRef.current = status;
        userPublicKeyRef.current = user?.publicKey;
        currentHashrateRef.current = currentHashrate;
        stratumSharesRef.current = Math.max(stratumStats?.total_stratum_shares || 0, stratumStats?.shares_found || 0);
        workerNameRef.current = workerName;
        deviceTypeRef.current = deviceType;
        elapsedTimeRef.current = elapsedTime;
        poolNetworkHashrateRef.current = poolNetworkHashrate;
    }, [status, user?.publicKey, currentHashrate, stratumStats?.total_stratum_shares, stratumStats?.shares_found, workerName, deviceType, elapsedTime, poolNetworkHashrate]);

    const persistMiningTimer = (startedAt: number | null, elapsed: number) => {
        try {
            localStorage.setItem('minebench_mining_elapsed_seconds', String(Math.max(0, Math.floor(elapsed))));
            if (startedAt) {
                localStorage.setItem('minebench_mining_started_at', String(startedAt));
            } else {
                localStorage.removeItem('minebench_mining_started_at');
            }
        } catch {
            // Ignore storage failures; timer still works for the current mounted page.
        }
    };

    const readStoredElapsed = () => {
        try {
            const elapsed = Number(localStorage.getItem('minebench_mining_elapsed_seconds') || 0);
            return Number.isFinite(elapsed) ? Math.max(0, Math.floor(elapsed)) : 0;
        } catch {
            return 0;
        }
    };

    // Get global pool stats from store
    const poolHashrateTotal = useMinerStore((state) => state.poolHashrateTotal);
    const poolMinersCount = useMinerStore((state) => state.poolMinersCount);
    const setPoolNetworkHashrateStore = useMinerStore((state) => state.setPoolNetworkHashrate);
    const setExchangeRates = useMinerStore((state) => state.setExchangeRates);

    const poolStatusLabel = stratumStats
        ? (stratumStats.wallet || (stratumStats.workers?.length || poolHashrateTotal > 0 || poolMinersCount > 0)
            ? 'Live'
            : 'No Wallet')
        : (poolHashrateTotal > 0 || poolMinersCount > 0)
            ? 'Live'
            : 'Waiting for backend stats...';
    const selectedPoolEndpoint = backendPoolEndpoints.find((endpoint) => endpoint.url === poolUrl);
    const selectedPoolLabel = selectedPoolEndpoint
        ? `${selectedPoolEndpoint.label} (${selectedPoolEndpoint.region})`
        : 'Custom Pool';

    // Wallet balance and rewards
    const [walletValid, setWalletValid] = useState(false);
    const [settingsLoaded, setSettingsLoaded] = useState(false);
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
            deviceName: `${cpuName || 'Unknown CPU'} (${workerName})`,
            walletPublicKey: user.publicKey,
            currentHashrate: 0,
            totalHashesComputed: 0,
            totalShares: 0,
            accumulatedRewards: 0,
            uptime: 0,
            lastUpdate: Date.now(),
            mode: 'mining'
        });

        // Start sync loop
        syncService.startSyncLoop();

        return () => {
            syncService.stopSyncLoop();
        };
    }, [isSolanaConnected, user?.publicKey, cpuName, workerName]);

    // Load CPU info
    useEffect(() => {
        const loadCpuInfo = async () => {
                    try {
                        if (!(window as any).__TAURI_INTERNALS__) return;
                        const info = await nativeApi.system.getCpuInfo();
                        setCpuInfo(info.name, info.cores);
                    } catch (err) {
                        console.error('Failed to load CPU info:', err);
                    }
                };
        loadCpuInfo();
    }, [setCpuInfo]);

    const chartData = useMemo(() => (
        history.filter((point) => Number.isFinite(point?.hashrate) && point.hashrate >= 0)
    ), [history]);

    // Load miner settings from localStorage/Native on component mount
    useEffect(() => {
        let mounted = true;
        (async () => {
            await loadSettings();
            if (mounted) setSettingsLoaded(true);
            console.log('⚙️ Miner settings loaded from storage');
        })();

        return () => {
            mounted = false;
        };
    }, [loadSettings]);

    useEffect(() => {
        const storedElapsed = readStoredElapsed();
        pausedElapsedRef.current = storedElapsed;
        setElapsedTime(storedElapsed);

        try {
            const storedStartedAt = Number(localStorage.getItem('minebench_mining_started_at') || 0);
            if (status === 'running' && Number.isFinite(storedStartedAt) && storedStartedAt > 0) {
                miningStartedAtRef.current = storedStartedAt;
            }
        } catch {
            // Ignore malformed timer state.
        }
    }, []);

    // Validate wallet address
    useEffect(() => {
        const isValid = p2poolAPI.validateMoneroAddress(wallet);
        setWalletValid(isValid);
    }, [wallet]);

    // Save settings whenever they change
    useEffect(() => {
        if (!settingsLoaded) return;

        const timer = setTimeout(() => {
            saveSettings();
        }, 500); // Debounce saves by 500ms to avoid too frequent I/O

        return () => clearTimeout(timer);
    }, [settingsLoaded, wallet, workerName, threads, cpuPriority, randomxMode, hugePages, donateLevel, poolUrl, deviceType, saveSettings]);

    useEffect(() => {
        if (!(window as any).__TAURI_INTERNALS__) return;

        let unlistenLog: () => void;
        let unlistenError: () => void;

        const setupListeners = async () => {
            unlistenLog = await nativeApi.listen<string>('miner-log', (msg: string) => {
                const line = msg.toLowerCase();
                if (msg.startsWith('[MineBench]')) {
                    addLog(msg);
                    return;
                }
                const isConnectError =
                    line.includes('connection refused') ||
                    line.includes('failed to connect') ||
                    line.includes('connect error') ||
                    line.includes('login failed') ||
                    line.includes('stratum connection failed') ||
                    line.includes('network error');
                if (isConnectError) {
                    setStatus('error');
                    addLog(`❌ Mining connection error: ${msg.trim()}`);
                }
                if (line.includes('connected') || line.includes('login succeeded') || line.includes('new job')) {
                    if (statusRef.current !== 'running') {
                        setStatus('running');
                        addLog('✅ Miner connected to pool');
                    }
                }
            });

            unlistenError = await nativeApi.listen<string>('miner-error', (msg: string) => {
                const message = String(msg || '').trim();
                if (message) {
                    setStatus('error');
                    addLog(`Miner error: ${message}`);
                }
            });
        };

        setupListeners();

        return () => {
            if (unlistenLog) unlistenLog();
            if (unlistenError) unlistenError();
        };
    }, [setStatus, addLog]);

    useEffect(() => {
        return () => {
            if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
            if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
            if (poolStatsIntervalRef.current) clearInterval(poolStatsIntervalRef.current);
            if (ratesIntervalRef.current) clearInterval(ratesIntervalRef.current);
            if (rewardReportIntervalRef.current) clearInterval(rewardReportIntervalRef.current);
            if (verifiedSharesIntervalRef.current) clearInterval(verifiedSharesIntervalRef.current);
        };
    }, []);

    useEffect(() => {
        const shouldPoll = status === 'running';

        if (!shouldPoll) {
            if (statsIntervalRef.current) {
                clearInterval(statsIntervalRef.current);
                statsIntervalRef.current = null;
            }
            return;
        }

        // Increase interval from 3.5s to 5s to reduce network load and UI updates
        statsIntervalRef.current = setInterval(fetchStats, 5000);
        // Call immediately for quicker initial response
        fetchStats();
        return () => {
            if (statsIntervalRef.current) {
                clearInterval(statsIntervalRef.current);
                statsIntervalRef.current = null;
            }
        };
    }, [status, deviceType]);

    useEffect(() => {
        if (!user?.publicKey) {
            if (verifiedSharesIntervalRef.current) {
                clearInterval(verifiedSharesIntervalRef.current);
                verifiedSharesIntervalRef.current = null;
            }
            return;
        }

        refreshVerifiedShares();
        verifiedSharesIntervalRef.current = setInterval(refreshVerifiedShares, 15000);

        return () => {
            if (verifiedSharesIntervalRef.current) {
                clearInterval(verifiedSharesIntervalRef.current);
                verifiedSharesIntervalRef.current = null;
            }
        };
    }, [refreshVerifiedShares, user?.publicKey]);

    // Fetch pool network hashrate and stats for reward calculation
    useEffect(() => {
        const fetchPoolStats = async () => {
            if (poolStatsInFlightRef.current) return;
            poolStatsInFlightRef.current = true;
            try {
                const stats = await p2poolAPI.getPoolStats();
                const newStratum = stats.stratum || null;

                // Trigger ASCII animation if a new share was found
                if (newStratum && newStratum.shares_found !== undefined) {
                    if (lastShareCountRef.current !== null && newStratum.shares_found > lastShareCountRef.current) {
                        setShowShareAnimation(true);
                    }
                    lastShareCountRef.current = newStratum.shares_found;
                }

                setStratumStats(newStratum);
                setPoolSnapshots(Array.isArray(stats.pools) ? stats.pools : []);

                const networkHashrate = stats && stats.poolDifficulty
                    ? stats.poolDifficulty / 120
                    : poolNetworkHashrate;
                setPoolNetworkHashrate(networkHashrate);
                setPoolNetworkHashrateStore(networkHashrate);

                // Update global pool stats in store even when difficulty is temporarily unavailable.
                setGlobalPoolStats(stats.poolHashrate || 0, stats.miners || 0, networkHashrate);
                await refreshVerifiedShares();
            } catch (err) {
                console.warn('[Mining] Failed to fetch pool stats:', err);
                // Use default if fetch fails
            } finally {
                poolStatsInFlightRef.current = false;
            }
        };

        fetchPoolStats();
        poolStatsIntervalRef.current = setInterval(fetchPoolStats, 30000); // Update every 30s
        return () => {
            if (poolStatsIntervalRef.current) clearInterval(poolStatsIntervalRef.current);
        };
    }, [refreshVerifiedShares, setGlobalPoolStats, setPoolNetworkHashrateStore]);

    useEffect(() => {
        if (status !== 'running') {
            if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
            timeIntervalRef.current = null;
            return;
        }

        if (!miningStartedAtRef.current) {
            miningStartedAtRef.current = Date.now();
            persistMiningTimer(miningStartedAtRef.current, pausedElapsedRef.current);
        }

        const syncElapsed = () => {
            const startedAt = miningStartedAtRef.current;
            const nextElapsed = startedAt
                ? pausedElapsedRef.current + Math.floor((Date.now() - startedAt) / 1000)
                : pausedElapsedRef.current;
            setElapsedTime(nextElapsed);
            const now = Date.now();
            if (now - lastTimerPersistAtRef.current >= 30000) {
                lastTimerPersistAtRef.current = now;
                persistMiningTimer(startedAt, nextElapsed);
            }
        };

        syncElapsed();
        timeIntervalRef.current = setInterval(() => {
            syncElapsed();
        }, 1000);

        return () => {
            if (timeIntervalRef.current) {
                clearInterval(timeIntervalRef.current);
                timeIntervalRef.current = null;
            }
        };
    }, [status]);

    // Fetch rates from backend (XMR USD, BMT USD, XMR->BMT)
    useEffect(() => {
        const fetchRates = async () => {
            if (ratesInFlightRef.current) return;
            ratesInFlightRef.current = true;
            try {
                const data = await backendJson('/api/rates/current');

                const toNumber = (value: any) => {
                    if (value === null || value === undefined) return 0;
                    const num = Number(String(value).replace(/,/g, ''));
                    return Number.isFinite(num) ? num : 0;
                };

                const nextXmrUsd = toNumber(
                    data?.xmr_usd ?? data?.xmrUsd ?? data?.xmr_usd_price ?? data?.xmr_price_usd
                );
                const nextBmtUsd = toNumber(
                    data?.bmt_usd ?? data?.bmtUsd ?? data?.bmt_usd_price ?? data?.bmt_price_usd
                );
                const nextRate = toNumber(
                    data?.rate_xmr_bmt ?? data?.rateXmrBmt ?? data?.xmr_bmt_rate
                );

                // Save to store for Layout component
                setExchangeRates(
                    Number.isFinite(nextXmrUsd) ? nextXmrUsd : 0,
                    Number.isFinite(nextBmtUsd) ? nextBmtUsd : 0,
                    Number.isFinite(nextRate) ? nextRate : 0
                );
            } catch (err) {
                console.warn('[Mining] Failed to fetch rates from backend:', err);
                setExchangeRates(0, 0, 0);
            } finally {
                ratesInFlightRef.current = false;
            }
        };

        // Fetch immediately on mount
        fetchRates();

        // Then fetch periodically when running
        if (status === 'running' || status === 'paused') {
            ratesIntervalRef.current = setInterval(fetchRates, 60000); // Update every 60s
            return () => {
                if (ratesIntervalRef.current) {
                    clearInterval(ratesIntervalRef.current);
                    ratesIntervalRef.current = null;
                }
            };
        }
    }, [status]);

    useEffect(() => {
        if (status !== 'running' || !user?.publicKey) {
            if (rewardReportIntervalRef.current) {
                clearInterval(rewardReportIntervalRef.current);
                rewardReportIntervalRef.current = null;
            }
            return;
        }

        const reportRewards = async () => {
            const publicKey = userPublicKeyRef.current;
            if (!publicKey || statusRef.current !== 'running' || rewardReportInFlightRef.current) return;

            const now = Date.now();
            if (now - lastRewardReportAtRef.current < 15000) return;

            rewardReportInFlightRef.current = true;
            const seq = ++rewardReportSeqRef.current;
            lastRewardReportAtRef.current = now;

            try {
                await SolanaAuthService.getInstance().reportMiningStats({
                    hashrate: currentHashrateRef.current,
                    shares: 0,
                    source: 'mining',
                    referenceId: `mining-${publicKey}-${now}-${seq}`,
                    metadata: {
                        workerName: workerNameRef.current,
                        deviceType: deviceTypeRef.current,
                        elapsedTime: elapsedTimeRef.current,
                        poolNetworkHashrate: poolNetworkHashrateRef.current,
                        shareSource: 'pool-verified-only'
                    }
                });
                await SolanaAuthService.getInstance().fetchMiningStats(publicKey);
            } catch (err) {
                console.warn('[Mining] Failed to report mining stats:', err);
            } finally {
                rewardReportInFlightRef.current = false;
            }
        };

        reportRewards();
        rewardReportIntervalRef.current = setInterval(reportRewards, 15000);

        return () => {
            if (rewardReportIntervalRef.current) {
                clearInterval(rewardReportIntervalRef.current);
                rewardReportIntervalRef.current = null;
            }
        };
    }, [status, user?.publicKey]);

    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    };

    const fetchStats = async () => {
        const shouldPoll = statusRef.current === 'running';
        if (!shouldPoll) return;
        if (statsInFlightRef.current) return;
        statsInFlightRef.current = true;
        try {
            // Determine which xmrig API endpoint to use based on miner version
            let endpoints: string[] = [];
            if (deviceType === 'cpu') {
                endpoints = [
                    'http://127.0.0.1:4077/2/summary',
                    'http://127.0.0.1:4077/api/v1/summary',
                    'http://127.0.0.1:4077/api/stats',
                    'http://127.0.0.1:4077/summary'
                ];
            } else {
                endpoints = [
                    'http://127.0.0.1:4067/summary',
                    'http://127.0.0.1:4067/api/v1/summary'
                ];
            }

            let data = null;
            let successUrl = null;

            for (const actualUrl of endpoints) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 2000);
                    const res = await fetch(actualUrl, { signal: controller.signal }).catch(() => null);
                    clearTimeout(timeoutId);

                    if (res && res.ok) {
                        data = await res.json();
                        successUrl = actualUrl;
                        if (!window.__apiConnected || window.__apiConnected !== actualUrl) {
                            window.__apiConnected = actualUrl;
                        }
                        break;
                    }
                } catch { }
            }

            if (!data) return;

            let hr = 0;
            if (deviceType === 'cpu') {
                hr = data.hashrate?.total?.[0] ?? data.hashrate?.current ?? data.hashrate ?? 0;
                if (hr > 0) setPeakHashrate((prev) => (hr > prev ? hr : prev));

                updateStats(hr, null, undefined);

                if (user?.publicKey) {
                    const deviceId = localStorage.getItem('minebench_device_id');
                    if (deviceId) {
                        MultiDeviceSyncService.getInstance(user.publicKey).updateDevice(deviceId, {
                            currentHashrate: hr,
                            uptime: elapsedTime,
                            accumulatedRewards: Number(miningStats?.totalRewards || 0),
                            mode: 'mining'
                        });
                    }
                }
            } else if (data.gpus && data.gpus.length > 0) {
                hr = data.gpus[0].hashrate ?? data.gpus[0].hash ?? 0;
                updateStats(hr, null, undefined);
                setPeakHashrate((prev) => (hr > prev ? hr : prev));
            }
        } catch (err) {
        } finally {
            statsInFlightRef.current = false;
        }
    };

    const startMining = async () => {
        console.log("Start Mining clicked");
        if (status === 'running' || status === 'starting') {
            console.log("Mining already running or starting, skipping.");
            return;
        }
        if (!isSolanaConnected) {
            addLog('Cannot start mining: connect Solana wallet first.');
            return;
        }
        if (!walletValid) {
            addLog('Cannot start mining: Monero wallet address is invalid.');
            return;
        }

        // Ensure we have the latest config
        console.log("Invalidating pool config cache...");
        p2poolAPI.invalidateCache();
        console.log("Fetching latest public config...");
        try {
            await fetchPublicConfig();
            console.log("Public config fetched successfully.");
        } catch (e) {
            console.error("Failed to fetch public config:", e);
        }
        const latestState = useMinerStore.getState();
        const latestPrimaryPool = latestState.pools?.['cpu'];
        const latestReservePool = env.enableBackupPool ? latestState.pools?.['cpu-backup'] : undefined;
        const latestNodeFullySynced = env.enableBackupPool
            ? !!((latestPrimaryPool?.isSynced && latestPrimaryPool?.progress >= 99.9) || (latestReservePool?.isSynced && latestReservePool?.progress >= 99.9))
            : !!(latestPrimaryPool?.isSynced && latestPrimaryPool?.progress >= 99.9);
        if (!latestNodeFullySynced) {
            addLog('Cannot start mining: pool node is not fully synced yet.');
            return;
        }

        resetSession();
        lastRewardReportAtRef.current = 0;
        rewardReportSeqRef.current = 0;
        pausedElapsedRef.current = 0;
        miningStartedAtRef.current = Date.now();
        setElapsedTime(0);
        setPeakHashrate(0);
        persistMiningTimer(miningStartedAtRef.current, 0);
        try {
            addLog(`Starting miner: XMR payout wallet (-u) ${wallet}`);
            addLog(`Starting miner: reward tracking (--rig-id) ${user!.publicKey}`);
            addLog(`Starting miner: pool ${latestState.poolUrl}`);
            console.log("Invoking Native start-mining command...");
            await nativeApi.miner.startMining({
                              type: deviceType,
                              wallet,
                              worker: workerName,
                              threads: deviceType === 'cpu' ? safeMiningThreads : undefined,
                              cpuPriority,
                randomxMode,
                hugePages,
                donateLevel,
                poolUrl: latestState.poolUrl,
                manualPoolSelection,
                solanaWallet: user!.publicKey,
            });
            console.log("start-mining command invoked.");
            setStatus('starting');
            fetchStats();
        } catch (err: any) {
            console.error("Failed to start-mining:", err);
            setStatus('error');
            addLog(`Failed to start mining: ${getErrorMessage(err)}`);
        }
    };

    const stopMining = async () => {
        if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
        if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
        pausedElapsedRef.current = elapsedTime;
        miningStartedAtRef.current = null;
        persistMiningTimer(null, elapsedTime);
        setStatus('stopping');
        try {
            const { logs: storeLogs } = useMinerStore.getState();
            await nativeApi.miner.saveLogs({
                systemLogs: storeLogs,
                minerLogs: [],
                sessionType: 'mining',
                device: deviceType
            });
            await nativeApi.miner.stopMining();
            setStatus('completed');
            addLog('Mining stopped');
        } catch (err: any) {
            setStatus('error');
            addLog(`Failed to stop mining: ${getErrorMessage(err)}`);
        }
    };

    const pauseMining = async () => {
        try {
            await nativeApi.miner.pauseMining();
            pausedElapsedRef.current = elapsedTime;
            miningStartedAtRef.current = null;
            persistMiningTimer(null, elapsedTime);
            setStatus('paused');
            if (timeIntervalRef.current) clearInterval(timeIntervalRef.current);
            addLog('Mining paused');
        } catch (err: any) {
            setStatus('error');
            addLog(`Failed to pause mining: ${getErrorMessage(err)}`);
        }
    };

    const resumeMining = async () => {
        try {
            await nativeApi.miner.resumeMining();
            pausedElapsedRef.current = elapsedTime;
            miningStartedAtRef.current = Date.now();
            persistMiningTimer(miningStartedAtRef.current, elapsedTime);
            setStatus('running');
            addLog('Mining resumed');
        } catch (err: any) {
            setStatus('error');
            addLog(`Failed to resume mining: ${getErrorMessage(err)}`);
        }
    };

    return (
        <div className="space-y-6">
            {showShareAnimation && (
                <ShareAnimation
                    theme={theme}
                    onComplete={() => setShowShareAnimation(false)}
                    onClose={() => setShowShareAnimation(false)}
                />
            )}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className={cn("text-3xl font-light tracking-tight", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                        Mining
                    </h1>
                    <p className={cn("text-sm mt-1", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                        Track your hashrate and earnings in real-time
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {isPremium && (
                        <div className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider shadow-sm transition-all",
                            theme === 'light' ? "bg-amber-100 border-amber-200 text-amber-700 shadow-amber-100" : "bg-amber-500/10 border-amber-500/20 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                        )}>
                            <Flame size={12} className="animate-pulse" />
                            Premium Direct Mining
                        </div>
                    )}
                    <div className={cn('inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-medium transition-all',
                        status === 'running' ? (theme === 'light' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 shadow-sm shadow-emerald-100' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400') :
                        status === 'starting' ? (theme === 'light' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-amber-500/40 bg-amber-500/10 text-amber-400') :
                        status === 'paused' ? (theme === 'light' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-blue-500/40 bg-blue-500/10 text-blue-400') :
                        status === 'error' ? (theme === 'light' ? 'border-red-300 bg-red-50 text-red-700' : 'border-red-500/30 bg-red-500/10 text-red-400') :
                        (theme === 'light' ? 'border-zinc-200 bg-zinc-50 text-zinc-600' : 'border-white/10 bg-white/5 text-zinc-400')
                    )}>
                        <span className={cn('w-2 h-2 rounded-full',
                            status === 'running' ? 'bg-emerald-500 animate-pulse' :
                            status === 'starting' ? 'bg-amber-500 animate-pulse' :
                            status === 'paused' ? 'bg-blue-500' :
                            status === 'error' ? 'bg-red-500' : 'bg-zinc-400'
                        )}></span>
                        <span>{status === 'running' ? 'Mining' : status === 'starting' ? 'Connecting' : status === 'paused' ? 'Paused' : status === 'completed' ? 'Completed' : status === 'error' ? 'Error' : 'Idle'}</span>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2">
                    <HashRateChart data={chartData} theme={theme} />
                </div>
                <div className="space-y-4">
                    {deviceType === 'cpu' && cpuName && (
                        <div className={cn("border rounded-xl p-4 space-y-3", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10')}>
                            <div className={cn("flex items-center gap-2", theme === 'light' ? 'text-emerald-600' : 'text-emerald-400')}>
                                <Cpu size={16} />
                                <span className="font-medium text-sm">CPU Information</span>
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Processor:</span>
                                    <span className={cn("font-mono text-right max-w-[120px] truncate", theme === 'light' ? 'text-zinc-900' : 'text-zinc-300')} title={cpuName}>{cpuName}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Cores:</span>
                                    <span className={cn("font-mono", theme === 'light' ? 'text-zinc-900' : 'text-zinc-300')}>{cpuCores}</span>
                                </div>
                            </div>
                            <div className={cn("pt-2 space-y-2", theme === 'light' ? 'border-t border-zinc-200' : 'border-t border-white/5')}>
                                <div className="flex justify-between items-center">
                                    <label className={cn("text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Threads:</label>
                                    <span className={cn("text-sm font-mono", theme === 'light' ? 'text-emerald-600' : 'text-emerald-400')}>{safeMiningThreads} / {cpuCores}</span>
                                </div>
                                <input type="range" min="1" max={maxMiningThreads} value={safeMiningThreads} onChange={(e) => setThreads(Number(e.target.value))} disabled={status === 'running' || status === 'starting'} className={cn("w-full h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed", theme === 'light' ? 'bg-zinc-300' : 'bg-zinc-800')} />
                                <p className={cn("text-xs", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
                                    Keeps one logical thread free for the app and system responsiveness.
                                </p>
                            </div>
                            <div className={cn("pt-2 space-y-2", theme === 'light' ? 'border-t border-zinc-200' : 'border-t border-white/5')}>
                                <div className="flex justify-between items-center">
                                    <label className={cn("text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>CPU Priority:</label>
                                    <span className={cn("text-sm font-mono", theme === 'light' ? 'text-yellow-600' : 'text-yellow-400')}>
                                        {cpuPriority === 0 ? 'Idle' : cpuPriority === 1 ? 'Low' : cpuPriority === 2 ? 'Normal' : 'High'}
                                    </span>
                                </div>
                                <input type="range" min="0" max="3" value={Math.min(cpuPriority, 3)} onChange={(e) => setCpuPriority(Number(e.target.value))} disabled={status === 'running' || status === 'starting'} className={cn("w-full h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed", theme === 'light' ? 'bg-zinc-300' : 'bg-zinc-800')} />
                                <p className={cn("text-xs", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
                                    Idle · Low · Normal · High — balancing performance and system stability
                                </p>
                            </div>
                            <div className={cn("pt-2 space-y-2", theme === 'light' ? 'border-t border-zinc-200' : 'border-t border-white/5')}>
                                <label className={cn("text-xs block", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                                    RandomX Mode (RAM Usage):
                                </label>
                                <select
                                    value={randomxMode}
                                    onChange={(e) => setRandomxMode(e.target.value as 'auto' | 'fast' | 'light')}
                                    disabled={status === 'running' || status === 'starting'}
                                    className={cn("w-full px-3 py-2 rounded-lg text-xs border disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2", theme === 'light' ? 'bg-zinc-100 border-zinc-300 text-zinc-900 focus:ring-yellow-500' : 'bg-zinc-950/50 border-white/10 text-zinc-300 focus:ring-yellow-500')}
                                >
                                    <option value="auto">Auto (~2GB RAM optimal)</option>
                                    <option value="fast">Fast (~2GB RAM high speed)</option>
                                    <option value="light">Light (~256MB RAM low memory)</option>
                                </select>
                                <p className={cn("text-xs", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
                                    Fast uses more RAM but gives better hashrate
                                </p>
                            </div>
                            <div className={cn("pt-2", theme === 'light' ? 'border-t border-zinc-200' : 'border-t border-white/5')}>
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={hugePages}
                                        onChange={(e) => setHugePages(e.target.checked)}
                                        disabled={status === 'running' || status === 'starting'}
                                        className={cn("w-4 h-4 rounded border disabled:opacity-50 disabled:cursor-not-allowed", theme === 'light' ? 'border-zinc-300 text-emerald-600 focus:ring-emerald-500' : 'border-white/10 bg-zinc-950/50 text-emerald-500 focus:ring-emerald-500')}
                                    />
                                    <span className={cn("text-xs", theme === 'light' ? 'text-zinc-700' : 'text-zinc-300')}>
                                        Enable Huge Pages
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setShowHugePagesInfo(!showHugePagesInfo)}
                                        className={cn("flex items-center", theme === 'light' ? 'text-yellow-600 hover:text-yellow-700' : 'text-yellow-400 hover:text-yellow-300')}
                                        title="Information about Huge Pages"
                                    >
                                        <Info size={14} />
                                    </button>
                                </label>
                                {showHugePagesInfo && (
                                    <div className={cn("text-xs mt-2 p-2 rounded border", theme === 'light' ? 'bg-yellow-50 border-yellow-200 text-yellow-800' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-300')}>
                                        <p className="font-semibold mb-1">What is Huge Pages?</p>
                                        <p className="opacity-90">
                                            Huge Pages uses larger memory blocks to improve CPU cache performance. It can increase mining hash rate by 10-20% on supported systems.
                                        </p>
                                    </div>
                                )}
                                <p className={cn("text-xs mt-1 ml-6", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
                                    Improves memory performance (+10-20% hash rate)
                                </p>
                            </div>
                        </div>
                    )}
                    <div className={cn("border rounded-xl p-6 space-y-4", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10')}>
                        <div className="flex items-center justify-between">
                            <span className={cn("text-sm font-semibold", theme === 'light' ? 'text-zinc-700' : 'text-zinc-300')}>Live Metrics</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <MetricCard label="H/s" value={formatHashrate(currentHashrate)} icon={<Zap size={14} />} color="emerald" theme={theme} />
                            <MetricCard label="Peak" value={formatHashrate(peakHashrate)} icon={<TrendingUp size={14} />} color="yellow" theme={theme} />
                            <MetricCard label="Time" value={formatTime(elapsedTime)} icon={<Clock size={14} />} color="emerald" theme={theme} />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {!walletValid && status === 'idle' && (
                                <div className={cn("col-span-2 p-3 rounded-lg text-xs text-center border", theme === 'light' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/10 border-red-500/20 text-red-400')}>
                                    Invalid Monero wallet address. Please update the wallet before mining.
                                </div>
                            )}
                            {!isSolanaConnected && status !== 'running' && status !== 'starting' && (
                                <div className={cn("col-span-2 p-3 rounded-xl text-xs border flex items-center justify-center gap-2", theme === 'light' ? 'bg-emerald-50 border-emerald-300 text-zinc-500' : 'bg-emerald-500/12 border-emerald-500/35 text-zinc-400')}>
                                    <Shield size={14} className="shrink-0" />
                                    <span>Connect Solana wallet to start mining and receive rewards.</span>
                                </div>
                            )}
                            {!isNodeFullySynced && status !== 'running' && status !== 'starting' && (
                                <div className={cn("col-span-2 p-3 rounded-lg text-xs text-center border", theme === 'light' ? 'bg-yellow-50 border-yellow-200 text-yellow-700' : 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400')}>
                                    Node sync must be 100% to start mining.
                                </div>
                            )}
                            <button onClick={status === 'paused' ? resumeMining : (status === 'idle' || status === 'completed' || status === 'error' || status === 'stopping') ? startMining : pauseMining} disabled={status === 'starting' || ((!walletValid || !isSolanaConnected || !isNodeFullySynced) && (status === 'idle' || status === 'completed' || status === 'error' || status === 'stopping'))} className={cn('py-3.5 px-4 rounded-xl font-semibold text-sm tracking-tight transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer', status === 'running' || status === 'paused' ? 'bg-yellow-500/10 text-yellow-600 border-2 border-yellow-500/20 hover:bg-yellow-500/20' : (theme === 'light' ? 'bg-emerald-600 text-white border-2 border-emerald-600 hover:bg-emerald-500' : 'bg-emerald-500 text-zinc-950 border-2 border-emerald-500 hover:bg-emerald-400'))}>
                                {status === 'idle' || status === 'completed' || status === 'error' || status === 'stopping' ? <><Play size={16} /> Start</> : status === 'paused' ? <><Play size={16} /> Resume</> : status === 'starting' ? <><Hourglass size={16} className="animate-spin" /> Connecting</> : <><PauseSolid size={16} /> Pause</>}
                            </button>
                            <button onClick={stopMining} disabled={status === 'idle' || status === 'completed' || status === 'error' || status === 'stopping'} className={cn('py-3.5 px-4 rounded-xl font-semibold text-sm tracking-tight transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer', status === 'running' || status === 'starting' || status === 'paused' ? 'bg-red-500/10 text-red-500 border-2 border-red-500/20 hover:bg-red-500/20' : (theme === 'light' ? 'bg-zinc-200 text-zinc-500 border-2 border-zinc-200' : 'bg-zinc-800 text-zinc-600 border-2 border-zinc-800'))}>
                            <SquareSolid size={16} /> Stop
                            </button>                        </div>
                    </div>
                    <div className={cn("border rounded-xl p-5 space-y-4", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10')}>
                        <div className="flex items-center justify-between">
                            <span className={cn("text-sm font-semibold", theme === 'light' ? 'text-zinc-700' : 'text-zinc-300')}>Pool Stats</span>
                            <span className={cn("text-[10px] uppercase tracking-widest", theme === 'light' ? 'text-zinc-500' : 'text-zinc-500')}>
                                {poolStatusLabel}
                            </span>
                        </div>
                        <div className={cn("rounded-lg border px-3 py-2 text-xs", theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-700' : 'bg-zinc-950/40 border-white/10 text-zinc-300')}>
                            <div className="flex items-center justify-between gap-3">
                                <span className={cn("uppercase tracking-widest font-bold", theme === 'light' ? 'text-zinc-500' : 'text-zinc-500')}>Mining on</span>
                                <span className="font-semibold text-right">{selectedPoolLabel}</span>
                            </div>
                            <div className={cn("mt-1 font-mono text-[11px] truncate", theme === 'light' ? 'text-zinc-500' : 'text-zinc-500')}>
                                {poolUrl}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <StatCard label="Aggregate 15m" value={formatHashrate(stratumStats?.hashrate_15m || poolHashrateTotal || 0)} icon={<Activity size={12} />} tone="blue" theme={theme} />
                            <StatCard label="1h Avg" value={formatHashrate(stratumStats?.hashrate_1h || 0)} icon={<TrendingUp size={12} />} tone="emerald" theme={theme} />
                            <StatCard label="24h Avg" value={formatHashrate(stratumStats?.hashrate_24h || 0)} icon={<Clock size={12} />} tone="violet" theme={theme} />
                            <StatCard label="Aggregate Workers" value={`${stratumStats?.workers?.length || poolMinersCount || 0}`} icon={<Cpu size={12} />} tone="sky" theme={theme} />
                            <StatCard label="Connections" value={`${stratumStats?.connections || poolMinersCount || 0}`} icon={<Shield size={12} />} tone="cyan" theme={theme} />
                            <StatCard label="Pool Stratum Shares" value={`${stratumStats?.total_stratum_shares || 0}`} icon={<Zap size={12} />} tone="teal" theme={theme} />
                            <StatCard label="Failed Shares" value={`${stratumStats?.shares_failed || 0}`} icon={<Flame size={12} />} tone="rose" theme={theme} />
                            <StatCard label="Total Hashes" value={((stratumStats?.total_hashes || 0)).toLocaleString()} icon={<Gauge size={12} />} tone="amber" theme={theme} />
                        </div>
                        {poolSnapshots.length > 0 && (
                            <div className={cn("space-y-2 text-xs pt-1 border-t", theme === 'light' ? 'border-zinc-200' : 'border-white/10')}>
                                {poolSnapshots.map((pool) => (
                                    <div key={pool.id} className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2", theme === 'light' ? 'bg-zinc-50 text-zinc-700' : 'bg-zinc-950/40 text-zinc-300')}>
                                        <span className="font-semibold truncate">{pool.region || pool.id}</span>
                                        <span className="font-mono text-right">{formatHashrate(pool.poolHashrate || 0)} · {pool.miners || 0} workers</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className={cn("text-xs pt-1 border-t", theme === 'light' ? 'border-zinc-200 text-zinc-600' : 'border-white/10 text-zinc-500')}>
                            <div>Current Effort: {(((stratumStats?.current_effort || 0) * 100)).toFixed(2)}%</div>
                            <div>Average Effort: {(((stratumStats?.average_effort || 0) * 100)).toFixed(2)}%</div>
                            <div>Share Found: {stratumStats?.shares_found || 0}</div>
                            <div>Block Share Estimate: {(((stratumStats?.block_reward_share_percent || 0))).toFixed(3)}%</div>
                        </div>
                    </div>
                    <div className={cn("border rounded-xl p-5 space-y-4", theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10')}>
                        <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wider", theme === 'light' ? 'text-sky-700' : 'text-sky-400')}>
                            <Shield size={14} />
                            Reward Window Shares
                        </div>
                        <div className={cn("text-xs mt-1", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
                            Current Monero reward window share accounting from backend{currentWindowUpdatedAt ? `, updated ${currentWindowUpdatedAt}` : ''}.
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                                <span className={cn(theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>User shares: </span>
                                <span className={cn("font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{activeWindowUserShares.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className={cn(theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Reward part: </span>
                                <span className={cn("font-mono", theme === 'light' ? 'text-sky-800' : 'text-sky-400')}>{activeWindowRewardSharePercent.toFixed(4)}%</span>
                            </div>
                            <div>
                                <span className={cn(theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Total pool shares: </span>
                                <span className={cn("font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{activeWindowPoolShares.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className={cn(theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Paid shares: </span>
                                <span className={cn("font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{(miningStats?.paidShares ?? 0).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatCard = React.memo(({ label, value, icon, tone = 'blue', theme }: { label: string; value: string; icon: React.ReactNode; tone?: 'blue' | 'emerald' | 'violet' | 'sky' | 'cyan' | 'teal' | 'rose' | 'amber'; theme: string }) => {
    const tones = {
        blue: { light: 'border-l-blue-500 text-zinc-700', dark: 'border-l-blue-400 text-zinc-300' },
        emerald: { light: 'border-l-emerald-500 text-zinc-700', dark: 'border-l-emerald-400 text-zinc-300' },
        violet: { light: 'border-l-violet-500 text-zinc-700', dark: 'border-l-violet-400 text-zinc-300' },
        sky: { light: 'border-l-sky-500 text-zinc-700', dark: 'border-l-sky-400 text-zinc-300' },
        cyan: { light: 'border-l-cyan-500 text-zinc-700', dark: 'border-l-cyan-400 text-zinc-300' },
        teal: { light: 'border-l-teal-500 text-zinc-700', dark: 'border-l-teal-400 text-zinc-300' },
        rose: { light: 'border-l-rose-500 text-zinc-700', dark: 'border-l-rose-400 text-zinc-300' },
        amber: { light: 'border-l-amber-500 text-zinc-700', dark: 'border-l-amber-400 text-zinc-300' }
    } as const;

    return (
        <div className={cn(
            "rounded-lg border border-l-2 p-3 flex flex-col gap-1",
            theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-zinc-900/70 border-zinc-700/70',
            tones[tone][theme === 'light' ? 'light' : 'dark']
        )}>
            <div className={cn("flex items-center gap-2 text-xs uppercase tracking-widest", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>{icon} <span>{label}</span></div>
            <div className={cn("text-lg font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{value}</div>
        </div>
    );
});

const MetricCard = React.memo(({ label, value, icon, color, theme }: { label: string; value: string; icon: React.ReactNode; color: 'emerald' | 'yellow' | 'blue'; theme: string }) => {
    const colorMap = {
        emerald: { light: 'border-emerald-200 bg-emerald-50 text-emerald-700', dark: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' },
        yellow: { light: 'border-yellow-200 bg-yellow-50 text-yellow-700', dark: 'border-yellow-500/20 bg-yellow-500/10 text-yellow-400' },
        blue: { light: 'border-blue-200 bg-blue-50 text-blue-700', dark: 'border-blue-500/20 bg-blue-500/10 text-blue-400' },
    };
    const colorClass = colorMap[color][theme === 'light' ? 'light' : 'dark'];
    return (
        <div className={cn("rounded-lg border p-3 flex flex-col gap-2", colorClass)}>
            <div className="flex items-center gap-1.5">{icon} <div className="text-xs uppercase tracking-widest">{label}</div></div>
            <div className="text-lg font-bold font-mono">{value}</div>
        </div>
    );
});

export default Mining;
