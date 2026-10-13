import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { APP_CHANNEL, DOWNLOADS_BASE, versionsUrl } from '../lib/channel.ts';
import type { Channel } from '../lib/channel.ts';

declare const __APP_VERSION__: string;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const RELEASES_URL = DOWNLOADS_BASE;

/** Bounded waits so a stalled network or native process can never freeze the UI. */
export const CHECK_TIMEOUT_MS = 15_000;
export const INSTALL_TIMEOUT_MS = 300_000;
export const RELAUNCH_TIMEOUT_MS = 20_000;

let availableUpdate: Update | null = null;
let updateCheckPromise: Promise<AppUpdateStatus> | null = null;
let installPromise: Promise<void> | null = null;

export const isNativeApp = (): boolean =>
  typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);

/** Rejects after `timeoutMs`, so a hung native call releases the update UI instead of blocking it forever. */
export const withTimeout = <T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([operation, guard]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
};

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
  /** Delivery channel this build belongs to. */
  channel?: Channel;
  /** The running version was withdrawn by the maintainers. */
  revoked?: boolean;
  /** Versions this channel still offers that are older than the running one. */
  rollbackTargets?: string[];
  /** The channel's kill switch, when one is armed. */
  killSwitch?: KillSwitch | null;
  /** The running version is below the armed kill switch. */
  gated?: boolean;
};

/** A version the channel still offers. */
export type ChannelPoolVersion = {
  version: string;
  notes?: string | null;
  publishedAt?: string | null;
  manifest?: string | null;
};

/**
 * Stops versions below `minVersion` from running. `block` decides whether the
 * interface refuses to continue or only warns; either way nothing below the gate
 * can be installed.
 */
export type KillSwitch = {
  minVersion: string;
  message: string | null;
  block: boolean;
};

