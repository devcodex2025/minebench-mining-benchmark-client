import assert from 'node:assert/strict';

// QA reproduction for the multi-device sync service (test tooling only — no production code).
//
// MineBench-Client/src/services/multiDeviceSync.ts keeps a process-wide singleton that is *bound to the
// first wallet public key it ever sees* (line 51-56: `getInstance(walletPublicKey)` only constructs when
// `MultiDeviceSyncService.instance` is empty, and the constructor parameter is `private
// walletPublicKey`). Mining.tsx (271-302) and Benchmark.tsx (152-184) both call
// `MultiDeviceSyncService.getInstance(user.publicKey)` from a `useEffect` keyed on `user.publicKey`, so a
// wallet switch inside one app session re-enters `getInstance` with a *new* key while the old instance
// (and its `syncedDevices` map) is reused. `disconnectWallet()` (solanaAuth.ts:343-365) clears the auth
// secrets and `minebench_user` but never resets this service.
//
// The service's own contract ties every record to the instance wallet:
//   - `registerDevice` rewrites `walletPublicKey: this.walletPublicKey` (line 62-66);
//   - local state is persisted under `minebench_sync_${this.walletPublicKey}` (line 264-274);
//   - `syncWithServer` posts `walletPublicKey: this.walletPublicKey` with the *current session token*
//     from `authStorage.getToken()` (line 291-308), and the backend authenticates the request by that
//     JWT (MineBench-Backend/src/modules/sync/sync.routes.ts:10-16 → SyncService.updateDevice(user.id, …)).
// So after a wallet switch the client labels wallet B's device data with wallet A's public key, keeps A's
// devices in the map, persists B's device into A's storage bucket, and pushes A's devices to the backend
// under B's session.
//
// Usage (from MineBench-Client):
//   node --experimental-loader ./tests/qa-loader.mjs --test tests/multiDeviceSync.wallet-switch.test.ts
// The loader is needed because Client sources use extensionless relative imports and `import.meta.env`.

const WALLET_A = '48ghPqjkJYEKAL1ukr9YmB6B8V1g9kjMrFkrP36ZnVLxHRyFs9odvapQtjFkWRyjsG1N3ipHqiByjHUNrDZTsxG2DRRHWjj';
const WALLET_B = '8AqYNZxzgXsUemVoDCE1YuJd9RtWs6xr8XdJRkvRSKVTbcr18crnDG54RangKoXeBgBDcrBtmagFM8bzEe9N12R8HEaohVu';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

// The service reads bare `localStorage`/`window` globals, so the browser environment is reproduced before
// the dynamic import below runs the module.
const localStorageStub = new MemoryStorage();
const sessionStorageStub = new MemoryStorage();
(globalThis as any).localStorage = localStorageStub;
(globalThis as any).window = { localStorage: localStorageStub, sessionStorage: sessionStorageStub };

const captured: Array<{ url: string; authorization: string | null; body: any }> = [];
(globalThis as any).fetch = async (url: string, init: any) => {
  captured.push({
    url: String(url),
    authorization: init?.headers?.Authorization ?? null,
    body: init?.body ? JSON.parse(init.body) : null
  });
  return { ok: true, status: 200, json: async () => ({ success: true }) };
};

const { MultiDeviceSyncService } = await import('../src/services/multiDeviceSync.ts');
const { authStorage } = await import('../src/lib/auth-storage.ts');

const device = (deviceId: string, walletPublicKey: string, deviceName: string, hashrate: number) => ({
  deviceId,
  deviceName,
  walletPublicKey,
  currentHashrate: hashrate,
  totalHashesComputed: 0,
  totalShares: 0,
  accumulatedRewards: 0,
  uptime: 0,
  lastUpdate: Date.now(),
  mode: 'mining' as const
});

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
};

// ---- Session 1: wallet A connects and registers this machine -------------------------------
authStorage.setToken('jwt-for-wallet-A');
const serviceForA = MultiDeviceSyncService.getInstance(WALLET_A);
serviceForA.registerDevice(device('device-A', WALLET_A, 'Rig A', 1000));

// ---- Wallet switch inside the same app session (disconnect + connect wallet B) -------------
authStorage.removeToken(); // SolanaAuthService.disconnectWallet() clears the auth secrets
authStorage.setToken('jwt-for-wallet-B');
const serviceForB = MultiDeviceSyncService.getInstance(WALLET_B);
serviceForB.registerDevice(device('device-B', WALLET_B, 'Rig B', 2000));

// The refreshed sync loop sends every device it knows about with the current session token.
await serviceForB.updateDevice('device-B', { currentHashrate: 2500 });
const lastPost = captured[captured.length - 1];

// ---- Contract checks ----------------------------------------------------------------------
// Each wallet owns an isolated service instance, so switching wallets cannot reuse the previous state.
check('wallet instances are isolated', serviceForB === serviceForA, false);
check(
  'wallet B keeps its own storage bucket populated',
  localStorageStub.getItem(`minebench_sync_${WALLET_B}`) !== null,
  true
);
check(
  'wallet B session has no knowledge of wallet A devices',
  serviceForB.getDevice('device-A'),
  undefined
);
check(
  'wallet B aggregated stats cover only wallet B devices',
  serviceForB.getAggregatedStats().deviceCount,
  1
);
check(
  'wallet B aggregated hashrate covers only wallet B devices',
  serviceForB.getAggregatedStats().totalHashrate,
  2500
);
check(
  'registered device keeps the wallet of the connected session',
  serviceForB.getDevice('device-B')?.walletPublicKey,
  WALLET_B
);
check(
  'device update is posted for the connected wallet',
  lastPost?.body?.walletPublicKey,
  WALLET_B
);
check(
  'posted device payload keeps the connected wallet',
  lastPost?.body?.deviceData?.walletPublicKey,
  WALLET_B
);

// ---- Contrasts: single-wallet behaviour must keep working ---------------------------------
check('wallet A bucket still exists', localStorageStub.getItem(`minebench_sync_${WALLET_A}`) !== null, true);
check('wallet A device is preserved', serviceForA.getDevice('device-A')?.deviceName, 'Rig A');
check('wallet B device name is stored', serviceForB.getDevice('device-B')?.deviceName, 'Rig B');
check('session token used for the sync request is wallet B token', lastPost?.authorization, 'Bearer jwt-for-wallet-B');

assert.deepEqual(failures, [], `multi-device sync wallet switch:\n  ${failures.join('\n  ')}`);

console.log('multi-device sync wallet switch tests passed');
