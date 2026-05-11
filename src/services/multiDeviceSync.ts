/**
 * Multi-Device Synchronization Service
 * Синхронізує дані майнінгу між пристроями через Solana blockchain + IPFS/Server
 */

export interface DeviceSyncData {
  deviceId: string;
  walletPublicKey: string;
  lastUpdate: number;
  currentHashrate: number;
  totalHashesComputed: number;
  totalShares: number;
  accumulatedRewards: number;
  deviceName: string;
  uptime: number;
  temperature?: number;
  power?: number;
  mode: 'mining' | 'benchmark' | 'idle';
}

export interface SyncMessage {
  type: 'device_stats' | 'heartbeat' | 'reward_notification';
  data: DeviceSyncData;
  signature: string; // signed by Solana wallet
}

/**
 * Сервіс для синхронізації даних між пристроями
 * На разі використовує локальне сховище + socket connections
 * В майбутньому можна додати:
 * - IPFS для децентралізованого сховища
 * - Solana Program для on-chain синхронізації
 * - WebSocket для real-time updates
 */
export class MultiDeviceSyncService {
  private static instance: MultiDeviceSyncService;
  private syncedDevices: Map<string, DeviceSyncData> = new Map();
  private listeners: Set<(data: DeviceSyncData[]) => void> = new Set();
  private ws: WebSocket | null = null;
  private syncInterval: NodeJS.Timeout | null = null;

  private constructor(
    private walletPublicKey: string
  ) {
    this.loadFromLocalStorage();
  }

  static getInstance(walletPublicKey: string): MultiDeviceSyncService {
    if (!MultiDeviceSyncService.instance) {
      MultiDeviceSyncService.instance = new MultiDeviceSyncService(walletPublicKey);
    }
    return MultiDeviceSyncService.instance;
  }

  /**
   * Реєстрація пристрою для синхронізації
   */
  registerDevice(data: DeviceSyncData): void {
    this.syncedDevices.set(data.deviceId, {
      ...data,
      walletPublicKey: this.walletPublicKey,
      lastUpdate: Date.now()
    });

    this.saveToLocalStorage();
    this.notifyListeners();

    console.log(`[MultiDeviceSync] Device registered: ${data.deviceName}`);
  }

  /**
   * Оновити дані пристрою
   */
  async updateDevice(deviceId: string, updates: Partial<DeviceSyncData>): Promise<void> {
    const existing = this.syncedDevices.get(deviceId);
    if (!existing) {
      console.warn(`[MultiDeviceSync] Device not found: ${deviceId}`);
      return;
    }

    const updated = {
      ...existing,
      ...updates,
      lastUpdate: Date.now()
    };

    this.syncedDevices.set(deviceId, updated);
    this.saveToLocalStorage();
    this.notifyListeners();

    // Синхронізувати з сервером/IPFS
    await this.syncWithServer(updated);
  }

  /**
   * Підписати дані синхронізації через Solana гаманець
   */
  private async signSyncData(data: DeviceSyncData): Promise<string> {
    try {
      // @ts-ignore - Phantom/Solana injection
      const wallet = window.solana || window.phantom?.solana;
      
      if (!wallet?.signMessage) {
        console.warn('[MultiDeviceSync] Wallet does not support signing or not connected');
        return '';
      }

      const message = new TextEncoder().encode(
        `MineBench Sync: ${data.deviceId} | ${data.lastUpdate} | ${data.currentHashrate}`
      );
      
      const signedMessage = await wallet.signMessage(message);
      
      // Handle both raw Uint8Array and { signature: Uint8Array } formats
      const signature = signedMessage.signature || signedMessage;
      return btoa(String.fromCharCode.apply(null, Array.from(signature)));
    } catch (err) {
      console.error('[MultiDeviceSync] Signing failed:', err);
      return '';
    }
  }

  /**
   * Отримати дані всіх пристроїв
   */
  getDevices(): DeviceSyncData[] {
    return Array.from(this.syncedDevices.values());
  }

  /**
   * Отримати дані конкретного пристрою
   */
  getDevice(deviceId: string): DeviceSyncData | undefined {
    return this.syncedDevices.get(deviceId);
  }

  /**
   * Отримати сумарну статистику всіх пристроїв
   */
  getAggregatedStats() {
    const devices = this.getDevices();
    return {
      totalHashrate: devices.reduce((sum, d) => sum + d.currentHashrate, 0),
      totalHashes: devices.reduce((sum, d) => sum + d.totalHashesComputed, 0),
      totalShares: devices.reduce((sum, d) => sum + d.totalShares, 0),
      totalRewards: devices.reduce((sum, d) => sum + d.accumulatedRewards, 0),
      deviceCount: devices.length,
      averageUptime: devices.length > 0
        ? devices.reduce((sum, d) => sum + d.uptime, 0) / devices.length
        : 0
    };
  }

