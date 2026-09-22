import assert from 'node:assert/strict';

// QA reproduction for the reward event stream (test tooling only — no production code).
//
// MineBench-Client/src/lib/reward-event-stream.ts keeps a per-subscription reconnect loop. On [401, 403, 404]
// it sets `permanentFailure = true` and returns (lines 56-59), and `finally` then skips
// `scheduleReconnect()` (line 103), so that subscription never attempts another connection again.
// The backend deliberately ends the stream when the JWT expires:
// MineBench-Backend/src/modules/rewards/reward-events.routes.ts:42-44
//   const tokenLifetimeMs = Math.max(0, user.tokenExpiresAt - Date.now());
//   const tokenExpiry = setTimeout(() => reply.raw.end(), tokenLifetimeMs);
// so the normal end of a session is: the stream closes → the client reconnects → `authGuard` answers 401
// with the now-expired token → the stream latches "permanent failure".
//
// The client's own recovery path is `SolanaAuthButton`'s "Session expired — reconnect" button →
// `authService.connectWallet()` → `SolanaAuthService.login()` → `authStorage.setToken(<new token>)`
// (solanaAuth.ts:370-391). That does not restore the stream:
//   - the stream reads the token fresh on every connect (`const token = authStorage.getToken()`, line 40),
//     but it never connects again, because the latch is permanent;
//   - the component's subscription effect (SolanaAuthButton.tsx:207-233) is keyed on
//     `[authService, isConnected, refreshWalletBalance, user?.publicKey]`, none of which changes across a
//     re-login of the same wallet (`isConnected` stays true; `user.publicKey` keeps its value;
//     `refreshWalletBalance` depends only on `tokenMint` and `user?.publicKey`), so the effect does not re-run.
// Consequence: after a session expiry followed by a successful reconnect, the app silently stops receiving
// `rewards-distributed` / `payout-completed` events, and the balance/premium airdrop UI
// (`SolanaAuthButton.tsx:212-227`) stops updating until the app is restarted — the reward balance has no
// other refresh path (`PayoutStatusCard` polls a different endpoint, and no page polls `/rewards/balance`).
//
// The expected behaviour below is the stream's own recovery contract: a 401 must not disable the stream
// once a *different* credential is stored, because the credential the decision was based on no longer
// exists. (A fix may live in the library — clear the latch when the token changes and retry with backoff —
// or in the caller — expose/perform an explicit restart on re-login; this test encodes the library-side
// requirement, since that is where the permanent latch is.)
//
// Usage (from MineBench-Client):
//   node --experimental-loader ./tests/qa-loader.mjs --test tests/reward-event-stream.after-relogin.test.ts

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

const localStorageStub = new MemoryStorage();
const sessionStorageStub = new MemoryStorage();
(globalThis as any).window = {
  localStorage: localStorageStub,
  sessionStorage: sessionStorageStub,
  // The stream only uses `window.setTimeout` for the reconnect delay (1 s, doubling, jitter ≤ 500 ms).
  // The delay is clamped so the retry sequence stays observable without real-time waits; the ordering of
  // attempts is unchanged.
  setTimeout: (handler: any, ms?: number) => setTimeout(handler, Math.min(Number(ms) || 0, 20)),
  clearTimeout: (handle: any) => clearTimeout(handle)
};

const { subscribeToRewardEvents } = await import('../src/lib/reward-event-stream.ts');
const { authStorage } = await import('../src/lib/auth-storage.ts');

const encode = (text: string) => new TextEncoder().encode(text);
const streamOf = (chunks: string[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(encode(chunk));
    controller.close();
  }
});
// A stream that stays open after its initial frames, like a live SSE response.
const openStream = (chunks: string[]) => {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of chunks) controller.enqueue(encode(chunk));
    }
  });
  return { body, close: () => controllerRef?.close() };
};
const okStream = (chunks: string[]) => ({ ok: true, status: 200, body: streamOf(chunks) });
const httpStatus = (status: number) => ({ ok: false, status, body: null });

