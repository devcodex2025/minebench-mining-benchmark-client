/**
 * Solana Authentication Context & Store
 * Управління користувацькою аутентифікацією через Solana гаманець
 */

import { create } from 'zustand';
import { useMinerStore } from '../store/useMinerStore';
import { nativeApi } from '../lib/native-api';
import { authStorage } from '../lib/auth-storage';
import { BackendApiError, backendJson } from '../lib/backend-api';
import { mapRewardsBalanceToMiningStats } from './miningStatsMapper';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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

/** Decode a JWT `exp` (ms) without verifying the signature; used only to schedule refresh. */
const decodeJwtExpiry = (token: string): number | null => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized));
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
};

export type WalletType = 'phantom' | 'solflare' | 'backpack' | 'glow' | 'magic-eden' | 'ledger' | 'browser' | 'unknown';

export interface SolanaUser {
  publicKey: string;
  displayName?: string;
  avatar?: string;
  createdAt: number;
  walletType: WalletType;
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
  minClaimBmt?: number;
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
  currentWindow?: {
    moneroWindowNumber: number;
    windowKey: string;
    totalPoolShares: number;
    totalAcceptedShares: number;
    userAcceptedShares: number;
    rewardSharePercent: number;
    poolHashrate: number;
    updatedAt?: string | null;
  } | null;
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

export interface PayoutStatus {
  id: string;
  status: 'pending' | 'completed' | 'failed' | string;
  requestedAmountBmt: number;
  amountBmt: number;
  feeBmt: number;
  networkFeeSol: number;
  ataRentSol: number;
  totalSolCost: number;
  txSignature: string | null;
  errorMessage: string | null;
  batchKind: 'existing_ata' | 'missing_ata';
  batchTargetSize: number;
  batchFilled: number;
  batchRemaining: number;
  queuePosition: number;
  positionInBatch: number;
  isEstimate: boolean;
  createdAt: string | null;
  processedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

interface SolanaAuthState {
  // User info
  user: SolanaUser | null;
  isConnected: boolean;
  isConnecting: boolean;
  sessionExpired: boolean;

  // Mining stats
  miningStats: UserMiningStats | null;
  statsLoading: boolean;

  // Multi-device
  devices: MiningDevice[];

  // Actions
  setUser: (user: SolanaUser | null) => void;
  setConnecting: (loading: boolean) => void;
  setMiningStats: (stats: UserMiningStats) => void;
  setSessionExpired: (expired: boolean) => void;
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
  sessionExpired: false,
  miningStats: null,
  statsLoading: false,
  devices: [],

  setUser: (user) =>
    set({
      user,
      isConnected: !!user,
      isConnecting: false,
      sessionExpired: false
    }),

  setConnecting: (isConnecting) => set({ isConnecting }),

  setMiningStats: (miningStats) =>
    set({
      miningStats,
      statsLoading: false
    }),

  setSessionExpired: (sessionExpired) => set({ sessionExpired }),

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
      sessionExpired: false,
      miningStats: null,
      devices: []
    })
}));

export interface LoginNonce {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Сервіс для роботи із Solana гаманцем
 */
export class SolanaAuthService {
  private static instance: SolanaAuthService;
  private startupPremiumStatusPromise: Promise<void> | null = null;
  private miningStatsRequests = new Map<string, Promise<UserMiningStats>>();
  private tokenRefreshTimer: number | null = null;

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
          walletType: 'browser',
          isVerified: true
        };

        if (!result.message) {
          throw new Error('Wallet callback did not include signed message. Refresh minebench.cloud and try again.');
        }
        const signature = normalizeSignature(result.signature);
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

      // Для web - використовуємо будь-який інжектований Solana-провайдер
      // (Wallet Standard / legacy injection): Phantom, Solflare, Backpack, Glow, Magic Eden.
      const wallet = this.getInjectedWallet();

