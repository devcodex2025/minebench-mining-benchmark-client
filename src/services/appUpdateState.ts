import { nativeApi } from '../lib/native-api';
import {
  RELEASES_URL,
  getAppUpdateStatus,
  getInitialAppUpdateStatus,
  installAppUpdate,
  isNativeApp,
} from './appUpdate';
import { createAppUpdateStore } from './appUpdateStore';

/** Opens the Bitbucket downloads page, preferring the native opener when available. */
export const openReleasesPage = async (): Promise<void> => {
  if (isNativeApp()) {
    try {
      await nativeApi.openExternal(RELEASES_URL);
      return;
    } catch (err) {
      console.warn('[appUpdate] native opener failed, falling back to window.open:', err);
    }
  }

  window.open(RELEASES_URL, '_blank', 'noopener,noreferrer');
};

/**
 * Single application-wide update store shared by the title bar and Settings.
 * Both buttons therefore show the same version, progress and busy state, and a
 * second click while an install runs is ignored instead of starting a parallel one.
 */
export const appUpdateStore = createAppUpdateStore({
  getInitialStatus: getInitialAppUpdateStatus,
  checkStatus: getAppUpdateStatus,
  install: installAppUpdate,
  openReleasesPage: () => {
    void openReleasesPage();
  },
});
