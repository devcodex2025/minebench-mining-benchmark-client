declare module "recharts";

// Add Three.js JSX types
import { ThreeElements } from '@react-three/fiber'

/**
 * Native API for Tauri v2
 */
export interface NativeApi {
  invoke<T>(command: string, args?: Record<string, any>): Promise<T>;
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>;
  openExternal(url: string): Promise<void>;
  system: {
    getCpuInfo(): Promise<{ name: string; cores: number }>;
    getSystemStats(): Promise<any>;
    getGpuSensors(): Promise<any>;
    getAutoStart(): Promise<boolean>;
    setAutoStart(enabled: boolean): Promise<void>;
    getProcessStats(): Promise<any>;
    getDisplayStatus(): Promise<any>;
    openLogsDirectory(): Promise<void>;
  };
  miner: {
    startMining(config: any): Promise<void>;
    stopMining(): Promise<void>;
    startBenchmark(config: any): Promise<void>;
    stopBenchmark(): Promise<void>;
    getLatestBenchmark(deviceType: string): Promise<any>;
    submitBenchmark(record: any): Promise<any>;
    saveSettings(settings: any): Promise<void>;
    loadSettings(): Promise<{ success: boolean; settings: any }>;
  };
  pool: {
    getSyncStatus(host: string, port: number): Promise<any>;
    rpcCall(method: string, params: any, host: string, port: number): Promise<any>;
    getRuntimeConfig(): Promise<any>;
    pingEndpoint(host: string, port: number): Promise<any>;
  };
}

declare global {
  namespace JSX {
    interface IntrinsicElements extends ThreeElements {}
  }
}