/** `{channel}-versions.json`: what may be installed, and what may not. */
export type ChannelPool = {
  latest: string | null;
  versions: ChannelPoolVersion[];
  revoked: { version: string; reason?: string | null }[];
  killSwitch: KillSwitch | null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Where this installation updates from.
 *
 * The installer registers it, so a moved repository reaches installed clients by
 * reinstalling or upgrading rather than by rebuilding every client; the source
 * compiled into the build is only the fallback.
 */
const resolvePoolUrl = async (): Promise<string> => {
  if (!isNativeApp()) return versionsUrl();

  try {
    const source = await invoke<{ channel: string; downloadsBase: string }>(
      'channel_update_source'
    );
    return `${source.downloadsBase}${source.channel}-versions.json`;
  } catch (err) {
    console.warn('[appUpdate] using the compiled update source:', err);
    return versionsUrl();
  }
};

/**
 * The version pool the release tooling publishes for this channel. It decides
 * what may be installed, so it is read before any rollback and shown in the UI.
 */
export const fetchChannelPool = async (): Promise<ChannelPool> => {
  const response = await fetch(await resolvePoolUrl(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`${APP_CHANNEL} channel list failed: ${response.status}`);

  const raw = asRecord(await response.json());

  return {
    latest: text(raw.latest),
    versions: (Array.isArray(raw.versions) ? raw.versions : [])
      .map(asRecord)
      .filter((entry) => text(entry.version) !== null)
      .map((entry) => ({
        version: text(entry.version) as string,
        notes: text(entry.notes),
        publishedAt: text(entry.publishedAt),
        manifest: text(entry.manifest),
      })),
    revoked: (Array.isArray(raw.revoked) ? raw.revoked : [])
      .map(asRecord)
      .filter((entry) => text(entry.version) !== null)
      .map((entry) => ({
        version: text(entry.version) as string,
        reason: text(entry.reason),
      })),
    killSwitch: killSwitchFrom(raw.killSwitch),
  };
};

const killSwitchFrom = (value: unknown): KillSwitch | null => {
  const entry = asRecord(value);
  const minVersion = text(entry.minVersion);
  if (minVersion === null) return null;

  return {
    minVersion,
    message: text(entry.message),
    block: entry.block === true,
  };
};

/**
 * Versions a client may roll back to: still offered, older than the running one,
 * newest first. Revoked versions are never offered, and anything newer is a
 * normal update rather than a rollback.
 */
export const rollbackTargetsFrom = (pool: ChannelPool, currentVersion: string): string[] => {
  const current = normalizeVersionLabel(currentVersion);
  const revoked = new Set(pool.revoked.map((entry) => normalizeVersionLabel(entry.version)));
  const minimum = pool.killSwitch?.minVersion ?? null;

  return pool.versions
    .map((entry) => normalizeVersionLabel(entry.version))
    .filter((version) => version !== current && !revoked.has(version))
    .filter((version) => !isNewerVersion(version, current))
    // A kill switch holds back everything below the version it names, so those
    // are not offered as rollback targets either.
    .filter((version) => !minimum || !isNewerVersion(minimum, version))
    .sort((left, right) => (isNewerVersion(left, right) ? -1 : 1));
};

const applyChannelContext = (status: AppUpdateStatus, pool: ChannelPool): AppUpdateStatus => {
  const current = normalizeVersionLabel(status.currentVersion);
  const killSwitch = pool.killSwitch;

  return {
    ...status,
    channel: APP_CHANNEL,
    revoked: pool.revoked.some((entry) => normalizeVersionLabel(entry.version) === current),
    rollbackTargets: rollbackTargetsFrom(pool, current),
    killSwitch,
    // Below the gate: the version named by the kill switch is still allowed.
    gated: killSwitch !== null && isNewerVersion(killSwitch.minVersion, current),
  };
};

/**
 * Adds what the pool knows about the running version. The pool is advisory: a
 * failed read must never hide an update the updater did find.
 */
const withChannelContext = async (status: AppUpdateStatus): Promise<AppUpdateStatus> => {
  try {
    return applyChannelContext(status, await fetchChannelPool());
  } catch {
    return { ...status, channel: APP_CHANNEL };
  }
};

/**
 * Latest version this channel offers, from the pool the release tooling writes.
 *
 * Reading the channel pool instead of the newest repository tag keeps a nightly
 * or canary client from being offered a version it cannot install, and a stable
 * client from being told about an unreleased candidate. Installing stays with the
 * Tauri updater, which verifies the manifest signature.
 */
const checkChannelVersion = async (): Promise<AppUpdateStatus> => {
  const pool = await fetchChannelPool();
  return applyChannelContext(
    {
      currentVersion: APP_VERSION,
      latestVersion: normalizeVersionLabel(String(pool.latest || APP_VERSION)),
      updateAvailable: isNewerVersion(String(pool.latest || APP_VERSION), APP_VERSION),
      canInstall: false,
      checked: true,
    },
    pool
  );
};

const checkAppUpdate = async (): Promise<AppUpdateStatus> => {
  if (isNativeApp()) {
    try {
      availableUpdate = await check({ timeout: CHECK_TIMEOUT_MS });
      return await withChannelContext({
        currentVersion: APP_VERSION,
        latestVersion: normalizeVersionLabel(availableUpdate?.version || APP_VERSION),
        updateAvailable: Boolean(availableUpdate),
        canInstall: Boolean(availableUpdate),
        checked: true,
      });
    } catch (updaterError) {
      try {
        const fallback = await checkChannelVersion();
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

  return checkChannelVersion();
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

export const installAppUpdate = (
  onProgress?: (event: DownloadEvent) => void
): Promise<void> => {
  if (!isNativeApp()) {
    return Promise.reject(new Error('Automatic updates are only available in the desktop app'));
  }

  // Single-flight: the title bar and Settings share one install, so a second
  // click can never start a parallel download or leave a button stuck.
  if (installPromise) return installPromise;

  installPromise = (async () => {
    const update = availableUpdate ?? await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) throw new Error('No update is available');

    availableUpdate = update;
    await update.downloadAndInstall(onProgress, {
      timeout: INSTALL_TIMEOUT_MS,
      restartAfterInstall: false,
    });
    await withTimeout(
      relaunch(),
      RELAUNCH_TIMEOUT_MS,
      'Update installed, but MineBench Client did not restart automatically. Please restart it manually.'
    );
  })().finally(() => {
    installPromise = null;
  });

  return installPromise;
};

/**
 * Installs one specific version of this channel — the rollback path.
 *
 * The native side re-reads the channel pool and refuses a version that is
 * revoked or no longer offered, so what a client may install is not decided by
 * this interface. Only rollbacks come this way: a forward update keeps using the
 * updater's ordinary check.
 */
export const installChannelVersion = (version: string): Promise<void> => {
  if (!isNativeApp()) {
    return Promise.reject(new Error('Automatic updates are only available in the desktop app'));
  }
  return invoke<void>('install_channel_version', { version });
};

export const getInitialAppUpdateStatus = (): AppUpdateStatus => ({
  currentVersion: APP_VERSION,
  latestVersion: APP_VERSION,
  updateAvailable: false,
  canInstall: false,
  checked: false,
});
