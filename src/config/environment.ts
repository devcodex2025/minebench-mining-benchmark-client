/**
 * Environment Configuration
 * Управління конфігурацією для розробки та продакшну
 */

import fallbackConfig from '../../config/fallback.json';

export type Environment = 'development' | 'production';

export interface EnvironmentConfig {
  // App environment
  env: Environment;
  isDev: boolean;
  isProd: boolean;
  enableBackupPool: boolean;

  // Wallet Authorization
  walletAuthUrl: string;

  // API Endpoints
  apiBaseUrl: string;

  // Backend Services
  backendUrl: string;

  // Wallet Service
  walletServiceUrl: string;

  // Multi-device sync
  syncServiceUrl: string;

  // Solana RPC
  solanaRpcUrl: string;

  // Solana SPL Token (BMT)
  // Mint address of the $BMT SPL token on Solana mainnet
  bmtTokenMint: string;

  // Pool API
  poolApiUrl: string;

  // Pool Stratum
  poolStratumHost: string;
  poolStratumPort: number;
  poolStratumUrl: string;
  poolStratumHostBackup: string;
  poolStratumPortBackup: number;
  poolStratumUrlBackup: string;

  // Pool RPC (P2Pool JSON-RPC)
  poolRpcHost: string;
  poolRpcPort: number;
  poolRpcUrl: string;
  poolRpcHostBackup: string;
  poolRpcPortBackup: number;
  poolRpcUrlBackup: string;

  // Pool Infra Ports (for diagnostics/config display)
  moneroP2pPort: number;
  moneroP2pPortBackup: number;
  moneroRpcPort: number;
  moneroRpcPortBackup: number;
  moneroZmqPort: number;
  p2poolP2pPort: number;
  p2poolP2pPortBackup: number;

  // Akash port mapping (external -> internal)
  stratumPortInternal: number;
  moneroP2pPortInternal: number;
  moneroRpcPortInternal: number;
  p2poolP2pPortInternal: number;
}

const toBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  return defaultValue;
};

const normalizeApiBaseUrl = (value: string | undefined, fallback: string): string => {
  const base = (value || fallback).trim().replace(/\/+$/, '');
  return base.endsWith('/api/stats') ? base.slice(0, -'/stats'.length) : base;
};

const fallbackDefaults = (fallbackConfig as any)?.defaults || {};
const primaryPoolHostFallback = fallbackDefaults.primaryPoolHost || fallbackDefaults.primaryHost || 'xmr-us.minebench.cloud';
const backupPoolHostFallback = fallbackDefaults.backupPoolHost || fallbackDefaults.backupHost || 'xmr-eu.minebench.cloud';
const primaryRpcHostFallback = fallbackDefaults.primaryRpcHost || fallbackDefaults.primaryHost || primaryPoolHostFallback;
const backupRpcHostFallback = fallbackDefaults.backupRpcHost || fallbackDefaults.backupHost || backupPoolHostFallback;

