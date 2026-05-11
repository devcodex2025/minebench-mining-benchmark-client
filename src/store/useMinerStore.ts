import { create } from 'zustand';
import { getEnvironmentConfig } from '../config/environment';

export type AppMode = 'benchmark' | 'mining';
export type DeviceType = 'cpu' | 'gpu';

interface StatsPoint {
    time: string;
    hashrate: number;
    temp: number | null;
    power?: number;
}

interface MiningState {
    // Configuration
    mode: AppMode;
    deviceType: DeviceType;
    wallet: string;
    walletVerified: boolean; // Verified with Solana wallet
    solanaPublicKey?: string; // User's Solana public key for multi-device sync
    workerName: string;
    threads: number;
    cpuName: string;
    cpuCores: number;

    // Status
    status: 'idle' | 'starting' | 'running' | 'stopping' | 'paused' | 'error' | 'completed';
    isRunning: boolean;
    isPaused: boolean;

    // Metrics
    currentHashrate: number;
    currentTemp: number | null;
    currentPower: number | null;
    lastRewardUpdatedAt: number | null;

    // Rewards ($BMT)
    p2poolBalance: number; // XMR balance in P2Pool
    dbTotalBMT: number;   // Confirmed total BMT rewards from backend
    isPremium: boolean;
    premiumXmrWallet: string | null;

    // xmrig Settings
    donateLevel: number;
    poolUrl: string;
    cpuPriority: number; // 0-5, higher = more aggressive
    randomxMode: 'auto' | 'fast' | 'light'; // fast uses 2GB RAM, light uses 256MB
    hugePages: boolean;
    manualPoolSelection: boolean;

    // History
    history: StatsPoint[];
    logs: string[];

    // Pool statuses
    pools: {
        [key: string]: {
            isSynced: boolean;
            height: number;
            targetHeight: number;
            progress: number;
            connected: boolean;
            message?: string;
            coin?: string;
        };
    };

    // Global Pool Stats
    poolHashrateTotal: number;
    poolMinersCount: number;
    poolNetworkHashrate: number;

    // Exchange Rates (from Oracle)
    xmrUsd: number;
    bmtUsd: number;
    rateXmrBmt: number;
    ratesLastUpdated: string | null; // Timestamp when rates were last fetched

    // Dynamic Network Config
    rpcHost: string;
    rpcPort: number;

    // Actions
    setMode: (mode: AppMode) => void;
    setDeviceType: (type: DeviceType) => void;
    setWallet: (wallet: string) => void;
    setWorkerName: (workerName: string) => void;
    setWalletVerified: (verified: boolean, solanaKey?: string) => void;
    setStatus: (status: MiningState['status']) => void;
    setThreads: (threads: number) => void;
    setCpuInfo: (name: string, cores: number) => void;
    setDonateLevel: (level: number) => void;
    setPoolUrl: (url: string) => void;
    setCpuPriority: (priority: number) => void;
    setRandomxMode: (mode: 'auto' | 'fast' | 'light') => void;
    setHugePages: (enabled: boolean) => void;
    setDbTotalBMT: (balance: number) => void;
    setIsPremium: (isPremium: boolean) => void;
    setPremiumXmrWallet: (wallet: string | null) => void;
    setP2PoolBalance: (balance: number) => void;
    setManualPoolSelection: (manual: boolean) => void;
    addLog: (msg: string) => void;
    updateStats: (hashrate: number, temp: number | null | undefined, power?: number) => void;
    updatePoolStatus: (id: string, status: Partial<MiningState['pools'][string]>) => void;
    setGlobalPoolStats: (hashrate: number, miners: number, networkHashrate?: number) => void;
    setPoolNetworkHashrate: (networkHashrate: number) => void;
    setExchangeRates: (xmrUsd: number, bmtUsd: number, rateXmrBmt: number) => void;
    resetSession: () => void;
    saveSettings: () => void;
    loadSettings: () => void;
    fetchPublicConfig: () => Promise<void>;
}

// Types for settings persistence
interface MinerSettings {
    wallet: string;
    workerName: string;
    threads: number;
    donateLevel: number;
    poolUrl: string;
    cpuPriority: number;
    randomxMode: 'auto' | 'fast' | 'light';
    hugePages: boolean;
    deviceType: DeviceType;
    manualPoolSelection: boolean;
    updatedAt?: number;
}

const env = getEnvironmentConfig();
const initialPools = {
    'cpu': { isSynced: false, height: 0, targetHeight: 0, progress: 0, connected: false, coin: 'XMR' },
    ...(env.enableBackupPool
        ? { 'cpu-backup': { isSynced: false, height: 0, targetHeight: 0, progress: 0, connected: false, coin: 'XMR' } }
        : {})
};

