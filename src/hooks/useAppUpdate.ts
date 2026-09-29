import { useSyncExternalStore } from 'react';
import { appUpdateStore } from '../services/appUpdateState';
import type { AppUpdateStatus } from '../services/appUpdate';
import type { AppUpdateViewState } from '../services/appUpdateStore';

const checkForUpdate = appUpdateStore.check;
const startUpdate = appUpdateStore.install;

export type AppUpdate = AppUpdateViewState & {
  checkForUpdate: () => Promise<AppUpdateStatus>;
  startUpdate: () => Promise<void>;
};

/** Shared app-update state and actions for every update button in the client. */
export const useAppUpdate = (): AppUpdate => {
  const state = useSyncExternalStore(
    appUpdateStore.subscribe,
    appUpdateStore.getState,
    appUpdateStore.getState
  );

  return { ...state, checkForUpdate, startUpdate };
};
