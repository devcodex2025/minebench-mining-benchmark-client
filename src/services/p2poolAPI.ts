import { getEnvironmentConfig } from '../config/environment';

/**
 * P2Pool API Service
 * Отримує статистику майнінгу та винагороди з P2Pool RPC
 */

export interface P2PoolWorkerStats {
  wallet: string;
  totalHashes: number;
  totalShares: number;
  totalReward: number; // in XMR
  lastShare: number; // timestamp
  estimatedDaily: number; // estimated XMR per day
  estimatedMonthly: number; // estimated XMR per month
  hashrate: number; // current hashrate estimate
  workers: {
    name: string;
    hashrate: number;
    shares: number;
    lastSeen: number;
  }[];
}

export interface P2PoolStats {
  poolHashrate: number;
  poolDifficulty: number;
  miners: number;
  networkHashrate?: number;
  networkDifficulty?: number;
  lastBlockTime?: number;
  rewards?: {
    totalBmtRewards: number;
    totalBmtPayouts: number;
    availableBmtRewards: number;
    rewardEntries: number;
  };
  stratum?: P2PoolStratumSnapshot;
}

export interface P2PoolStratumSnapshot {
  hashrate_15m?: number;
  hashrate_1h?: number;
  hashrate_24h?: number;
  total_hashes?: number;
  total_stratum_shares?: number;
  last_share_found_time?: number;
  shares_found?: number;
  shares_failed?: number;
  average_effort?: number;
  current_effort?: number;
  connections?: number;
  incoming_connections?: number;
  block_reward_share_percent?: number;
  wallet?: string;
  workers?: string[];
}

class P2PoolService {
  private rpcHost: string;
  private rpcPort: number;
  private staleTime = 5000; // 5 seconds cache
  private apiBaseUrl: string;
  private lastRuntimeSyncAt = 0;

  constructor(host?: string, port?: number) {
    const env = getEnvironmentConfig();
    this.rpcHost = host ?? env.poolRpcHost;
    this.rpcPort = port ?? env.poolRpcPort;
    this.apiBaseUrl = env.apiBaseUrl;
  }

  private async syncRuntimeConfig() {
    const now = Date.now();
    if (now - this.lastRuntimeSyncAt < this.staleTime) return;
    this.lastRuntimeSyncAt = now;

    try {
      if (!window.electron?.ipcRenderer) return;
      const runtimeConfig = await window.electron.ipcRenderer.invoke('get-runtime-pool-config');
      const primary = runtimeConfig?.primary;
      if (primary?.rpcHost && primary?.rpcPort) {
        this.rpcHost = primary.rpcHost;
        this.rpcPort = Number(primary.rpcPort);
      }
    } catch (err) {
      console.warn('[P2PoolAPI] Failed to sync runtime pool config:', err);
    }
  }