      if (!wallet) {
        throw new Error('No Solana wallet detected. Install Phantom, Solflare, Backpack, Glow or Magic Eden and try again.');
      }

      // Connect
      const connected = await wallet.connect();
      const publicKey = (wallet.publicKey || connected?.publicKey)?.toString?.();
      if (!publicKey) {
        throw new Error('Wallet did not return a public key');
      }
      if (!wallet.signMessage) {
        throw new Error('Wallet does not support message signing');
      }

      // Server-issued single-use nonce; the wallet signs the exact server message.
      const nonce = await this.getLoginNonce(publicKey);
      const signedMessage = await wallet.signMessage(new TextEncoder().encode(nonce.message), 'utf8');
      const signature = encodeBase58(getSignatureBytes(signedMessage));
      await this.login(publicKey, signature, nonce.message);

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
        const miningStatus = useMinerStore.getState().status;
        if (miningStatus === 'running' || miningStatus === 'starting' || miningStatus === 'paused') {
          throw new Error('Stop mining before disconnecting wallet');
        }

        this.stopTokenRefresh();
        useSolanaAuth.getState().disconnect();
        localStorage.removeItem('minebench_user');
        authStorage.clearSecrets();

        // Для web - відключаємо напряму
        const wallet = this.getInjectedWallet();
        if (wallet?.disconnect) {
          await wallet.disconnect();
        }
      } catch (err) {
        console.error('Failed to disconnect wallet:', err);
        throw err;
      }
    }

  /** Fetch a single-use login nonce and the exact message to sign from the backend. */
  async getLoginNonce(walletAddress: string): Promise<LoginNonce> {
    return backendJson<LoginNonce>(`/api/auth/nonce?walletAddress=${encodeURIComponent(walletAddress)}`);
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
      // The raw login signature is a replay credential; never persist it.
      authStorage.removeSignature();
      useSolanaAuth.getState().setSessionExpired(false);
      this.scheduleTokenRefresh();

      // Fetch stats immediately after login
      await this.fetchMiningStats(walletAddress);

      return token;
    } catch (err) {
      console.error('[SolanaAuth] Login error:', err);
      throw err;
    }
  }

  /**
   * Rotate the session token before it expires so a long mining session is not
   * interrupted. Returns the new token, or null when the session is no longer valid.
   */
  async refreshSession(): Promise<string | null> {
    const token = authStorage.getToken();
    if (!token) return null;

    try {
      const { token: next } = await backendJson<{ token: string }>('/api/auth/refresh', {
        method: 'POST',
        token
      });
      if (!next) return null;
      authStorage.setToken(next);
      useSolanaAuth.getState().setSessionExpired(false);
      return next;
    } catch (err) {
      if (err instanceof BackendApiError && (err.status === 401 || err.status === 403)) {
        authStorage.removeToken();
        this.stopTokenRefresh();
        useSolanaAuth.getState().setSessionExpired(true);
      }
      // Network/5xx: keep the token and retry on the next scheduled attempt.
      return null;
    }
  }

  /**
   * Server-side session check. Network failures return true so a transient
   * outage does not tear down an otherwise valid local session.
   */
  async validateSession(): Promise<boolean> {
    const token = authStorage.getToken();
    if (!token) return false;
    try {
      await backendJson('/api/auth/session', { token });
      return true;
    } catch (err) {
      if (err instanceof BackendApiError && (err.status === 401 || err.status === 403)) {
        return false;
      }
      return true;
    }
  }

  /** Refresh the JWT five minutes before expiry, then reschedule. */
  scheduleTokenRefresh(): void {
    this.stopTokenRefresh();
    if (typeof window === 'undefined') return;
    const token = authStorage.getToken();
    if (!token) return;
    const expiry = decodeJwtExpiry(token);
    if (!expiry) return;

    const delay = Math.max(30_000, expiry - Date.now() - 5 * 60_000);
    this.tokenRefreshTimer = window.setTimeout(async () => {
      const next = await this.refreshSession();
      if (next) this.scheduleTokenRefresh();
    }, delay);
  }

  stopTokenRefresh(): void {
    if (this.tokenRefreshTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.tokenRefreshTimer);
    }
    this.tokenRefreshTimer = null;
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
      const wallet = this.getInjectedWallet();

      // Підписати повідомлення про пристрій
      const message = new TextEncoder().encode(
        JSON.stringify({
          action: 'register_device',
          deviceId: device.id,
          deviceName: device.name,
          timestamp: Date.now()
        })
      );

      const signature = await wallet?.signMessage?.(message);

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
   * Load premium status once for the current application process.
   */
  loadPremiumStatusOnStartup(): Promise<void> {
    if (this.startupPremiumStatusPromise) return this.startupPremiumStatusPromise;

    this.startupPremiumStatusPromise = (async () => {
      const storedToken = authStorage.getToken();
      if (!storedToken) return;

      try {
        const premiumData = await backendJson<{ isPremium?: boolean; xmrWallet?: string | null }>(
          '/api/user/premium-status',
          { token: storedToken }
        );
        const { setIsPremium, setPremiumXmrWallet } = useMinerStore.getState();
        setIsPremium(!!premiumData.isPremium);
        setPremiumXmrWallet(premiumData.xmrWallet || null);
      } catch (error) {
        console.warn('[SolanaAuth] Failed to load startup premium status:', error);
      }
    })();

    return this.startupPremiumStatusPromise;
  }

  /**
   * Отримати статистику майнінгу користувача
   */
  async fetchMiningStats(publicKey: string): Promise<UserMiningStats> {
    const pending = this.miningStatsRequests.get(publicKey);
    if (pending) return pending;

    const request = this.fetchMiningStatsRequest().finally(() => {
      this.miningStatsRequests.delete(publicKey);
    });
    this.miningStatsRequests.set(publicKey, request);
    return request;
  }

  private async fetchMiningStatsRequest(): Promise<UserMiningStats> {
    try {
      let storedToken = authStorage.getToken();

      // If we don't have a token, we might need to login
      if (!storedToken) {
        console.log('[SolanaAuth] No session token found, using guest stats');
        return this.getEmptyStats();
      }

      let balanceData: any;
      try {
        balanceData = await backendJson('/api/rewards/balance', { token: storedToken });
        // Successful fetch — clear any previous session-expired flag.
        useSolanaAuth.getState().setSessionExpired(false);
      } catch (err) {
        if (err instanceof BackendApiError && err.status === 401) {
          // Try a silent token refresh first so an active mining session continues.
          const refreshed = await this.refreshSession();
          if (refreshed) {
            try {
              balanceData = await backendJson('/api/rewards/balance', { token: refreshed });
              useSolanaAuth.getState().setSessionExpired(false);
            } catch (retryErr) {
              if (retryErr instanceof BackendApiError && retryErr.status === 401) {
                useSolanaAuth.getState().setSessionExpired(true);
                const empty = this.getEmptyStats();
                useSolanaAuth.getState().setMiningStats(empty);
                return empty;
              }
              throw retryErr;
            }
          } else {
            console.warn('[SolanaAuth] Session expired — showing reconnect warning');
            this.stopTokenRefresh();
            useSolanaAuth.getState().setSessionExpired(true);
            const empty = this.getEmptyStats();
            useSolanaAuth.getState().setMiningStats(empty);
            return empty;
          }
        } else {
          // Non-auth errors: preserve existing stats so UI doesn't blank out
          throw err;
        }
      }
      const bmtBalance = Number(balanceData?.bmt_available ?? balanceData?.available_bmt ?? balanceData?.balance ?? 0) || 0;

      // Update miner store with confirmed balance and totals
      const { setDbTotalBMT } = useMinerStore.getState();
      setDbTotalBMT(bmtBalance);

      const authState = useSolanaAuth.getState();
      const stats = mapRewardsBalanceToMiningStats(balanceData, authState.devices, authState.miningStats);

      authState.setMiningStats(stats);
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

  async quotePayout(amount: number): Promise<any> {
    const storedToken = authStorage.getToken();
    if (!storedToken) {
      throw new Error('Authentication required');
    }

    return backendJson('/api/rewards/claim/quote', {
      method: 'POST',
      token: storedToken,
      body: { amount }
    });
  }

  async getLatestPayoutStatus(): Promise<PayoutStatus | null> {
    const storedToken = authStorage.getToken();
    if (!storedToken) return null;
    const response = await backendJson<{ payout: PayoutStatus | null }>('/api/rewards/payout/status', {
      token: storedToken
    });
    return response.payout;
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

    const body = {
      hashrate: Number(params.hashrate || 0),
      shares: Number(params.shares || 0),
      timestamp: Date.now(),
      source: params.source,
      referenceId: params.referenceId,
      metadata: params.metadata || {}
    };

    try {
      await backendJson('/api/miner/report', { method: 'POST', token: storedToken, body });
    } catch (err) {
      // Keep reporting through a token rotation instead of silently dropping reports.
      if (err instanceof BackendApiError && err.status === 401) {
        const refreshed = await this.refreshSession();
        if (!refreshed) return;
        await backendJson('/api/miner/report', { method: 'POST', token: refreshed, body });
        return;
      }
      throw err;
    }
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
      minClaimBmt: 0.000001,
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
      // Remove any login signature persisted by older client versions.
      authStorage.removeSignature();

      const storedUser = localStorage.getItem('minebench_user');
      const storedToken = authStorage.getToken();

      if (!storedUser) return false;

      if ((window as any).__TAURI_INTERNALS__) {
        if (!storedToken) return false;
        const valid = await this.validateSession();
        if (!valid) {
          authStorage.removeToken();
          useSolanaAuth.getState().setSessionExpired(true);
        } else {
          this.scheduleTokenRefresh();
        }
        return valid;
      }

      // Для web flow - перевіряємо підключення через інжектований провайдер
      const wallet = this.getInjectedWallet();
      return !!(wallet && wallet.isConnected);
    } catch {
      return false;
    }
  }

  /**
   * Завантажити користувача з localStorage
   */
  loadUserFromStorage(): SolanaUser | null {
    try {
      // Purge any legacy persisted login signature.
      authStorage.removeSignature();
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
   * Знайти будь-який інжектований Solana-провайдер (Wallet Standard / legacy injection).
   */
  private getInjectedWallet(): any | null {
    if (typeof window === 'undefined') return null;
    const w = window as any;
    const candidates = [
      w.phantom?.solana,
      w.solflare,
      w.backpack,
      w.glow,
      w.magicEden?.solana,
      w.solana
    ];
    for (const candidate of candidates) {
      if (candidate && typeof candidate.connect === 'function') return candidate;
    }
    return null;
  }

  /**
   * Приватний метод для визначення типу гаманця
   */
  private detectWalletType(wallet: any): WalletType {
    if (wallet?.isPhantom) return 'phantom';
    if (wallet?.isSolflare) return 'solflare';
    if (wallet?.isBackpack) return 'backpack';
    if (wallet?.isGlow) return 'glow';
    if (wallet?.isMagicEden) return 'magic-eden';
    if (wallet?.isLedger) return 'ledger';
    return 'unknown';
  }

  /**
   * Приватний метод для синхронізації пристрою з серверомз
   */
  private async syncDeviceWithServer(
    _publicKey: string,
    _device: MiningDevice,
    _signature: any
  ): Promise<void> {
    try {
      // TODO: Надіслати на backend для верифікації та збереження
      console.log('[SolanaAuth] Syncing device with server (TODO)');
    } catch (err) {
      console.error('Failed to sync device with server:', err);
      // Non-fatal error - device still works locally
    }
  }
}
