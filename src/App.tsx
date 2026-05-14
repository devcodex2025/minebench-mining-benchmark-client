import React, { Suspense, lazy, useEffect, useState } from 'react';
import { MemoryRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { TitleBar } from './components/TitleBar';
import BenchmarkPage from './pages/Benchmark';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { MiningStatistics } from './pages/Statistics';
import { ThemeProvider } from './contexts/ThemeContext';
import { useTheme } from './contexts/ThemeContext';
import { useMinerStore } from './store/useMinerStore';
import { cn, formatHashrate } from './lib/utils';
import { Activity, Coins, TrendingUp, AlertTriangle, X } from './components/icons';
import { getEnvironmentConfig } from './config/environment';
import { useSolanaAuth, SolanaAuthService } from './services/solanaAuth';
import { ClaimRewardsModal } from './components/ClaimRewardsModal';
import { nativeApi } from './lib/native-api';
import { p2poolAPI } from './services/p2poolAPI';
import { backendJson } from './lib/backend-api';

const PoolMonitor = () => {
    const updatePoolStatus = useMinerStore(state => state.updatePoolStatus);
    const setPoolUrl = useMinerStore(state => state.setPoolUrl);
    const poolUrl = useMinerStore(state => state.poolUrl);
    const addLog = useMinerStore(state => state.addLog);
    const setGlobalPoolStats = useMinerStore(state => state.setGlobalPoolStats);
    const manualPoolSelection = useMinerStore(state => state.manualPoolSelection);
    const dynamicRpcHost = useMinerStore(state => state.rpcHost);
    const dynamicRpcPort = useMinerStore(state => state.rpcPort);
    const backendPrimaryPoolUrl = useMinerStore(state => state.backendPrimaryPoolUrl);
    const backendBackupPoolUrl = useMinerStore(state => state.backendBackupPoolUrl);
    
    const env = getEnvironmentConfig();
    const primaryPoolUrl = backendPrimaryPoolUrl || env.poolStratumUrl;
    const reservePoolUrl = backendBackupPoolUrl || (env.enableBackupPool ? env.poolStratumUrlBackup : '');

    useEffect(() => {
        const checkSync = async () => {
            if (!(window as any).__TAURI_INTERNALS__) return;

            // Check primary and backup CPU pools - GPU pool not deployed yet
            const poolIds = env.enableBackupPool ? ['cpu', 'cpu-backup'] : ['cpu'];
            for (const id of poolIds) {
                try {
                    // Use dynamic host/port for primary pool, fallback for backup
                    const host = id === 'cpu' ? dynamicRpcHost : env.poolRpcHostBackup;
                    const port = id === 'cpu' ? dynamicRpcPort : env.poolRpcPortBackup;
                    
                    const data = await nativeApi.pool.getSyncStatus(host, port);
                    
                    if (data) {
                        const height = data.height || 0;
                        const targetHeight = data.target_height || data.targetHeight || height;
                        const isSynced = data.synchronized || (height >= targetHeight && height > 0);
                        const progress = isSynced ? 100 : (targetHeight > 0 ? (height / targetHeight) * 100 : 0);
                        
                        updatePoolStatus(id, {
                            height,
                            targetHeight,
                            isSynced,
                            progress,
                            connected: true,
                            message: isSynced ? "Synced" : "Syncing..."
                        });
                    }
                } catch (e) {
                    console.error(`[PoolMonitor] Native Error for ${id}:`, e);
                    updatePoolStatus(id, {
                        connected: false,
                        message: "Connection Failed"
                    });
                }
            }

            const state = useMinerStore.getState();
            const primaryPool = state.pools?.['cpu'];
            const reservePool = env.enableBackupPool ? state.pools?.['cpu-backup'] : undefined;
            const primarySynced = !!(primaryPool?.isSynced && primaryPool?.progress >= 99.9);
            const reserveSynced = env.enableBackupPool && !!(reservePool?.isSynced && reservePool?.progress >= 99.9);
            const isMineBenchPool = [primaryPoolUrl, ...(env.enableBackupPool ? [reservePoolUrl] : [])].some((url) => !!url && !!poolUrl && poolUrl.includes(url));

            if (isMineBenchPool && !manualPoolSelection) {
                if (env.enableBackupPool && !primarySynced && reserveSynced && reservePoolUrl && poolUrl !== reservePoolUrl) {
                    setPoolUrl(reservePoolUrl);
                    addLog('Auto-switched to CPU Reserve NODE (primary not fully synced).');
                } else if (primarySynced && primaryPoolUrl && poolUrl !== primaryPoolUrl) {
                    setPoolUrl(primaryPoolUrl);
                    addLog('Auto-switched to CPU Primary (fully synced).');
                }
            }
        };

        const fetchPoolStats = async () => {
            try {
                const stats = await p2poolAPI.getPoolStats();
                if (stats) {
                    setGlobalPoolStats(stats.poolHashrate || 0, stats.miners || 0, stats.networkHashrate || 0);
                }
            } catch (err) {
                console.warn('[PoolMonitor] Failed to fetch pool stats:', err);
            }
        };

        checkSync();
        fetchPoolStats();
        const interval = setInterval(checkSync, 10000); // Check every 10s
        const statsInterval = setInterval(fetchPoolStats, 60000); // Check pool stats every 60s

        return () => {
            clearInterval(interval);
            clearInterval(statsInterval);
        };
    }, [updatePoolStatus, setPoolUrl, poolUrl, addLog, primaryPoolUrl, reservePoolUrl, setGlobalPoolStats, manualPoolSelection, dynamicRpcHost, dynamicRpcPort]);

    return null;
};

// Linux Display Warning Banner
const DisplayWarningBanner = () => {
    const { theme } = useTheme();
    const [displayStatus, setDisplayStatus] = useState<any>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if ((window as any).__TAURI_INTERNALS__) {
            nativeApi.system.getDisplayStatus().then(status => {
                setDisplayStatus(status);
            }).catch(err => {
                console.error('Failed to get display status:', err);
            });
        }
    }, []);

    if (!displayStatus || dismissed || displayStatus.displayWarnings.length === 0) {
        return null;
    }

    return (
        <div className={cn(
            "w-full px-4 py-3 flex items-start gap-3 border-b",
            theme === 'light'
                ? 'bg-yellow-50 border-yellow-200'
                : 'bg-yellow-950/30 border-yellow-900/50'
        )}>
            <AlertTriangle size={18} className={cn(
                "flex-shrink-0 mt-0.5",
                theme === 'light' ? 'text-yellow-700' : 'text-yellow-500'
            )} />
            <div className="flex-1 text-sm">
                <p className={cn("font-medium mb-1", theme === 'light' ? 'text-yellow-900' : 'text-yellow-200')}>
                    Display Configuration Issue
                </p>
                <ul className={cn("text-xs space-y-0.5 ml-4 list-disc", theme === 'light' ? 'text-yellow-800' : 'text-yellow-300')}>
                    {displayStatus.displayWarnings.map((warning: string, i: number) => (
                        <li key={i}>{warning}</li>
                    ))}
                </ul>
                {displayStatus.isLinux && (
                    <p className={cn("text-xs mt-2", theme === 'light' ? 'text-yellow-700' : 'text-yellow-400')}>
                        <strong>Solution:</strong> Run without sudo: <code className={cn("px-1 rounded", theme === 'light' ? 'bg-yellow-100' : 'bg-black/30')}>./MineBench\ Client-0.3.0.AppImage</code>
                    </p>
                )}
            </div>
            <button
                onClick={() => setDismissed(true)}
                className={cn(
                    "flex-shrink-0 p-1 rounded hover:bg-yellow-200/50 transition-colors",
                    theme === 'light' ? 'text-yellow-600' : 'text-yellow-400'
                )}
                aria-label="Dismiss warning"
            >
                <X size={16} />
            </button>
        </div>
    );
};

