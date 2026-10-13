import type { DownloadEvent } from '@tauri-apps/plugin-updater';
import type { AppUpdateStatus } from './appUpdate';

/**
 * One shared update state that every update button in the client renders from.
 *
 * Before this, the title bar and Settings each kept their own copy of the update
 * status and busy flag, so they could disagree, start two installs at once, or
 * stay stuck on "Updating…" when a native call never came back.
 */
export type AppUpdateViewState = {
  status: AppUpdateStatus;
  checked: boolean;
  checking: boolean;
  installing: boolean;
  progress: number | null;
  error: string | null;
};

export type AppUpdateDeps = {
  getInitialStatus: () => AppUpdateStatus;
  checkStatus: () => Promise<AppUpdateStatus>;
  install: (onProgress?: (event: DownloadEvent) => void) => Promise<void>;
  /**
   * Installs a specific version from the channel pool. Optional because a build
   * without updates (the web build) has no way to install anything; without it a
   * rollback reports that it is unavailable instead of failing silently.
   */
  rollback?: (version: string) => Promise<void>;
  openReleasesPage: () => void;
};

export type AppUpdateStore = {
  subscribe: (listener: () => void) => () => void;
  getState: () => AppUpdateViewState;
  check: () => Promise<AppUpdateStatus>;
  install: () => Promise<void>;
  /** Installs a specific version from this channel's pool. */
  rollback: (version: string) => Promise<void>;
};

export const createAppUpdateStore = (deps: AppUpdateDeps): AppUpdateStore => {
  let state: AppUpdateViewState = {
    status: deps.getInitialStatus(),
    checked: false,
    checking: false,
    installing: false,
    progress: null,
    error: null,
  };

  const listeners = new Set<() => void>();
  let checkPromise: Promise<AppUpdateStatus> | null = null;
  let installPromise: Promise<void> | null = null;
  let rollbackPromise: Promise<void> | null = null;

  const patch = (next: Partial<AppUpdateViewState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** One shared check: the title bar and Settings awaiting at once share a single request. */
  const check = (): Promise<AppUpdateStatus> => {
    if (checkPromise) return checkPromise;

    patch({ checking: true, error: null });

    checkPromise = deps
      .checkStatus()
      .then((status) => {
        patch({ status, checked: true, checking: false, error: status.error ?? null });
        return status;
      })
      .catch((err: unknown) => {
        patch({
          checking: false,
          checked: true,
          error: err instanceof Error ? err.message : 'Failed to check for updates',
        });
        return state.status;
      })
      .finally(() => {
        checkPromise = null;
      });

    return checkPromise;
  };

  /**
   * One shared install. Progress and the busy flag are broadcast to every
   * consumer, and the promise always settles, so no button can hang.
   */
  const install = (): Promise<void> => {
    if (installPromise) return installPromise;
    if (rollbackPromise) return rollbackPromise;

    if (!state.status.canInstall) {
      deps.openReleasesPage();
      return Promise.resolve();
    }

    patch({ installing: true, progress: 0, error: null });

    let downloaded = 0;
    let total = 0;

    installPromise = deps
      .install((event) => {
        if (event.event === 'Started') total = event.data.contentLength || 0;
        if (event.event === 'Progress') downloaded += event.data.chunkLength;
        if (event.event === 'Finished') patch({ progress: 100 });
        else if (total > 0) patch({ progress: Math.min(99, Math.round((downloaded / total) * 100)) });
      })
      .then(() => {
        patch({
          installing: false,
          progress: 100,
          error: null,
          status: { ...state.status, updateAvailable: false, canInstall: false },
        });
      })
      .catch((err: unknown) => {
        patch({
          installing: false,
          progress: null,
          error: err instanceof Error ? err.message : 'Failed to install update',
        });
      })
      .finally(() => {
        installPromise = null;
      });

    return installPromise;
  };

  /**
   * One shared rollback, for the same reason as the shared install: two buttons
   * must not replace the running build at once. A rollback and an install are
   * mutually exclusive — whichever is already running is returned instead.
   */
  const rollback = (version: string): Promise<void> => {
    if (rollbackPromise) return rollbackPromise;
    if (installPromise) return installPromise;

    patch({ installing: true, progress: null, error: null });

    rollbackPromise = (
      deps.rollback
        ? deps.rollback(version)
        : Promise.reject(new Error('This build cannot install a specific version'))
    )
      .then(() => {
        patch({ installing: false, progress: null, error: null });
      })
      .catch((err: unknown) => {
        patch({
          installing: false,
          progress: null,
          error: err instanceof Error ? err.message : `Failed to install ${version}`,
        });
      })
      .finally(() => {
        rollbackPromise = null;
      });

    return rollbackPromise;
  };

  return { subscribe, getState: () => state, check, install, rollback };
};
