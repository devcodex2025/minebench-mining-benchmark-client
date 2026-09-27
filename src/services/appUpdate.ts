import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

declare const __APP_VERSION__: string;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const RELEASES_URL = 'https://bitbucket.org/minebenchapp/minebench-client/downloads/';

const TAGS_URL =
  'https://api.bitbucket.org/2.0/repositories/minebenchapp/minebench-client/refs/tags?sort=-target.date&pagelen=1';

let availableUpdate: Update | null = null;
let updateCheckPromise: Promise<AppUpdateStatus> | null = null;

const isNative = () => Boolean((window as any).__TAURI_INTERNALS__);

export const normalizeVersionLabel = (version: string): string =>
  version.trim().replace(/^v/i, '');

const normalizeVersion = (version: string): number[] =>
  normalizeVersionLabel(version)
    .split('.')
    .map(part => Number.parseInt(part, 10))
    .map(part => (Number.isFinite(part) ? part : 0));

export const isNewerVersion = (latest: string, current: string): boolean => {
  const latestParts = normalizeVersion(latest);
  const currentParts = normalizeVersion(current);
  const length = Math.max(latestParts.length, currentParts.length);

  for (let i = 0; i < length; i += 1) {
    const latestPart = latestParts[i] ?? 0;
    const currentPart = currentParts[i] ?? 0;
    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
};

export type AppUpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  canInstall: boolean;
  checked: boolean;
  error?: string;
};

const checkBitbucketVersion = async (): Promise<AppUpdateStatus> => {
  const response = await fetch(TAGS_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) throw new Error(`Bitbucket release check failed: ${response.status}`);

  const tags = await response.json();
  const latestVersion = normalizeVersionLabel(String(tags.values?.[0]?.name || APP_VERSION));
  return {
    currentVersion: APP_VERSION,
    latestVersion,
    updateAvailable: isNewerVersion(latestVersion, APP_VERSION),
    canInstall: false,
    checked: true,
  };
};

const checkAppUpdate = async (): Promise<AppUpdateStatus> => {
  if (isNative()) {
    try {
      availableUpdate = await check({ timeout: 15_000 });
      return {
        currentVersion: APP_VERSION,
        latestVersion: normalizeVersionLabel(availableUpdate?.version || APP_VERSION),
        updateAvailable: Boolean(availableUpdate),
        canInstall: Boolean(availableUpdate),
        checked: true,
      };
    } catch (updaterError) {
      try {
        const fallback = await checkBitbucketVersion();
        return {
          ...fallback,
          error: updaterError instanceof Error
            ? `Automatic updater unavailable: ${updaterError.message}`
            : 'Automatic updater unavailable',
        };
      } catch {
        throw updaterError;
      }
    }
  }

  return checkBitbucketVersion();
};

export const getAppUpdateStatus = async (): Promise<AppUpdateStatus> => {
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = checkAppUpdate().catch((err) => ({
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    updateAvailable: false,
    canInstall: false,
    checked: true,
    error: err instanceof Error ? err.message : 'Failed to check for updates',
  }));

  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
};

export const installAppUpdate = async (
  onProgress?: (event: DownloadEvent) => void
): Promise<void> => {
  if (!isNative()) throw new Error('Automatic updates are only available in the desktop app');

  const update = availableUpdate ?? await check({ timeout: 15_000 });
  if (!update) throw new Error('No update is available');

  availableUpdate = update;
  await update.downloadAndInstall(onProgress, { timeout: 300_000, restartAfterInstall: false });
  await relaunch();
};

export const getInitialAppUpdateStatus = (): AppUpdateStatus => ({
  currentVersion: APP_VERSION,
  latestVersion: APP_VERSION,
  updateAvailable: false,
  canInstall: false,
  checked: false,
});