const MiningPage = lazy(() => import('./pages/Mining'));
const StressTestPage = lazy(() => import('./pages/StressTest'));

const Dashboard = () => {
    const {
        pools,
        dbTotalBMT,
        deviceType,
        poolHashrateTotal,
        poolMinersCount,
        poolNetworkHashrate,
        xmrUsd,
        bmtUsd,
        rateXmrBmt,
        ratesLastUpdated,
        status
    } = useMinerStore();
    const { user, isConnected, miningStats } = useSolanaAuth();
    const { theme } = useTheme();

    // Periodically sync confirmed balance from DB
    useEffect(() => {
        if (!isConnected || !user?.publicKey) return;

        const syncConfirmed = async () => {
            try {
                await SolanaAuthService.getInstance().fetchMiningStats(user.publicKey);
            } catch (e) {
                console.error('[Dashboard] Error syncing confirmed balance:', e);
            }
        };

        syncConfirmed();
        const interval = setInterval(syncConfirmed, 60000); // Sync every minute
        return () => clearInterval(interval);
    }, [isConnected, user?.publicKey]);

    // Fetch exchange rates on Dashboard mount
    useEffect(() => {
        const fetchRates = async () => {
            try {
                const data = await backendJson('/api/rates/current');

                const nextXmrUsd = Number(data?.xmr_usd || 0);
                const nextBmtUsd = Number(data?.bmt_usd || 0);
                const nextRate = Number(data?.rate_xmr_bmt || 0);

                // Update store with rates
                const { setExchangeRates } = useMinerStore.getState();
                setExchangeRates(
                    Number.isFinite(nextXmrUsd) ? nextXmrUsd : 0,
                    Number.isFinite(nextBmtUsd) ? nextBmtUsd : 0,
                    Number.isFinite(nextRate) ? nextRate : 0
                );
            } catch (err) {
                console.warn('[Dashboard] Failed to fetch rates:', err);
            }
        };

        fetchRates();
    }, []);

    const cpuPool = pools['cpu'];
    const poolLabels: Record<string, string> = {
        'cpu': 'CPU Primary',
        'cpu-backup': 'CPU Reserve'
    };
    const navigate = useNavigate();
    const [benchmarkHashrate, setBenchmarkHashrate] = useState<number>(0);
    const [lastBenchmarkDate, setLastBenchmarkDate] = useState<Date | null>(null);
    const [benchmarkDeviceName, setBenchmarkDeviceName] = useState('');
    const [showClaimModal, setShowClaimModal] = useState(false);
    const [benchmarkRefreshKey, setBenchmarkRefreshKey] = useState(0);

    const applyEstimatedBenchmark = (benchmark: any) => {
        const avgHashrate = Number(benchmark?.avg_hashrate || 0);
        if (!Number.isFinite(avgHashrate) || avgHashrate <= 0) return false;

        const benchmarkDeviceType = String(benchmark?.device_type || '').toLowerCase();
        if (benchmarkDeviceType && benchmarkDeviceType !== deviceType.toLowerCase()) return false;

        setBenchmarkHashrate(avgHashrate);
        setBenchmarkDeviceName(benchmark.device_name || '');
        setLastBenchmarkDate(benchmark.created_at ? new Date(benchmark.created_at) : new Date());
        return true;
    };

    useEffect(() => {
        const handleBenchmarkSubmitted = (event: Event) => {
            applyEstimatedBenchmark((event as CustomEvent).detail || {});
            setBenchmarkRefreshKey((key) => key + 1);
        };
        window.addEventListener('minebench:benchmark-submitted', handleBenchmarkSubmitted);
        return () => window.removeEventListener('minebench:benchmark-submitted', handleBenchmarkSubmitted);
    }, [deviceType]);

    // Load latest benchmark from the benchmark API on mount, device changes, and completed runs.
    useEffect(() => {
        let cancelled = false;
        let hasCachedBenchmark = false;

        try {
            const cachedBenchmark = JSON.parse(localStorage.getItem('minebench_latest_benchmark') || 'null');
            hasCachedBenchmark = applyEstimatedBenchmark(cachedBenchmark);
        } catch {
            localStorage.removeItem('minebench_latest_benchmark');
        }

        const fetchLatestBenchmark = async () => {
            try {
                const isNative = (window as any).__TAURI_INTERNALS__;
                let result = isNative ? await nativeApi.miner.getLatestBenchmark(deviceType) : null;

                if (!result && !isNative) {
                    const res = await fetch('https://minebench.cloud/api/benchmarks?limit=200', { signal: AbortSignal.timeout(8000) });
                    if (res.ok) {
                        const items = await res.json();
                        result = Array.isArray(items)
                            ? items.find((item) => {
                                const avgHashrate = Number(item?.avg_hashrate || 0);
                                const itemDeviceType = String(item?.device_type || '').toLowerCase();
                                return avgHashrate > 0 && (!itemDeviceType || itemDeviceType === deviceType.toLowerCase());
                            })
                            : null;
                    }
                }

                if (cancelled) return;

                if (!applyEstimatedBenchmark(result) && !hasCachedBenchmark) {
                    setBenchmarkHashrate(0);
                    setBenchmarkDeviceName('');
                    setLastBenchmarkDate(null);
                }
            } catch (e) {
                console.warn('Failed to load latest benchmark:', e);
            }
        };

        const timeoutId = window.setTimeout(fetchLatestBenchmark, status === 'completed' ? 750 : 0);
        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [deviceType, status, benchmarkRefreshKey]);

    const safeDbTotalBMT = Number.isFinite(miningStats?.totalRewards)
        ? Number(miningStats?.totalRewards)
        : (Number.isFinite(dbTotalBMT) ? dbTotalBMT : 0);
    const MIN_CLAIM_AMOUNT = 100;
    const canClaim = safeDbTotalBMT >= MIN_CLAIM_AMOUNT;
    const claimProgress = Math.min((safeDbTotalBMT / MIN_CLAIM_AMOUNT) * 100, 100);
    const [claiming, setClaiming] = useState(false);
    const refreshConfirmedRewards = async () => {
        if (!user?.publicKey) return null;
        return SolanaAuthService.getInstance().fetchMiningStats(user.publicKey);
    };

    const handleClaimRewards = async () => {
        if (claiming) return;
        try {
            setClaiming(true);
            const latestStats = await refreshConfirmedRewards();
            const latestBalance = Number(latestStats?.totalRewards ?? useMinerStore.getState().dbTotalBMT ?? 0);

            if (latestBalance < MIN_CLAIM_AMOUNT) {
                alert(`${(MIN_CLAIM_AMOUNT - latestBalance).toFixed(2)} $BMT more to claim`);
                return;
            }

            setShowClaimModal(true);
        } catch (err: any) {
            alert(err?.message || 'Failed to refresh confirmed rewards');
        } finally {
            setClaiming(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className={cn("text-3xl font-light", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Dashboard</h1>
                <div className={cn("flex items-center gap-4 text-xs font-mono", theme === 'light' ? 'text-zinc-700' : '')}>
                    <div className="flex items-center gap-2">
                        <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Status:</span>
                        <span className={cn(
                            theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'
                        )}>{getEnvironmentConfig().enableBackupPool ? 'Multi-Node Active' : 'Single-Node Active'}</span>
                    </div>
                </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={cn(
                    "rounded-lg border px-4 py-3 flex items-center justify-between",
                    theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10'
                )}>
                    <span className={cn("text-xs uppercase tracking-wider", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Current Pool Hashrate</span>
                    <span className={cn("text-sm font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{formatHashrate(poolHashrateTotal)}</span>
                </div>
                <div className={cn(
                    "rounded-lg border px-4 py-3 flex items-center justify-between",
                    theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/50 border-white/10'
                )}>
                    <span className={cn("text-xs uppercase tracking-wider", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Miners Online</span>
                    <span className={cn("text-sm font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{poolMinersCount}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={cn("rounded-xl border p-6 relative overflow-hidden group transition-colors",
                    theme === 'light'
                        ? 'bg-emerald-50 border-emerald-200 hover:border-emerald-400'
                        : 'bg-zinc-900 border-white/5 hover:border-emerald-500/30'
                )}>
                    <div className={cn("absolute inset-0 opacity-30 group-hover:opacity-100 transition-opacity",
                        theme === 'light'
                            ? 'bg-gradient-to-br from-emerald-300/30 to-transparent'
                            : 'bg-gradient-to-br from-emerald-500/10 to-transparent'
                    )} />
                    <h3 className={cn("text-sm font-medium uppercase tracking-wider", theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Last Benchmark Hashrate</h3>
                    <p className={cn("text-3xl font-mono mt-2", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{formatHashrate(benchmarkHashrate)}</p>
                    <p className={cn("text-xs mt-1 font-mono uppercase tracking-wide", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
                        {benchmarkDeviceName || `${deviceType.toUpperCase()} device`}
                    </p>
                    <p className={cn("text-xs mt-1 font-mono", theme === 'light' ? 'text-zinc-600' : 'text-zinc-600')}>
                        {lastBenchmarkDate
                            ? `Best benchmark: ${lastBenchmarkDate.toLocaleDateString()}`
                            : 'Run a benchmark to populate this card'}
                    </p>
                </div>

                <div className={cn("rounded-xl border p-6 relative overflow-hidden group transition-colors md:col-span-2",
                    theme === 'light'
                        ? 'bg-blue-50 border-blue-200 hover:border-blue-400'
                        : 'bg-zinc-900 border-white/5 hover:border-blue-500/30'
                )}>
                    <div className={cn("absolute inset-0 opacity-30 group-hover:opacity-100 transition-opacity",
                        theme === 'light'
                            ? 'bg-gradient-to-br from-blue-300/30 to-transparent'
                            : 'bg-gradient-to-br from-blue-500/10 to-transparent'
                    )} />
                    <div className="flex justify-between items-start">
                        <div>
                            <h3 className={cn("text-sm font-medium uppercase tracking-wider", theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Verified Rewards</h3>
                            <p className={cn("text-4xl font-mono mt-2", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                                {safeDbTotalBMT.toFixed(2)} <span className={cn("text-lg", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>$BMT</span>
                            </p>
                            <p className={cn("text-xs mt-1 font-mono", theme === 'light' ? 'text-zinc-600' : 'text-zinc-600')}>
                                Confirmed from backend reward windows and accepted shares
                            </p>
                        </div>
                        <div className="text-right">
                            <h3 className={cn("text-[10px] font-bold uppercase tracking-widest text-emerald-500", theme === 'light' ? 'text-emerald-600' : '')}>Paid Rewards</h3>
                            <p className={cn("text-xl font-mono mt-1", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                                {(miningStats?.paidBmt ?? miningStats?.totalBmtWithdrawn ?? 0).toFixed(2)} <span className="text-xs text-zinc-500">$BMT</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Exchange Rates Card */}
            <div className={cn("rounded-xl border p-6 relative overflow-hidden group transition-colors",
                theme === 'light'
                    ? 'bg-white border-zinc-200 hover:border-purple-400'
                    : 'bg-zinc-900/40 border-white/5 hover:border-purple-500/30'
            )}>
                <div className={cn("absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500",
                    theme === 'light'
                        ? 'bg-gradient-to-br from-purple-300/30 to-transparent'
                        : 'bg-gradient-to-br from-purple-500/10 to-transparent'
                )} />
                <h3 className={cn("text-sm font-medium uppercase tracking-wider", theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Exchange Rates</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                    <div className="text-center">
                        <div className={cn("text-xs uppercase tracking-wide", theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                            XMR/USD
                        </div>
                        <div className={cn("text-lg font-mono font-bold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                            ${(Number.isFinite(xmrUsd) ? xmrUsd : 0).toFixed(2)}
                        </div>
                    </div>
                    <div className="text-center">
                        <div className={cn("text-xs uppercase tracking-wide", theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                            BMT/USD
                        </div>
                        <div className={cn("text-lg font-mono font-bold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                            ${(Number.isFinite(bmtUsd) ? bmtUsd : 0).toFixed(8)}
                        </div>
                    </div>
                    <div className="text-center">
                        <div className={cn("text-xs uppercase tracking-wide", theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                            XMR/BMT
                        </div>
                        <div className={cn("text-lg font-mono font-bold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                            {(Number.isFinite(rateXmrBmt) ? rateXmrBmt : 0).toFixed(0)}
                        </div>
                    </div>
                </div>
                {ratesLastUpdated && (
                    <div className={cn("text-xs mt-3 pt-2 border-t font-mono", theme === 'light' ? 'border-zinc-200 text-zinc-500' : 'border-white/10 text-zinc-500')}>
                        {ratesLastUpdated}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className={cn("border rounded-xl p-6 flex flex-col justify-between",
                    theme === 'light'
                        ? 'bg-white border-zinc-200'
                        : 'bg-zinc-900/40 border-white/5'
                )}>
                    <div className="space-y-4">
                        <div className="flex items-center gap-3">
                            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center",
                                theme === 'light'
                                    ? 'bg-emerald-100 text-emerald-600'
                                    : 'bg-emerald-500/10 text-emerald-500'
                            )}>
                                <Coins size={20} />
                            </div>
                            <div>
                                <h4 className={cn("font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Confirmed for Payout</h4>
                                <p className={cn("text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Verified rewards from backend reward accounting</p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex justify-between items-baseline">
                                <div>
                                    <div className={cn("text-3xl font-mono", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{safeDbTotalBMT.toFixed(2)} <span className={cn("text-sm", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>$BMT</span></div>
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                    <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Progress to claim</span>
                                    <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'}>{claimProgress.toFixed(1)}%</span>
                                </div>
                                <div className={cn("w-full h-2 rounded-full overflow-hidden", theme === 'light' ? 'bg-zinc-200' : 'bg-zinc-950')}>
                                    <div
                                        className={cn(
                                            "h-full transition-all duration-500",
                                            canClaim ? "bg-emerald-500" : "bg-blue-500"
                                        )}
                                        style={{ width: `${claimProgress}%` }}
                                    />
                                </div>
                                <p className={cn("text-[10px]", theme === 'light' ? 'text-zinc-600' : 'text-zinc-600')}>
                                    {canClaim ? 'Ready to claim!' : `${(MIN_CLAIM_AMOUNT - safeDbTotalBMT).toFixed(2)} $BMT more to claim`}
                                </p>
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleClaimRewards}
                        disabled={!isConnected || !user?.publicKey || claiming}
                        className={cn(
                            "w-full mt-4 py-3 rounded-lg font-bold text-sm tracking-wide transition-all transform",
                            canClaim && !claiming
                                ? "bg-emerald-500 text-zinc-950 hover:bg-emerald-400 hover:shadow-[0_0_20px_rgba(16,185,129,0.4)] active:scale-[0.98]"
                                : theme === 'light'
                                    ? "bg-zinc-300 text-zinc-500 cursor-not-allowed"
                                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                        )}
                    >
                        <div className="flex items-center justify-center gap-2">
                            <TrendingUp size={16} />
                            {claiming
                                ? 'Creating claim...'
                                : canClaim
                                    ? `Claim ${safeDbTotalBMT.toFixed(2)} $BMT`
                                    : `Claim (Min. ${MIN_CLAIM_AMOUNT} $BMT)`}
                        </div>
                    </button>
                </div>
            </div>

            <ClaimRewardsModal
                isOpen={showClaimModal}
                onClose={() => setShowClaimModal(false)}
                wallet={user?.publicKey || ''}
                availableBalance={safeDbTotalBMT}
                theme={theme}
                onClaimed={async () => {
                    await refreshConfirmedRewards();
                }}
            />
        </div>
    );
};

const Placeholder = ({ name }: { name: string }) => <div className="text-2xl font-bold p-6">{name} (Under Construction)</div>;

const App: React.FC = () => {
    // Fetch public configuration on mount
    useEffect(() => {
        const isNative = (window as any).__TAURI_INTERNALS__;
        if (!isNative) return;
        const { fetchPublicConfig } = useMinerStore.getState();
        fetchPublicConfig();
    }, []);

    return (
        <ThemeProvider>
            <Router>
                <TitleBar />
                <DisplayWarningBanner />
                <PoolMonitor />
                <Layout>
                    <Suspense fallback={<div className="p-10 text-zinc-500 italic">Loading components...</div>}>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/benchmark" element={<BenchmarkPage />} />
                            <Route path="/mining" element={<MiningPage />} />
                            <Route path="/stress-test" element={<StressTestPage />} />
                            <Route path="/statistics" element={<MiningStatistics />} />
                            <Route path="/logs" element={<Logs />} />
                            <Route path="/settings" element={<Settings />} />
                        </Routes>
                    </Suspense>
                </Layout>
            </Router>
        </ThemeProvider>
    );
};

export default App;