  private async rpcCall(method: string, params: any = {}) {
    try {
      await this.syncRuntimeConfig();

      // Try to use Electron IPC first (bypasses CORS)
      // @ts-ignore
      if (window.electron?.ipcRenderer) {
        try {
          const result = await window.electron.ipcRenderer.invoke('p2pool-rpc-call', {
            method,
            params,
            host: this.rpcHost,
            port: this.rpcPort
          });
          return result;
        } catch (ipcErr) {
          console.warn(`[P2PoolAPI] IPC call failed, falling back to fetch:`, ipcErr);
        }
      }

      // Fallback to fetch for web environment
      const response = await fetch(`http://${this.rpcHost}:${this.rpcPort}/json_rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '0',
          method,
          params
        })
      });

      if (!response.ok) throw new Error(`RPC Error: ${response.status}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      return data.result;
    } catch (err) {
      console.error(`[P2PoolAPI] RPC call failed (${method}):`, err);
      throw err;
    }
  }

  /**
   * Отримати інформацію про пул
   */
  async getPoolStats(): Promise<P2PoolStats> {
    try {
      await this.syncRuntimeConfig();

      let info = { difficulty: 0 };
      
      try {
        info = await this.rpcCall('get_info');
      } catch (p2poolErr) {
        console.warn('[P2PoolAPI] P2Pool not available, using fallback:', p2poolErr);
        // Use fallback difficulty for Monero network (current approximate)
        // Current Monero network hashrate is ~2.7-3.0 GH/s
        // Difficulty = hashrate * 120 seconds
        info.difficulty = 325000000000; // ~2.71 GH/s network hashrate
      }

      // Fetch global pool stats from MineBench backend
      let poolExtra: {
        poolHashrate: number;
        miners: number;
        rewards?: P2PoolStats['rewards'];
        stratum: P2PoolStratumSnapshot | null;
      } = {
        poolHashrate: 0,
        miners: 0,
        stratum: null
      };
      try {
        // In packaged Electron (file://) relative /api paths don't work; use absolute backend URL.
        const canUseRelativeApi = typeof window !== 'undefined'
          && (window.location.protocol === 'http:' || window.location.protocol === 'https:')
          && window.location.hostname === 'localhost';
        const poolStatsUrl = canUseRelativeApi ? '/api/pool/stats' : `${this.apiBaseUrl.replace(/\/+$/, '')}/pool/stats`;

        const res = await fetch(poolStatsUrl, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          const data = await res.json();
          poolExtra.poolHashrate = data.poolHashrate || 0;
          poolExtra.miners = data.miners || 0;
          poolExtra.rewards = data.rewards || undefined;
          poolExtra.stratum = (data && typeof data.stratum === 'object') ? data.stratum : null;
        } else {
          console.warn(`[P2PoolAPI] Backend returned status ${res.status} for pool stats`);
        }
      } catch (e) {
        console.warn(`[P2PoolAPI] Failed to fetch stats from backend: ${e}`);
      }

      return {
        // Use real hashrate from backend only; do not substitute with network estimate.
        poolHashrate: poolExtra.poolHashrate || 0,
        miners: poolExtra.miners || 0,
        poolDifficulty: info.difficulty || 0,
        networkHashrate: info.difficulty / 120,
        networkDifficulty: info.difficulty || 0,
        lastBlockTime: Date.now() - 30000, // Mock last block since get_info doesn't have it directly
        rewards: poolExtra.rewards,
        stratum: poolExtra.stratum || undefined
      };
    } catch (err) {
      console.error('[P2PoolAPI] Failed to get pool stats:', err);
      throw new Error(`Failed to get pool stats: ${err}`);
    }
  }

  /**
   * Отримати статистику worker за wallet адресою
   * ПРИМІТКА: P2Pool не предоставляє цю інформацію через стандартне RPC
   * Потрібна власна DB або integration з P2Pool API
   */
  async getWorkerStats(walletAddress: string): Promise<P2PoolWorkerStats> {
    try {
      // Тимчасово повертаємо mock дані
      // Реальна реалізація потребує:
      // 1. Custom P2Pool API endpoint
      // 2. Або парсинг P2Pool UI
      // 3. Або власна база даних для відстеження shares

      return {
        wallet: walletAddress,
        totalHashes: 0,
        totalShares: 0,
        totalReward: 0,
        lastShare: 0,
        estimatedDaily: 0,
        estimatedMonthly: 0,
        hashrate: 0,
        workers: []
      };
    } catch (err) {
      console.error('[P2PoolAPI] Failed to get worker stats:', err);
      throw err;
    }
  }

  /**
   * Розрахувати估計 винагороду на основі хешрейту
   */
  calculateEstimatedReward(
    hashrate: number, // in H/s
    networkDifficulty: number,
    blockReward: number = 4.4
  ): {
    hourly: number;
    daily: number;
    monthly: number;
  } {
    // Формула: Reward = (Your Hashrate / Network Hashrate) * Block Reward * Blocks per period
    // Monero: 1 block кожні 120 сек = 720 блоків на день

    // Network hashrate estimate (rough)
    const networkHashrate = networkDifficulty / 120;
    const shareOfNetwork = hashrate / networkHashrate;

    const blocksPerHour = (3600 / 120); // 30 блоків
    const blocksPerDay = blocksPerHour * 24; // 720 блоків
    const blocksPerMonth = blocksPerDay * 30; // 21,600 блоків

    const hourlyReward = shareOfNetwork * blocksPerHour * blockReward;
    const dailyReward = shareOfNetwork * blocksPerDay * blockReward;
    const monthlyReward = shareOfNetwork * blocksPerMonth * blockReward;

    return {
      hourly: hourlyReward,
      daily: dailyReward,
      monthly: monthlyReward
    };
  }

  /**
   * Отримати інформацію про додану вартість (BMT token)
   */
  async getBMTValue(): Promise<number> {
    try {
      // TODO: Інтегрувати з реальним API для BMT ціни
      // На разі повертаємо 0 поки не буде розроблено токен
      return 0;
    } catch (err) {
      console.error('[P2PoolAPI] Failed to get BMT value:', err);
      return 0;
    }
  }

  /**
   * Перевірити чи wallet адреса валідна для Monero
   */
  validateMoneroAddress(address: string): boolean {
    // Monero address: 95 char base58 або 106 char (integrated address)
    const moneroPrimaryPattern = /^4[0-9a-zA-Z]{94}$/;
    const moneroIntegratedPattern = /^8[0-9a-zA-Z]{105}$/;

    return moneroPrimaryPattern.test(address) || moneroIntegratedPattern.test(address);
  }

  /**
   * Отримати історію блоків (для діагностики)
   */
  async getBlockHistory(limit = 10) {
    try {
      const lastBlockHash = await this.rpcCall('getlastblockheader');
      const blocks = [lastBlockHash.block_header];

      for (let i = 1; i < limit; i++) {
        const prevHeader = await this.rpcCall('getblockheaderbyhash', {
          hash: blocks[blocks.length - 1].prev_hash
        });
        blocks.push(prevHeader.block_header);
      }

      return blocks;
    } catch (err) {
      console.error('[P2PoolAPI] Failed to get block history:', err);
      return [];
    }
  }
}

// Singleton instance
export const p2poolAPI = new P2PoolService();
