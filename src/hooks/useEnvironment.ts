/**
 * Hook to use environment configuration
 * Дозволяє легко використовувати конфігурацію в React компонентах
 */

import { getEnvironmentConfig, type EnvironmentConfig, isDevelopment, isProduction } from '../config/environment';

/**
 * Hook to get environment configuration
 * @returns Current environment configuration
 */
export function useEnvironment(): EnvironmentConfig {
  return getEnvironmentConfig();
}

/**
 * Hook to check if in development mode
 */
export function useIsDevelopment(): boolean {
  return isDevelopment();
}

/**
 * Hook to check if in production mode
 */
export function useIsProduction(): boolean {
  return isProduction();
}

/**
 * Hook to get wallet authorization URL
 */
export function useWalletAuthUrl(): string {
  return getEnvironmentConfig().walletAuthUrl;
}

/**
 * Hook to get API base URL
 */
export function useApiBaseUrl(): string {
  return getEnvironmentConfig().apiBaseUrl;
}

/**
 * Hook to get backend URL
 */
export function useBackendUrl(): string {
  return getEnvironmentConfig().backendUrl;
}

/**
 * Hook to get wallet service URL
 */
export function useWalletServiceUrl(): string {
  return getEnvironmentConfig().walletServiceUrl;
}

/**
 * Hook to get sync service URL
 */
export function useSyncServiceUrl(): string {
  return getEnvironmentConfig().syncServiceUrl;
}

/**
 * Hook to get Solana RPC URL
 */
export function useSolanaRpcUrl(): string {
  return getEnvironmentConfig().solanaRpcUrl;
}

/**
 * Hook to get pool API URL
 */
export function usePoolApiUrl(): string {
  return getEnvironmentConfig().poolApiUrl;
}