// Development Configuration
const developmentConfig: EnvironmentConfig = {
  env: 'development',
  isDev: true,
  isProd: false,
  enableBackupPool: toBool(import.meta.env.VITE_ENABLE_BACKUP_POOL as string | undefined, !!fallbackDefaults.enableBackupPool),

  // Production cloud endpoints (use production for wallet services)
  walletAuthUrl: 'https://minebench.cloud/auth',
  apiBaseUrl: 'https://backend.minebench.cloud/api',
  backendUrl: 'https://backend.minebench.cloud',
  walletServiceUrl: 'https://minebench.cloud/wallet',
  syncServiceUrl: 'ws://localhost:3000/sync',
  solanaRpcUrl: 'https://api.devnet.solana.com',
  bmtTokenMint: (import.meta.env.VITE_BMT_TOKEN_MINT as string) || '67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev',
  poolApiUrl: 'http://localhost:8080/api/pool/stats',
  poolStratumHost: (import.meta.env.VITE_PRIMARY_POOL_HOST as string) || primaryPoolHostFallback,
  poolStratumPort: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT) || fallbackDefaults.stratumPort || 3333,
  poolStratumUrl: `${(import.meta.env.VITE_PRIMARY_POOL_HOST as string) || primaryPoolHostFallback}:${import.meta.env.VITE_PRIMARY_STRATUM_PORT || fallbackDefaults.stratumPort || 3333}`,
  poolStratumHostBackup: (import.meta.env.VITE_BACKUP_POOL_HOST as string) || backupPoolHostFallback,
  poolStratumPortBackup: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT_BACKUP || import.meta.env.VITE_PRIMARY_STRATUM_PORT) || fallbackDefaults.stratumPort || 3333,
  poolStratumUrlBackup: `${(import.meta.env.VITE_BACKUP_POOL_HOST as string) || backupPoolHostFallback}:${import.meta.env.VITE_BACKUP_STRATUM_PORT || import.meta.env.VITE_PRIMARY_STRATUM_PORT_BACKUP || import.meta.env.VITE_PRIMARY_STRATUM_PORT || fallbackDefaults.stratumPort || 3333}`,
  poolRpcHost: (import.meta.env.VITE_PRIMARY_RPC_HOST as string) || primaryRpcHostFallback,
  poolRpcPort: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  poolRpcUrl: `http://${(import.meta.env.VITE_PRIMARY_RPC_HOST as string) || primaryRpcHostFallback}:${import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT || fallbackDefaults.moneroRpcPort || 18081}/json_rpc`,
  poolRpcHostBackup: (import.meta.env.VITE_BACKUP_RPC_HOST as string) || backupRpcHostFallback,
  poolRpcPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  poolRpcUrlBackup: `http://${(import.meta.env.VITE_BACKUP_RPC_HOST as string) || backupRpcHostFallback}:${import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT || fallbackDefaults.moneroRpcPort || 18081}/json_rpc`,
  moneroP2pPort: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT) || fallbackDefaults.moneroP2pPort || 18080,
  moneroP2pPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT) || fallbackDefaults.moneroP2pPort || 18080,
  moneroRpcPort: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  moneroRpcPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  moneroZmqPort: 18083,
  p2poolP2pPort: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT) || fallbackDefaults.p2poolP2pPort || 37889,
  p2poolP2pPortBackup: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT_BACKUP || import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT) || fallbackDefaults.p2poolP2pPort || 37889,
  stratumPortInternal: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_STRATUM_PORT),
  moneroP2pPortInternal: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT),
  moneroRpcPortInternal: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT),
  p2poolP2pPortInternal: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT),
};

