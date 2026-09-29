import assert from 'node:assert/strict';
import test from 'node:test';
import { createAppUpdateStore } from './appUpdateStore.ts';
import { CHECK_TIMEOUT_MS, INSTALL_TIMEOUT_MS, RELAUNCH_TIMEOUT_MS, isNativeApp, withTimeout } from './appUpdate.ts';
import type { AppUpdateStatus } from './appUpdate.ts';

const status = (patch: Partial<AppUpdateStatus> = {}): AppUpdateStatus => ({
  currentVersion: '0.8.46',
  latestVersion: '0.8.47',
  updateAvailable: true,
  canInstall: true,
  checked: true,
  ...patch,
});

const idleStatus = () => status({ updateAvailable: false, canInstall: false, checked: false });

test('one shared check serves the title bar and Settings at the same time', async () => {
  let calls = 0;
  let resolveCheck: (value: AppUpdateStatus) => void = () => {};

  const store = createAppUpdateStore({
    getInitialStatus: idleStatus,
    checkStatus: () => {
      calls += 1;
      return new Promise<AppUpdateStatus>((resolve) => {
        resolveCheck = resolve;
      });
    },
    install: async () => {},
    openReleasesPage: () => {},
  });

  const titleBar: boolean[] = [];
  const settings: boolean[] = [];
  store.subscribe(() => titleBar.push(store.getState().checking));
  store.subscribe(() => settings.push(store.getState().checking));

  const first = store.check();
  const second = store.check();

  assert.equal(calls, 1, 'concurrent checks must share a single request');
  assert.equal(store.getState().checking, true);
  assert.deepEqual(titleBar, [true], 'the title bar sees the shared spinner');
  assert.deepEqual(settings, [true], 'Settings sees the same shared spinner');

  resolveCheck(status());
  const [titleBarResult, settingsResult] = await Promise.all([first, second]);

  assert.equal(titleBarResult.latestVersion, '0.8.47');
  assert.equal(settingsResult.latestVersion, '0.8.47');
  assert.equal(store.getState().checking, false);
  assert.equal(store.getState().checked, true);
  assert.deepEqual(titleBar, [true, false]);
  assert.deepEqual(settings, [true, false]);
});

test('a second install click reuses the running install and shares progress', async () => {
  let installations = 0;
  let releaseInstall: () => void = () => {};

  const store = createAppUpdateStore({
    getInitialStatus: () => status(),
    checkStatus: async () => status(),
    install: async (onProgress) => {
      installations += 1;
      onProgress?.({ event: 'Started', data: { contentLength: 200 } });
      onProgress?.({ event: 'Progress', data: { chunkLength: 100 } });
      await new Promise<void>((resolve) => {
        releaseInstall = resolve;
      });
    },
    openReleasesPage: () => {},
  });

  const snapshots: (number | null)[] = [];
  store.subscribe(() => snapshots.push(store.getState().progress));

  const first = store.install();
  const second = store.install();

  assert.equal(installations, 1, 'the buttons must not start two parallel downloads');
  assert.equal(first, second, 'both buttons await the same install');
  assert.equal(store.getState().installing, true);
  assert.equal(store.getState().progress, 50);
  assert.equal(snapshots.at(-1), 50, 'progress is broadcast to every consumer');

  releaseInstall();
  await Promise.all([first, second]);

  assert.equal(store.getState().installing, false);
  assert.equal(store.getState().progress, 100);
  assert.equal(store.getState().status.updateAvailable, false);
});

test('a failed install clears the busy flag instead of hanging the buttons', async () => {
  let attempts = 0;

  const store = createAppUpdateStore({
    getInitialStatus: () => status(),
    checkStatus: async () => status(),
    install: async () => {
      attempts += 1;
      throw new Error('download stalled');
    },
    openReleasesPage: () => {},
  });

  await store.install();

  assert.equal(attempts, 1);
  assert.equal(store.getState().installing, false);
  assert.equal(store.getState().progress, null);
  assert.equal(store.getState().error, 'download stalled');

  await store.install();

  assert.equal(attempts, 2, 'the store must not stay locked after a failure');
});

test('a failed check clears the spinner and reports the error', async () => {
  const store = createAppUpdateStore({
    getInitialStatus: idleStatus,
    checkStatus: async () => {
      throw new Error('offline');
    },
    install: async () => {},
    openReleasesPage: () => {},
  });

  const resolved = await store.check();

  assert.equal(store.getState().checking, false);
  assert.equal(store.getState().checked, true);
  assert.equal(store.getState().error, 'offline');
  assert.equal(resolved.updateAvailable, false);
});

test('an update that cannot be installed automatically opens the downloads page', async () => {
  let opened = 0;
  const manualStatus = status({ updateAvailable: true, canInstall: false });

  const store = createAppUpdateStore({
    getInitialStatus: () => manualStatus,
    checkStatus: async () => manualStatus,
    install: async () => {
      throw new Error('automatic install must not run');
    },
    openReleasesPage: () => {
      opened += 1;
    },
  });

  await store.install();

  assert.equal(opened, 1);
  assert.equal(store.getState().installing, false);
  assert.equal(store.getState().error, null);
});

test('withTimeout releases a hung update operation instead of blocking the UI', async () => {
  const hung = new Promise<void>(() => {});
  const startedAt = Date.now();

  await assert.rejects(() => withTimeout(hung, 25, 'update timed out'), /update timed out/);

  assert.ok(Date.now() - startedAt < 2_000, 'the guard must fire quickly');
});

test('withTimeout passes through fast values and real failures unchanged', async () => {
  assert.equal(await withTimeout(Promise.resolve('done'), 1_000, 'never'), 'done');
  await assert.rejects(
    () => withTimeout(Promise.reject(new Error('boom')), 1_000, 'never'),
    /boom/
  );
});

test('update state is platform-safe and every native wait is time-bounded', () => {
  assert.equal(typeof window, 'undefined', 'this guard runs without a browser global');
  assert.equal(isNativeApp(), false, 'no Tauri host means no automatic install');

  for (const timeout of [CHECK_TIMEOUT_MS, INSTALL_TIMEOUT_MS, RELAUNCH_TIMEOUT_MS]) {
    assert.ok(Number.isFinite(timeout) && timeout > 0, 'native waits must be bounded');
  }
});
