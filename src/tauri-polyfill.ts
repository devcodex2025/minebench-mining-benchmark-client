import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';

// Define the polyfill
const tauriPolyfill = {
  invoke: async (channel: string, ...args: any[]) => {
    // Map Electron channel names to Tauri command names (using snake_case)
    const commandMap: Record<string, string> = {
      'get-cpu-name': 'get_cpu_name',
      'get-cpu-cores': 'get_cpu_cores',
      'get-system-stats': 'get_system_stats',
      'get-cpu-info': 'get_cpu_info',
      'get-cpu-temp': 'get_cpu_temp',
      'get-cpu-power': 'get_cpu_power',
      'get-gpu-sensors': 'get_gpu_sensors',
      'get-auto-start': 'get_auto_start',
      'set-auto-start': 'set_auto_start',
      'save-miner-settings': 'save_miner_settings',
      'load-miner-settings': 'load_miner_settings',
      'save-miner-logs': 'save_miner_logs',
      'log-to-file': 'log_to_file',
      'solana-connect-wallet': 'solana_connect_wallet',
      'solana-disconnect-wallet': 'solana_disconnect_wallet',
      'solana-get-token-balance': 'solana_get_token_balance',
      'get-premium-status': 'get_premium_status',
      'get-runtime-pool-config': 'get_runtime_pool_config',
      'get-latest-benchmark': 'get_latest_benchmark',
      'submit-benchmark-result': 'submit_benchmark_result',
      'p2pool-rpc-call': 'p2pool_rpc_call',
      'get-pool-sync': 'get_pool_sync',
      'get-miner-path': 'get_miner_path',
      'window-minimize': 'window_minimize', // We'll implement these if not using plugin-window
      'window-maximize': 'window_maximize',
      'window-close': 'window_close',
      'open-folder': 'open_folder',
      'get-logs-directory': 'get_logs_directory',
      'report-stats': 'report_stats',
      'start-benchmark': 'start_benchmark',
      'stop-benchmark': 'stop_benchmark',
      'start-mining': 'start_mining',
      'stop-mining': 'stop_mining',
      'pause-mining': 'pause_mining',
      'resume-mining': 'resume_mining'
    };

    const tauriCommand = commandMap[channel] || channel.replace(/-/g, '_');
    
    // Tauri invoke expects a single object where keys match Rust parameter names.
    // Electron invoke often passes multiple positional arguments.
    let payload: any = {};

    if (tauriCommand === 'submit_benchmark_result') {
      payload = { record: args[0] };
    } else if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      // Common pattern: invoke('cmd', { key: val })
      payload = args[0];
    } else if (args.length > 0) {
      // Positional arguments mapping for known commands
      if (tauriCommand === 'get_pool_sync') {
        payload = { host: args[0], port: args[1] };
      } else if (tauriCommand === 'p2pool_rpc_call') {
        payload = { method: args[0], params: args[1], host: args[2], port: args[3] };
      } else if (tauriCommand === 'get_miner_path') {
        payload = { miner_name: args[0] };
      } else if (tauriCommand === 'log_to_file') {
        payload = { level: args[0], message: args[1], source: args[2] };
      } else if (tauriCommand === 'open_folder') {
        payload = { path: args[0] };
      } else if (tauriCommand === 'save_miner_settings') {
        payload = { settings: args[0] };
      } else if (tauriCommand === 'set_auto_start') {
        payload = { enabled: !!args[0] };
      } else if (tauriCommand === 'get_latest_benchmark') {
        payload = { device_type: args[0] };
      } else if (tauriCommand === 'submit_benchmark_result') {
        payload = { record: args[0] };
      } else if (tauriCommand === 'get_premium_status') {
        payload = { public_key: args[0] };
      } else {
        // Fallback: just use the first arg as payload if it's an object, or empty
        payload = (args[0] && typeof args[0] === 'object') ? args[0] : {};
      }
    }

    if (
      (tauriCommand === 'start_mining' || tauriCommand === 'start_benchmark') &&
      payload &&
      typeof payload === 'object' &&
      !('request' in payload)
    ) {
      payload = { request: payload };
    }
    
    try {
      return await invoke(tauriCommand, payload);
    } catch (err) {
      console.error(`Tauri invoke error [${channel} -> ${tauriCommand}]:`, err);
      throw err;
    }
  },

  on: (channel: string, func: (...args: any[]) => void) => {
    let unlisten: (() => void) | null = null;
    
    listen(channel, (event) => {
      func(event.payload);
    }).then(u => unlisten = u);

    return () => {
      if (unlisten) unlisten();
    };
  },

  onMinerLog: (callback: any) => {
    let unlisten: any;
    listen('miner-log', (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten && unlisten();
  },

  onMinerError: (callback: any) => {
    let unlisten: any;
    listen('miner-error', (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten && unlisten();
  },

  onMinerExit: (callback: any) => {
    let unlisten: any;
    listen('miner-exit', (event) => callback(event.payload)).then(u => unlisten = u);
    return () => unlisten && unlisten();
  },

  openExternal: (url: string) => open(url),

  ipcRenderer: {
    invoke: async (channel: string, ...args: any[]) => {
       // Reuse the main invoke logic
       return (window as any).electron.invoke(channel, ...args);
    }
  }
};

// Expose to window
(window as any).electron = tauriPolyfill;

console.log('[Tauri-Polyfill] Initialized window.electron');