// Production Configuration
const productionConfig: EnvironmentConfig = {
  env: 'production',
  isDev: false,
  isProd: true,
  enableBackupPool: toBool(import.meta.env.VITE_ENABLE_BACKUP_POOL as string | undefined, !!fallbackDefaults.enableBackupPool),

  // Production cloud endpoints
  // Production cloud endpoints
  walletAuthUrl: 'https://minebench.cloud/auth',
  // All direct backend API calls should go to backend.minebench.cloud
  apiBaseUrl: normalizeApiBaseUrl((import.meta as any).env.VITE_API_BASE_URL, 'https://backend.minebench.cloud/api'),
  backendUrl: (import.meta as any).env.VITE_BACKEND_URL || 'https://backend.minebench.cloud',
  walletServiceUrl: 'https://minebench.cloud/wallet',
  syncServiceUrl: 'wss://minebench.cloud/sync',
  solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
  bmtTokenMint: (import.meta.env.VITE_BMT_TOKEN_MINT as string) || '67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev',
  poolApiUrl: 'https://backend.minebench.cloud/api/pool/stats',
  poolStratumHost: (import.meta.env.VITE_PRIMARY_POOL_HOST as string) || primaryPoolHostFallback,
  poolStratumPort: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT) || fallbackDefaults.stratumPort || 3333,
  poolStratumUrl: `${(import.meta.env.VITE_PRIMARY_POOL_HOST as string) || primaryPoolHostFallback}:${import.meta.env.VITE_PRIMARY_STRATUM_PORT || fallbackDefaults.stratumPort || 3333}`,
  poolStratumHostBackup: (import.meta.env.VITE_BACKUP_POOL_HOST as string) || backupPoolHostFallback,
  poolStratumPortBackup: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT_BACKUP || import.meta.env.VITE_PRIMARY_STRATUM_PORT) || fallbackDefaults.stratumPort || 3333,
  poolStratumUrlBackup: `${(import.meta.env.VITE_BACKUP_POOL_HOST as string) || backupPoolHostFallback}:${import.meta.env.VITE_BACKUP_STRATUM_PORT || import.meta.env.VITE_PRIMARY_STRATUM_PORT_BACKUP || import.meta.env.VITE_PRIMARY_STRATUM_PORT || fallbackDefaults.stratumPort || 3333}`,
  poolRpcHost: (import.meta.env.VITE_PRIMARY_RPC_HOST as string) || primaryRpcHostFallback,
  poolRpcPort: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  poolRpcUrl: `http://${(import.meta.env.VITE_PRIMARY_RPC_HOST as string) || primaryRpcHostFallback}:${import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT || fallbackDefaults.moneroRpcPort || 18081}/json_rpc`,
  poolRpcHostBackup: (import.meta.env.VITE_BACKUP_RPC_HOST as string) || backupRpcHostFallback,
  poolRpcPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  poolRpcUrlBackup: `http://${(import.meta.env.VITE_BACKUP_RPC_HOST as string) || backupRpcHostFallback}:${import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT || fallbackDefaults.moneroRpcPort || 18081}/json_rpc`,
  moneroP2pPort: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT) || fallbackDefaults.moneroP2pPort || 18080,
  moneroP2pPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT) || fallbackDefaults.moneroP2pPort || 18080,
  moneroRpcPort: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  moneroRpcPortBackup: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_BACKUP || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT) || fallbackDefaults.moneroRpcPort || 18081,
  moneroZmqPort: 18083,
  p2poolP2pPort: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT) || fallbackDefaults.p2poolP2pPort || 37889,
  p2poolP2pPortBackup: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT_BACKUP || import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT) || fallbackDefaults.p2poolP2pPort || 37889,
  stratumPortInternal: Number(import.meta.env.VITE_PRIMARY_STRATUM_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_STRATUM_PORT),
  moneroP2pPortInternal: Number(import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_MONERO_P2P_PORT),
  moneroRpcPortInternal: Number(import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_MONERO_RPC_PORT),
  p2poolP2pPortInternal: Number(import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT_INTERNAL || import.meta.env.VITE_PRIMARY_P2POOL_P2P_PORT),
};

/**
 * Get environment configuration based on Vite's mode
 */
export function getEnvironmentConfig(): EnvironmentConfig {
  // Use Vite's import.meta.env.PROD which is true when building for production
  // Note: import.meta.env.MODE is set based on --mode flag or defaults to 'development'
  const isProduction = import.meta.env.PROD as boolean;
  const mode = (import.meta.env.MODE as string) || 'development';

  const env: Environment = isProduction || mode === 'production' ? 'production' : 'development';

  if (env === 'production') {
    return productionConfig;
  }

  return developmentConfig;
}

/**
 * Get current environment
 */
export function getEnvironment(): Environment {
  return getEnvironmentConfig().env;
}

/**
 * Check if development mode
 */
export function isDevelopment(): boolean {
  return getEnvironmentConfig().isDev;
}

/**
 * Check if production mode
 */
export function isProduction(): boolean {
  return getEnvironmentConfig().isProd;
}
