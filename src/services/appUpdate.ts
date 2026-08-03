declare const __APP_VERSION__: string;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const RELEASES_URL = 'https://bitbucket.org/minebenchapp/minebench-client/downloads/';

const TAGS_URL =
  'https://api.bitbucket.org/2.0/repositories/minebenchapp/minebench-client/refs/tags?sort=-target.date&pagelen=1';

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
  checked: boolean;
  error?: string;
};

export const getAppUpdateStatus = async (): Promise<AppUpdateStatus> => {
  try {
    const response = await fetch(TAGS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) throw new Error(`Bitbucket release check failed: ${response.status}`);

    const tags = await response.json();
    const latestVersion = normalizeVersionLabel(
      String(tags.values?.[0]?.name || APP_VERSION)
    );

    return {
      currentVersion: APP_VERSION,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, APP_VERSION),
      checked: true,
    };
  } catch (err) {
    return {
      currentVersion: APP_VERSION,
      latestVersion: APP_VERSION,
      updateAvailable: false,
      checked: true,
      error: err instanceof Error ? err.message : 'Failed to check Bitbucket release',
    };
  }
};

export const getInitialAppUpdateStatus = (): AppUpdateStatus => ({
  currentVersion: APP_VERSION,
  latestVersion: APP_VERSION,
  updateAvailable: false,
  checked: false,
});
