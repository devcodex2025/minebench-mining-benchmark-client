/**
 * Solana Authentication Context & Store
 * Управління користувацькою аутентифікацією через Solana гаманець
 */

import { create } from 'zustand';
import { PublicKey } from '@solana/web3.js';
import { useMinerStore } from '../store/useMinerStore';
import { nativeApi } from '../lib/native-api';
import { authStorage } from '../lib/auth-storage';
import { BackendApiError, backendJson } from '../lib/backend-api';
// ... (interfaces remain same)

const AUTH_MESSAGE_PREFIX = 'MineBench Authentication Hook: ';
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

const buildAuthMessage = (publicKey: string) => `${AUTH_MESSAGE_PREFIX}${publicKey}`;

const getSignatureBytes = (signature: any): Uint8Array => {
  const raw = signature?.signature ?? signature;
  if (raw instanceof Uint8Array) return raw;
  if (Array.isArray(raw)) return new Uint8Array(raw);
  throw new Error('Wallet returned unsupported signature format');
};

const decodeBase64 = (value: string): Uint8Array | null => {
  try {
    const binary = atob(value);
    return new Uint8Array(Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
};

const encodeBase58 = (bytes: Uint8Array): string => {
  const digits = [0];

  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let output = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    output += BASE58_ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    output += BASE58_ALPHABET[digits[i]];
  }
  return output;
};

const normalizeSignature = (signature: string) => {
  const decoded = decodeBase64(signature);
  return decoded?.length === 64 ? encodeBase58(decoded) : signature;
};

export interface SolanaUser {
  publicKey: string;
  displayName?: string;
  avatar?: string;
  createdAt: number;
  walletType: 'phantom' | 'magic-eden' | 'ledger' | 'browser' | 'unknown';
  isVerified: boolean;
}

export interface MiningDevice {
  id: string; // unique device ID
  name: string;
  publicKey: string;
  deviceType: 'cpu' | 'gpu';
  totalHashrate: number;
  lastSeen: number;
  isActive: boolean;
  totalRewards: number;
}

export interface UserMiningStats {
  totalRewards: number; // BMT available (bmt_available)
  totalXmrMined?: number; // total XMR earned from pool
  totalBmtEarned?: number; // total BMT ever credited
  totalBmtWithdrawn?: number; // total BMT withdrawn
  activeBmt?: number;
  paidBmt?: number;
  activeShares?: number;
  paidShares?: number;
  activeWindowUserShares?: number;
  activeWindowPoolShares?: number;
  activeWindowRewardSharePercent?: number;
  thisMonth: number;
  thisWeek: number;
  today: number;
  devices: MiningDevice[];
  poolBalance: number; // XMR in pool
  totalBlocks: number; // blocks found
}

export interface RewardHistoryEntry {
  id?: string;
  amount: number;
  currency: 'XMR' | 'BMT';
  type: string;
  reference_id?: string | null;
  metadata?: any;
  created_at: string;
}

interface SolanaAuthState {
  // User info
  user: SolanaUser | null;
  isConnected: boolean;
  isConnecting: boolean;

  // Mining stats
  miningStats: UserMiningStats | null;
  statsLoading: boolean;

  // Multi-device
  devices: MiningDevice[];

  // Actions
  setUser: (user: SolanaUser | null) => void;
  setConnecting: (loading: boolean) => void;
  setMiningStats: (stats: UserMiningStats) => void;
  addDevice: (device: MiningDevice) => void;
  updateDevice: (id: string, updates: Partial<MiningDevice>) => void;
  removeDevice: (id: string) => void;

  // Logout
  disconnect: () => void;
}

export const useSolanaAuth = create<SolanaAuthState>((set) => ({
  user: null,
  isConnected: false,
  isConnecting: false,
  miningStats: null,
  statsLoading: false,
  devices: [],

  setUser: (user) =>
    set({
      user,
      isConnected: !!user,
      isConnecting: false
    }),

  setConnecting: (isConnecting) => set({ isConnecting }),

  setMiningStats: (miningStats) =>
    set({
      miningStats,
      statsLoading: false
    }),

  addDevice: (device) =>
    set((state) => ({
      devices: [...state.devices, device]
    })),

  updateDevice: (id, updates) =>
    set((state) => ({
      devices: state.devices.map((d) =>
        d.id === id ? { ...d, ...updates } : d
      )
    })),

  removeDevice: (id) =>
    set((state) => ({
      devices: state.devices.filter((d) => d.id !== id)
    })),

  disconnect: () =>
    set({
      user: null,
      isConnected: false,
      miningStats: null,
      devices: []
    })
}));

/**
 * Сервіс для роботи із Solana гаманцем
 */
export class SolanaAuthService {
  private static instance: SolanaAuthService;

  private constructor() { }

  static getInstance(): SolanaAuthService {
    if (!SolanaAuthService.instance) {
      SolanaAuthService.instance = new SolanaAuthService();
    }
    return SolanaAuthService.instance;
  }

  /**
   * Підключити Solana гаманець через системний браузер (для native) або напряму (для web)
   */
  async connectWallet(): Promise<SolanaUser> {
    try {
      useSolanaAuth.getState().setConnecting(true);

      console.log('[SolanaAuth] Starting wallet connection...');

      // Check if running in Tauri
      if ((window as any).__TAURI_INTERNALS__) {
        console.log('[SolanaAuth] Using Native browser flow');
        const result = await nativeApi.invoke<any>('solana_connect_wallet');
        console.log('[SolanaAuth] Wallet connected:', result.publicKey);

        const user: SolanaUser = {
          publicKey: result.publicKey,
          displayName: result.publicKey.slice(0, 8) + '...',
          createdAt: Date.now(),
          walletType: 'phantom',
          isVerified: true
        };

        if (!result.message) {
          throw new Error('Wallet callback did not include signed message. Refresh minebench.cloud and try again.');
        }
        const signature = normalizeSignature(result.signature);
        authStorage.setSignature(signature);
        await this.login(result.publicKey, signature, result.message);

        // Store user after backend auth succeeds so reward/report calls have a JWT.
        useSolanaAuth.getState().setUser(user);
        localStorage.setItem('minebench_user', JSON.stringify(user));

        // Sync premium status to MinerStore
        const { setIsPremium, setPremiumXmrWallet } = useMinerStore.getState();
        setIsPremium(!!result.isPremium);
        if (result.premiumXmrWallet) {
          setPremiumXmrWallet(result.premiumXmrWallet);
        }

        console.log('[SolanaAuth] User authenticated successfully');
        return user;
      }

      console.log('[SolanaAuth] Using web wallet flow');

      // Для web - використовуємо window.solana напряму
      // @ts-ignore - Phantom wallet injection
      const wallet = window.solana || window.phantom?.solana;

      if (!wallet) {
        throw new Error('Phantom wallet not installed. Please install from https://phantom.app');
      }

      // Connect
      await wallet.connect();
      const publicKey = wallet.publicKey.toString();
      if (!wallet.signMessage) {
        throw new Error('Wallet does not support message signing');
      }

      const message = buildAuthMessage(publicKey);
      const signedMessage = await wallet.signMessage(new TextEncoder().encode(message), 'utf8');
      const signature = encodeBase58(getSignatureBytes(signedMessage));
      await this.login(publicKey, signature, message);
      authStorage.setSignature(signature);

      const user: SolanaUser = {
        publicKey,
        displayName: publicKey.slice(0, 8) + '...',
        createdAt: Date.now(),
        walletType: this.detectWalletType(wallet),
        isVerified: false
      };

      // Store user
      useSolanaAuth.getState().setUser(user);

      // Save to localStorage
      localStorage.setItem('minebench_user', JSON.stringify(user));

      return user;
    } catch (err) {
      useSolanaAuth.getState().setConnecting(false);
      throw new Error(`Failed to connect wallet: ${err}`);
    }
  }

  /**
   * Відключити гаманець
   */
  async disconnectWallet(): Promise<void> {
      try {
        // Відключаємо напряму через localStorage
        useSolanaAuth.getState().disconnect();
        localStorage.removeItem('minebench_user');
        authStorage.clearSecrets();

        // Для web - відключаємо напряму
        // @ts-ignore
        const wallet = window.solana || window.phantom?.solana;
        if (wallet?.disconnect) {
          await wallet.disconnect();
        }
      } catch (err) {
        console.error('Failed to disconnect wallet:', err);
      }
    }

  /**
   * Login with backend using wallet signature
   */
  async login(walletAddress: string, signature: string, message: string): Promise<string> {
    try {
      const { token } = await backendJson<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: {
          walletAddress,
          signature,
          message
        }
      });
      authStorage.setToken(token);

      // Fetch stats immediately after login
      await this.fetchMiningStats(walletAddress);

      return token;
    } catch (err) {
      console.error('[SolanaAuth] Login error:', err);
      throw err;
    }
  }

  /**
   * Повідомити гаманець про підключення пристрою
   */
  async registerDevice(device: MiningDevice): Promise<void> {
    const user = useSolanaAuth.getState().user;
    if (!user) {
      throw new Error('User not authenticated');
    }

    try {
      // @ts-ignore
      const wallet = window.solana || window.phantom?.solana;

      // Підписати повідомлення про пристрій
      const message = new TextEncoder().encode(
        JSON.stringify({
          action: 'register_device',
          deviceId: device.id,
          deviceName: device.name,
          timestamp: Date.now()
        })
      );

      const signature = await wallet.signMessage(message);

      // Збереження пристрою в store
      useSolanaAuth.getState().addDevice(device);

      // Синхронізувати з серверомз (якщо існує)
      await this.syncDeviceWithServer(user.publicKey, device, signature);

      console.log(`[SolanaAuth] Device registered: ${device.name}`);
    } catch (err) {
      console.error('Failed to register device:', err);
      throw err;
    }
  }

  /**
   * Отримати статистику майнінгу користувача
   */
  async fetchMiningStats(publicKey: string): Promise<UserMiningStats> {
    try {
      const storedToken = authStorage.getToken();

      // If we don't have a token, we might need to login
      if (!storedToken) {
        console.log('[SolanaAuth] No session token found, using guest stats');
        return this.getEmptyStats();
      }

      let balanceData: any;
      try {
        balanceData = await backendJson('/api/rewards/balance', { token: storedToken });
      } catch (err) {
        if (err instanceof BackendApiError && err.status === 401) {
          console.warn('[SolanaAuth] Session expired');
          authStorage.removeToken();
        }
        return this.getEmptyStats();
      }
      const toNum = (v: any) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const bmtBalance = toNum(balanceData?.bmt_available ?? balanceData?.available_bmt ?? balanceData?.balance ?? 0);
      const totalXmrMined = toNum(balanceData?.total_xmr_mined ?? balanceData?.xmr_total_earned ?? 0);
      const totalBmtEarned = toNum(balanceData?.total_bmt_earned ?? balanceData?.bmt_total_earned ?? 0);
      const totalBmtWithdrawn = toNum(balanceData?.total_bmt_withdrawn ?? balanceData?.bmt_total_withdrawn ?? 0);
      const activeBmt = toNum(balanceData?.active_bmt ?? bmtBalance);
      const paidBmt = toNum(balanceData?.paid_bmt ?? totalBmtWithdrawn);
      const activeShares = toNum(balanceData?.active_shares ?? 0);
      const paidShares = toNum(balanceData?.paid_shares ?? 0);
      const activeWindowUserShares = toNum(balanceData?.active_window_user_shares ?? 0);
      const activeWindowPoolShares = toNum(balanceData?.active_window_pool_shares ?? 0);
      const activeWindowRewardSharePercent = toNum(balanceData?.active_window_reward_share_percent ?? 0);

      // Update miner store with confirmed balance and totals
      const { setDbTotalBMT, setIsPremium, setPremiumXmrWallet } = useMinerStore.getState();
      setDbTotalBMT(bmtBalance);

      // Check premium status via direct fetch
            try {
              const premiumData = await backendJson<any>('/api/user/premium-status', { token: storedToken });
              setIsPremium(!!premiumData.isPremium);
              if (premiumData.xmrWallet) {
                setPremiumXmrWallet(premiumData.xmrWallet);
              }
            } catch (e) {
              console.warn('[SolanaAuth] Failed to fetch premium status:', e);
            }

      const stats: UserMiningStats = {
        totalRewards: bmtBalance,
        totalXmrMined,
        totalBmtEarned,
        totalBmtWithdrawn,
        activeBmt,
        paidBmt,
        activeShares,
        paidShares,
        activeWindowUserShares,
        activeWindowPoolShares,
        activeWindowRewardSharePercent,
        thisMonth: 0,
        thisWeek: 0,
        today: 0,
        devices: useSolanaAuth.getState().devices,
        poolBalance: 0,
        totalBlocks: 0
      };

      useSolanaAuth.getState().setMiningStats(stats);
      return stats;
    } catch (err) {
      console.error('[SolanaAuth] Failed to fetch mining stats:', err);
      return this.getEmptyStats();
    }
  }

  async requestPayout(amount: number): Promise<any> {
    const storedToken = authStorage.getToken();
    if (!storedToken) {
      throw new Error('Authentication required');
    }

    return backendJson('/api/rewards/claim', {
      method: 'POST',
      token: storedToken,
      body: { amount }
    });
  }

  async reportMiningStats(params: {
    hashrate?: number;
    shares?: number;
    source: 'mining' | 'benchmark' | 'stress-test';
    referenceId: string;
    metadata?: any;
  }): Promise<void> {
    const storedToken = authStorage.getToken();
    if (!storedToken) return;

    await backendJson('/api/miner/report', {
      method: 'POST',
      token: storedToken,
      body: {
        hashrate: Number(params.hashrate || 0),
        shares: Number(params.shares || 0),
        timestamp: Date.now(),
        source: params.source,
        referenceId: params.referenceId,
        metadata: params.metadata || {}
      }
    });
  }

  async fetchRewardHistory(limit = 30): Promise<RewardHistoryEntry[]> {
    const storedToken = authStorage.getToken();
    if (!storedToken) return [];

    const payload = await backendJson(`/api/rewards/history?limit=${limit}`, { token: storedToken }).catch(() => []);
    return Array.isArray(payload) ? payload : [];
  }

  private getEmptyStats(): UserMiningStats {
    return {
      totalRewards: 0,
      totalXmrMined: 0,
      totalBmtEarned: 0,
      totalBmtWithdrawn: 0,
      activeBmt: 0,
      paidBmt: 0,
      activeShares: 0,
      paidShares: 0,
      activeWindowUserShares: 0,
      activeWindowPoolShares: 0,
      activeWindowRewardSharePercent: 0,
      thisMonth: 0,
      thisWeek: 0,
      today: 0,
      devices: useSolanaAuth.getState().devices,
      poolBalance: 0,
      totalBlocks: 0
    };
  }

  /**
   * Перевірити чи гаманець все ще підключений
   */
  async verifyConnection(): Promise<boolean> {
    try {
      // Перевіряємо наявність збереженого user та signature
      const storedUser = localStorage.getItem('minebench_user');
      const storedSignature = authStorage.getSignature();

      if ((window as any).__TAURI_INTERNALS__) {
        return !!(storedUser && storedSignature);
      }

      // Для web flow - перевіряємо підключення через window.solana
      // @ts-ignore
      const wallet = window.solana || window.phantom?.solana;
      return wallet && wallet.isConnected;
    } catch {
      return false;
    }
  }

  /**
   * Завантажити користувача з localStorage
   */
  loadUserFromStorage(): SolanaUser | null {
    try {
      const stored = localStorage.getItem('minebench_user');
      if (stored) {
        const user = JSON.parse(stored) as SolanaUser;
        useSolanaAuth.getState().setUser(user);
        return user;
      }
    } catch (err) {
      console.error('Failed to load user from storage:', err);
    }
    return null;
  }

  /**
   * Приватний метод для визначення типу гаманця
   */
  private detectWalletType(
    wallet: any
  ): 'phantom' | 'magic-eden' | 'ledger' | 'unknown' {
    if (wallet.isPhantom) return 'phantom';
    if (wallet.isMagicEden) return 'magic-eden';
    if (wallet.isLedger) return 'ledger';
    return 'unknown';
  }

  /**
   * Приватний метод для синхронізації пристрою з серверомз
   */
  private async syncDeviceWithServer(
    publicKey: string,
    device: MiningDevice,
    signature: any
  ): Promise<void> {
    try {
      // TODO: Надіслати на backend для верифікації та зберігання
      console.log('[SolanaAuth] Syncing device with server (TODO)');
    } catch (err) {
      console.error('Failed to sync device with server:', err);
      // Non-fatal error - device still works locally
    }
  }
}
