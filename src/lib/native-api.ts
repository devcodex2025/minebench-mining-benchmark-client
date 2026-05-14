import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

/**
 * Type-safe native API bridge for Tauri v2
 */
export const nativeApi = {
  /**
   * Invoke a Tauri command with snake_case naming convention
   */
  async invoke<T>(command: string, args: Record<string, any> = {}): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (err) {
      console.error(`[NativeApi] Command failed: ${command}`, err);
      throw err;
    }
  },

  /**
   * Listen for a Tauri event
   */
  async listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    return listen<T>(event, (e) => handler(e.payload));
  },

  /**
   * Open a trusted external URL.
   */
  async openExternal(url: string): Promise<void> {
    await nativeApi.invoke<void>('open_external_url', { url });
  },

  /**
   * Common system commands
   */
  system: {
    getCpuInfo: () => nativeApi.invoke<{ model: string; cores: number }>('get_cpu_info')
      .then((info) => ({ name: info.model || 'Unknown CPU', cores: info.cores || 1 })),
    getSystemStats: () => nativeApi.invoke<any>('get_system_stats'),
    getGpuSensors: () => nativeApi.invoke<any>('get_gpu_sensors'),
    getAutoStart: () => nativeApi.invoke<any>('get_auto_start')
      .then((result) => typeof result === 'boolean' ? result : !!result?.enabled),
    setAutoStart: async (enabled: boolean) => {
      const result = await nativeApi.invoke<any>('set_auto_start', { enabled });
      if (result?.supported === false || result?.success === false) {
        throw new Error('Auto-start is not supported in this build');
      }
    },
    getProcessStats: () => nativeApi.invoke<any>('get_process_stats'),
    getDisplayStatus: () => nativeApi.invoke<any>('get_display_status'),
    openLogsDirectory: () => nativeApi.invoke<void>('open_logs_directory'),
  },

  /**
   * Mining specific commands
   */
  miner: {
    startMining: (config: any) => nativeApi.invoke<void>('start_mining', { request: config }),
    stopMining: () => nativeApi.invoke<void>('stop_mining'),
    pauseMining: () => nativeApi.invoke<void>('pause_mining'),
    resumeMining: () => nativeApi.invoke<void>('resume_mining'),
    startBenchmark: (config: any) => nativeApi.invoke<void>('start_benchmark', { request: config }),
    stopBenchmark: () => nativeApi.invoke<void>('stop_benchmark'),
    getLatestBenchmark: (deviceType: string) => nativeApi.invoke<any>('get_latest_benchmark', { device_type: deviceType }),
    submitBenchmark: (record: any) => nativeApi.invoke<any>('submit_benchmark_result', { record }),
    saveSettings: (settings: any) => nativeApi.invoke<void>('save_miner_settings', { settings }),
    loadSettings: () => nativeApi.invoke<{ success: boolean; settings: any }>('load_miner_settings'),
    saveLogs: (logs: any) => nativeApi.invoke<void>('save_miner_logs', logs),
  },

  /**
   * Pool and RPC commands
   */
  pool: {
    getSyncStatus: (host: string, port: number) => nativeApi.invoke<any>('get_pool_sync', { host, port }),
    rpcCall: (method: string, params: any, host: string, port: number) =>
      nativeApi.invoke<any>('p2pool_rpc_call', { method, params, host, port }),
    getRuntimeConfig: () => nativeApi.invoke<any>('get_runtime_pool_config'),
  }
};