const calls: Array<{ url: string; authorization: string | null }> = [];
let handler: (call: { n: number; authorization: string | null }) => any = () => httpStatus(500);

(globalThis as any).fetch = async (url: unknown, init: any) => {
  const authorization = init?.headers?.Authorization ?? null;
  calls.push({ url: String(url), authorization });
  return handler({ n: calls.length, authorization });
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const failures: string[] = [];
const check = (label: string, actual: unknown, expected: unknown) => {
  if (actual !== expected) failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
};

// ---- Contrast 1: the stream works, dedupes by event id and ignores unknown/ready frames --------------
authStorage.setToken('token-ok');
const live = openStream([
  'event: ready\ndata: {}\n\n',
  'id: evt-1\nevent: rewards-distributed\ndata: {"entityId":"a"}\n\n',
  'id: evt-1\nevent: rewards-distributed\ndata: {"entityId":"a"}\n\n',
  ': heartbeat\n\n',
  'id: evt-2\nevent: payout-completed\ndata: {"entityId":"b"}\n\n'
]);
handler = () => ({ ok: true, status: 200, body: live.body });
const delivered: Array<{ id: string; type: string }> = [];
const stopOk = subscribeToRewardEvents((event) => delivered.push(event));
await delay(120);
check('the stream connects to the rewards events URL', calls[0]?.url?.endsWith('/api/rewards/events'), true);
check('the stream authenticates with the stored token', calls[0]?.authorization, 'Bearer token-ok');
check('known events are delivered', delivered.length, 2);
check('a repeated event id is delivered only once', delivered[0]?.id, 'evt-1');
check('the second event is delivered', delivered[1]?.id, 'evt-2');
handler = () => httpStatus(404);
live.close();
stopOk();
await delay(40);

// ---- Contrast 2: a transient failure is retried with the same credential -----------------------------
calls.length = 0;
authStorage.setToken('token-transient');
handler = () => httpStatus(500);
const stopTransient = subscribeToRewardEvents(() => {});
await delay(140);
const transientAttempts = calls.length;
stopTransient();
await delay(60);
check('a 500 is retried', transientAttempts >= 2, true);
check(
  'transient retries keep using the stored token',
  calls.every((call) => call.authorization === 'Bearer token-transient'),
  true
);
// At most the attempt that was already in flight when the subscription was stopped may still land.
check('unsubscribing stops the retries', calls.length - transientAttempts <= 1, true);

// ---- The defect: after a 401 the stream never resumes once a new token is stored ---------------------
calls.length = 0;
authStorage.setToken('token-expired');
handler = ({ n }) => (n === 1
  ? okStream(['event: ready\ndata: {}\n\n']) // backend closes the stream at JWT expiry
  : httpStatus(401));                        // reconnect with the expired token is rejected
const stopExpired = subscribeToRewardEvents(() => {});
await delay(160);
const attemptsAfter401 = calls.length;
// The user reconnects: SolanaAuthService.login() stores a fresh token (solanaAuth.ts:380).
authStorage.setToken('token-fresh');
await delay(300);
const attemptsAfterRelogin = calls.length;
const usedFreshToken = calls.some((call) => call.authorization === 'Bearer token-fresh');

console.log(
  `[QA] reward event stream attempts: ${attemptsAfter401} up to the 401, `
  + `${attemptsAfterRelogin} after the token was replaced (fresh token used: ${usedFreshToken})`
);

stopExpired();

// The stream must keep trying after the server ends the session (>= 2 rather than exactly 2, so this
// contrast also holds if the fix chooses to retry 401s with backoff while the token is unchanged).
check('the stream reconnects after the server ends the session', attemptsAfter401 >= 2, true);
check('the 401 attempt used the expired token', calls[1]?.authorization, 'Bearer token-expired');
check('the stream reconnects after the stored token is replaced', usedFreshToken, true);

assert.deepEqual(failures, [], `reward event stream after re-login:\n  ${failures.join('\n  ')}`);

console.log('reward event stream after re-login tests passed');