  /**
   * Підписатися на оновлення
   */
  subscribe(callback: (devices: DeviceSyncData[]) => void): () => void {
    this.listeners.add(callback);
    // Відразу виклик з поточними даними
    callback(this.getDevices());

    // Повернути функцію для відписки
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Запустити периодичну синхронізацію
   */
  startSyncLoop(intervalMs = 30000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        await this.syncAllDevices();
      } catch (err) {
        console.error('[MultiDeviceSync] Sync loop error:', err);
      }
    }, intervalMs);

    console.log(`[MultiDeviceSync] Sync loop started (${intervalMs}ms interval)`);
  }

  /**
   * Зупинити періодичну синхронізацію
   */
  stopSyncLoop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[MultiDeviceSync] Sync loop stopped');
    }
  }

  /**
   * Підключитися до WebSocket сервера для real-time синхронізації
   */
  async connectWebSocket(wsUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[MultiDeviceSync] WebSocket connected');
          // Відправити регістрацію
          this.ws?.send(JSON.stringify({
            type: 'register',
            walletPublicKey: this.walletPublicKey,
            devices: Array.from(this.syncedDevices.values())
          }));
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: SyncMessage = JSON.parse(event.data);
            this.handleSyncMessage(message);
          } catch (err) {
            console.error('[MultiDeviceSync] Failed to parse message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[MultiDeviceSync] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[MultiDeviceSync] WebSocket disconnected');
          this.ws = null;
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Розпочати голосування для консенсусу поточного хешрейту та винаград
   * (в майбутньому для запобігання спуфінгу)
   */
  async initiateDeviceVote(deviceId: string): Promise<boolean> {
    // TODO: Реалізувати консенсус механізм через Solana program
    // На разі просто зберігаємо дані локально
    console.log(`[MultiDeviceSync] Device vote initiated for: ${deviceId}`);
    return true;
  }

  // ============ Private Methods ============

  private notifyListeners(): void {
    const devices = this.getDevices();
    for (const listener of this.listeners) {
      listener(devices);
    }
  }

  private saveToLocalStorage(): void {
    try {
      const data = Array.from(this.syncedDevices.entries());
      localStorage.setItem(
        `minebench_sync_${this.walletPublicKey}`,
        JSON.stringify(data)
      );
    } catch (err) {
      console.error('[MultiDeviceSync] Failed to save to localStorage:', err);
    }
  }

  private loadFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem(
        `minebench_sync_${this.walletPublicKey}`
      );
      if (stored) {
        const data = JSON.parse(stored) as Array<[string, DeviceSyncData]>;
        this.syncedDevices = new Map(data);
        console.log(`[MultiDeviceSync] Loaded ${data.length} devices from storage`);
      }
    } catch (err) {
      console.error('[MultiDeviceSync] Failed to load from localStorage:', err);
    }
  }

  private async syncWithServer(data: DeviceSyncData): Promise<void> {
    try {
      const signature = await this.signSyncData(data);
      const { getEnvironmentConfig } = await import('../config/environment');
      const env = getEnvironmentConfig();
      const apiUrl = env.apiBaseUrl.replace(/\/+$/, '') + '/sync/device-update';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('minebench_auth_token') || ''}`
        },
        body: JSON.stringify({
          walletPublicKey: this.walletPublicKey,
          deviceData: data,
          signature
        })
      });

      if (!response.ok) {
        console.warn(`[MultiDeviceSync] Server sync failed (${response.status})`);
      } else {
        console.log(`[MultiDeviceSync] Synced ${data.deviceName} with server`);
      }
    } catch (err) {
      console.error('[MultiDeviceSync] Failed to sync with server:', err);
    }
  }

  private async syncAllDevices(): Promise<void> {
    const devices = this.getDevices();
    if (devices.length === 0) {
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Відправити через WebSocket
      for (const device of devices) {
        this.ws.send(JSON.stringify({
          type: 'device_stats',
          data: device,
          signature: '' // TODO: Solana sign
        }));
      }
    } else {
      // Відправити через HTTP
      for (const device of devices) {
        await this.syncWithServer(device);
      }
    }
  }

  private handleSyncMessage(message: SyncMessage): void {
    console.log('[MultiDeviceSync] Received sync message:', message.type);

    switch (message.type) {
      case 'device_stats':
        // Оновити дані пристрою від іншого середовища
        if (message.data.deviceId !== this.getDevices()[0]?.deviceId) {
          this.registerDevice(message.data);
        }
        break;

      case 'reward_notification':
        // Сповіщення про нові винагороди
        console.log(`[MultiDeviceSync] Reward updated: ${message.data.accumulatedRewards} XMR`);
        break;

      case 'heartbeat':
        // Перевірка живості пристрою
        this.updateDevice(message.data.deviceId, {
          lastUpdate: Date.now()
        });
        break;
    }
  }
}
