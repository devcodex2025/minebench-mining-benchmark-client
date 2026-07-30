export type XmrigVersionInfo = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  platform: string;
  releaseUrl: string;
  error?: string;
};

export const getInitialXmrigVersionInfo = (): XmrigVersionInfo => ({
  currentVersion: '',
  latestVersion: '',
  updateAvailable: false,
  platform: '',
  releaseUrl: 'https://github.com/xmrig/xmrig/releases/latest',
});

export const getXmrigVersionPresentation = (info: XmrigVersionInfo) => ({
  currentLabel: info.currentVersion ? `v${info.currentVersion}` : 'Detecting...',
  statusLabel: info.error
    ? 'Latest-version check unavailable'
    : info.updateAvailable
      ? `v${info.latestVersion} available`
      : info.currentVersion
        ? 'Latest installed'
        : 'Checking bundled binary',
  showUpdateAction: info.updateAvailable,
  updateActionLabel: info.updateAvailable ? `Get v${info.latestVersion}` : '',
});