export const useMinerStore = create<MiningState>((set, get) => ({
    mode: 'benchmark',
    deviceType: 'cpu',
    wallet: '48ghPqjkJYEKAL1ukr9YmB6B8V1g9kjMrFkrP36ZnVLxHRyFs9odvapQtjFkWRyjsG1N3ipHqiByjHUNrDZTsxG2DRRHWjj',
    walletVerified: false,
    solanaPublicKey: undefined,
    workerName: 'Miner-v1',
    threads: 1,
    cpuName: '',
    cpuCores: 1,

    status: 'idle',
    isRunning: false,
    isPaused: false,

    currentHashrate: 0,
    currentTemp: null,
    currentPower: null,
    lastRewardUpdatedAt: null,

    dbTotalBMT: 0,
    p2poolBalance: 0,
    isPremium: false,
    premiumXmrWallet: null,

    donateLevel: 1,
    poolUrl: env.poolStratumUrl,
    cpuPriority: 2, // Default: balanced (0=lowest, 5=highest)
    randomxMode: 'auto', // auto-detect best mode
    hugePages: true, // Enable huge pages for better performance
    manualPoolSelection: false, // Default: auto-switch between primary/backup

    history: [],
    logs: [],

    pools: {
        ...initialPools
        // GPU pool will be added when RVN node is deployed
    },

    poolHashrateTotal: 0,
    poolMinersCount: 0,
    poolNetworkHashrate: 0,

    xmrUsd: 0, // Will be fetched from backend
    bmtUsd: 0, // Will be fetched from backend
    rateXmrBmt: 0, // Will be fetched from backend
    ratesLastUpdated: null, // Timestamp when rates were last fetched

    rpcHost: env.poolRpcHost,
    rpcPort: env.poolRpcPort,

    setMode: (mode) => set({ mode }),
    setDeviceType: (deviceType) => set({ deviceType }),
    setWallet: (wallet) => set({ wallet }),
    setWorkerName: (workerName) => set({ workerName }),
    setWalletVerified: (verified, solanaKey) => set({ walletVerified: verified, solanaPublicKey: solanaKey }),
    setStatus: (status) => set((state) => ({
        status,
        isRunning: status === 'running',
        isPaused: status === 'paused',
        lastRewardUpdatedAt: status === 'running' ? state.lastRewardUpdatedAt : null
    })),
    setThreads: (threads) => set((state) => {
        const safeCores = Math.max(1, state.cpuCores || 1);
        const safeMiningMax = Math.max(1, safeCores - 1);
        const requested = Number.isFinite(threads) ? Math.floor(threads) : state.threads;
        return {
            threads: Math.min(Math.max(1, requested), safeMiningMax)
        };
    }),
    setCpuInfo: (cpuName, cpuCores) => set((state) => {
        const safeCores = Math.max(1, cpuCores || 1);
        const safeMiningMax = Math.max(1, safeCores - 1);
        const currentThreads = Number.isFinite(state.threads) && state.threads > 0
            ? state.threads
            : safeMiningMax;
        return {
            cpuName,
            cpuCores: safeCores,
            // Leave one logical thread free for the UI, OS, and Tauri IPC.
            threads: Math.min(currentThreads, safeMiningMax)
        };
    }),
    setDonateLevel: (donateLevel) => set({ donateLevel }),
    setPoolUrl: (poolUrl) => set({ poolUrl }),
    setCpuPriority: (cpuPriority) => set({ cpuPriority }),
    setRandomxMode: (randomxMode) => set({ randomxMode }),
    setHugePages: (hugePages) => set({ hugePages }),
    setDbTotalBMT: (dbTotalBMT) => set({ dbTotalBMT }),
    setIsPremium: (isPremium) => set({ isPremium }),
    setPremiumXmrWallet: (premiumXmrWallet) => set({ premiumXmrWallet }),
    setP2PoolBalance: (p2poolBalance) => set({ p2poolBalance }),
    setManualPoolSelection: (manualPoolSelection) => set({ manualPoolSelection }),
    addLog: (msg) => set((state) => ({
        logs: [...state.logs.slice(-100), `${new Date().toLocaleTimeString()} - ${msg}`]
    })),

    updatePoolStatus: (id, newStatus) => set((state) => ({
        pools: {
            ...state.pools,
            [id]: { ...state.pools[id], ...newStatus }
        }
    })),

    setGlobalPoolStats: (hashrate: number, miners: number, networkHashrate?: number) => set({
        poolHashrateTotal: hashrate,
        poolMinersCount: miners,
        poolNetworkHashrate: networkHashrate || 0
    }),

    setPoolNetworkHashrate: (networkHashrate: number) => set({ poolNetworkHashrate: networkHashrate }),

    setExchangeRates: (xmrUsd: number, bmtUsd: number, rateXmrBmt: number) => set({
        xmrUsd: Number.isFinite(xmrUsd) ? xmrUsd : 0,
        bmtUsd: Number.isFinite(bmtUsd) ? bmtUsd : 0,
        rateXmrBmt: Number.isFinite(rateXmrBmt) ? rateXmrBmt : 0,
        ratesLastUpdated: new Date().toLocaleString()
    }),

    updateStats: (hashrate: number, temp: number | null | undefined, power?: number) => set((state) => {
        const safeHashrate = hashrate || 0;
        const now = Date.now();
        return {
            currentHashrate: safeHashrate,
            currentTemp: temp,
            currentPower: power,
            lastRewardUpdatedAt: now,
            history: [...state.history.slice(-29), {
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                hashrate: safeHashrate,
                temp: temp || 0,
                power: power || 0
            }]
        };
    }),

    resetSession: () => {
        set({
            history: [],
            currentHashrate: 0,
            currentTemp: null,
            currentPower: null,
            lastRewardUpdatedAt: null,
            status: 'idle'
        });
    },

    saveSettings: () => {
        const state = get();
        const settings: MinerSettings = {
            wallet: state.wallet,
            workerName: state.workerName,
            threads: state.threads,
            donateLevel: state.donateLevel,
            poolUrl: state.poolUrl,
            cpuPriority: state.cpuPriority,
            randomxMode: state.randomxMode,
            hugePages: state.hugePages,
            deviceType: state.deviceType,
            manualPoolSelection: state.manualPoolSelection,
            updatedAt: Date.now()
        };

        try {
            // Save to localStorage
            localStorage.setItem('minerSettings', JSON.stringify(settings));

            // Also save to Electron app data for persistence
            if (window.electron?.invoke) {
                window.electron.invoke('save-miner-settings', settings).catch((err: any) => {
                    console.error('Failed to save settings to Electron:', err);
                });
            }

            console.log('✅ Miner settings saved');
        } catch (err) {
            console.error('Failed to save miner settings:', err);
        }
    },

    loadSettings: async () => {
        const state = get();
        let electronSettings: MinerSettings | null = null;
        let localSettings: MinerSettings | null = null;

        try {
            if (window.electron?.invoke) {
                const res = await window.electron.invoke('load-miner-settings');
                if (res?.success && res.settings) {
                    electronSettings = res.settings as MinerSettings;
                }
            }
        } catch (err) {
            console.error('Failed to load miner settings from Electron:', err);
        }

        try {
            const saved = localStorage.getItem('minerSettings');
            if (saved) localSettings = JSON.parse(saved) as MinerSettings;
        } catch (err) {
            console.error('Failed to load miner settings from localStorage:', err);
        }

        const electronUpdatedAt = Number(electronSettings?.updatedAt || 0);
        const localUpdatedAt = Number(localSettings?.updatedAt || 0);
        const settings = localUpdatedAt >= electronUpdatedAt
            ? (localSettings || electronSettings)
            : (electronSettings || localSettings);

        if (!settings) return;

        const legacyBackupHostSelected = !!(
            settings.poolUrl &&
            settings.poolUrl.includes('xmr2.minebench.cloud')
        );
        const nextPoolUrl = (!env.enableBackupPool && (legacyBackupHostSelected || (settings.poolUrl && settings.poolUrl.includes(env.poolStratumUrlBackup))))
            ? env.poolStratumUrl
            : (settings.poolUrl || state.poolUrl);

        set({
            wallet: settings.wallet || state.wallet,
            workerName: settings.workerName || state.workerName,
            threads: Math.min(settings.threads || state.threads, Math.max(1, state.cpuCores - 1)),
            donateLevel: settings.donateLevel ?? state.donateLevel,
            poolUrl: nextPoolUrl,
            cpuPriority: settings.cpuPriority ?? state.cpuPriority,
            randomxMode: settings.randomxMode || state.randomxMode,
            hugePages: settings.hugePages ?? state.hugePages,
            deviceType: settings.deviceType || state.deviceType,
            manualPoolSelection: settings.manualPoolSelection ?? state.manualPoolSelection
        });
    },

    fetchPublicConfig: async () => {
        try {
            const configUrl = 'https://backend.minebench.cloud/public/config';
            const response = await fetch(configUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            
            const data = await response.json();
            console.log('🌐 Public configuration loaded from backend');

            if (data.pool?.primary) {
                const { rpcHost, rpcPort, stratumHost, stratumPort } = data.pool.primary;
                
                // Update rpc config in store
                set({ rpcHost, rpcPort });
                console.log(`📡 Updated RPC node to ${rpcHost}:${rpcPort}`);
                
                const currentStore = get();
                
                // If user hasn't manually selected a pool, update to the latest from backend
                if (!currentStore.manualPoolSelection) {
                    const newPoolUrl = `${stratumHost}:${stratumPort}`;
                    if (currentStore.poolUrl !== newPoolUrl) {
                        set({ poolUrl: newPoolUrl });
                        console.log(`📡 Updated mining pool to ${newPoolUrl}`);
                    }
                }
            }

            if (data.rewards?.minClaimBmt) {
                // Potential for storing min claim amount in state if needed
            }
        } catch (err) {
            console.warn('⚠️ Failed to fetch public config from backend, using fallbacks:', err);
        }
    }
}));

