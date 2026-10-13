import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const textContent = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textContent).join('');
  if (node && typeof node === 'object' && 'children' in node) return textContent((node as { children: unknown }).children);
  return '';
};

const payout = (overrides: Record<string, unknown> = {}) => ({
  id: 'payout-1',
  status: 'pending',
  requestedAmountBmt: 1,
  amountBmt: 0.99,
  feeBmt: 0.01,
  networkFeeSol: 0,
  ataRentSol: 0,
  totalSolCost: 0,
  txSignature: null,
  errorMessage: null,
  batchKind: 'existing_ata',
  batchTargetSize: 10,
  batchFilled: 2,
  batchRemaining: 8,
  queuePosition: 1,
  positionInBatch: 1,
  isEstimate: true,
  createdAt: null,
  processedAt: null,
  completedAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function createHarness(getLatestPayoutStatus: () => Promise<unknown>, cached: unknown = null, cachedRaw?: string) {
  const states: unknown[] = [];
  const effects: Array<{ deps?: unknown[]; cleanup?: () => void }> = [];
  let cursor = 0;
  let rendered: unknown;
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  let nextTimer = 1;

  const React = {
    createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props: props || {}, children }),
  };
  const react = {
    __esModule: true,
    default: React,
    useState: <T,>(initial: T) => {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index] as T, (value: T | ((old: T) => T)) => {
        states[index] = typeof value === 'function' ? (value as (old: T) => T)(states[index] as T) : value;
      }] as const;
    },
    useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
      const index = cursor++;
      const prior = effects[index];
      const changed = !prior || !deps || !prior.deps || deps.length !== prior.deps.length || deps.some((value, i) => value !== prior.deps![i]);
      if (changed) {
        prior?.cleanup?.();
        effects[index] = { deps, cleanup: effect() || undefined };
      }
    },
  };

  const source = readFileSync(new URL('../components/PayoutStatusCard.tsx', import.meta.url), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: 'PayoutStatusCard.tsx',
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module,
    exports: module.exports,
    window: {
      clearTimeout: (id: number) => timers.delete(id),
      setTimeout: (callback: () => void) => { const id = nextTimer++; timers.set(id, callback); return id; },
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      removeEventListener: (event: string) => listeners.delete(event),
    },
    localStorage: { getItem: () => cachedRaw ?? (cached == null ? null : JSON.stringify(cached)), setItem: () => undefined, removeItem: () => undefined },
    require: (id: string) => {
      if (id === 'react') return react;
      if (id === './icons') return { AlertCircle: () => null, CheckCircle: () => null, Clock: () => null, RefreshCw: () => null };
      if (id === '../lib/utils') return { cn: (...values: string[]) => values.filter(Boolean).join(' ') };
      if (id === '../services/solanaAuth') return { SolanaAuthService: { getInstance: () => ({ getLatestPayoutStatus }) } };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  new vm.Script(javascript).runInContext(context);
  const Component = module.exports.PayoutStatusCard as (props: Record<string, unknown>) => unknown;

  return {
    render(props: Record<string, unknown>) { cursor = 0; rendered = Component(props); return rendered; },
    text: () => textContent(rendered),
    dispatchCreated: () => listeners.get('minebench:payout-created')?.(),
    cleanup: () => effects.forEach((effect) => effect?.cleanup?.()),
  };
}

test('shows the same-wallet pending aggregate even when a newer payout is terminal', async () => {
  const response = deferred<unknown>();
  const harness = createHarness(() => response.promise);
  const props = { theme: 'dark', wallet: 'wallet-a', isConnected: true };

  harness.render(props);
  response.resolve(payout({
    // The service contract must return the oldest pending record in this case,
    // even though a later completed record exists.
    queue: { pendingCount: 2, requestedAmountBmt: 3, amountBmt: 2.94, feeBmt: 0.06, totalPendingCount: 7, batchPendingCount: 4 },
  }));
  await settle();
  harness.render(props);

  const text = harness.text();
  assert.match(text, /2 payouts queued for this wallet/);
  assert.match(text, /Total queued claims/);
  assert.match(text, /3\.000000 BMT/);
  assert.match(text, /Estimated wallet total/);
  assert.match(text, /2\.940000 BMT/);
  assert.match(text, /Network queue: 7 payouts/);
  harness.cleanup();
});

test('does not render a stale prior-wallet status after switching wallets', async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const responses = [first, second];
  const harness = createHarness(() => responses.shift()!.promise);

  harness.render({ theme: 'dark', wallet: 'wallet-a', isConnected: true });
  harness.render({ theme: 'dark', wallet: 'wallet-b', isConnected: true });
  second.resolve(payout({ id: 'payout-b', requestedAmountBmt: 2 }));
  await settle();
  harness.render({ theme: 'dark', wallet: 'wallet-b', isConnected: true });
  assert.match(harness.text(), /2\.000000 BMT/);

  first.resolve(payout({ id: 'payout-a', requestedAmountBmt: 9 }));
  await settle();
  harness.render({ theme: 'dark', wallet: 'wallet-b', isConnected: true });
  assert.doesNotMatch(harness.text(), /9\.000000 BMT/);
  assert.match(harness.text(), /2\.000000 BMT/);
  harness.cleanup();
});

test('refreshes immediately after a payout-created event and ignores an older in-flight response', async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const responses = [first, second];
  const harness = createHarness(() => responses.shift()!.promise);
  const props = { theme: 'dark', wallet: 'wallet-a', isConnected: true };

  harness.render(props);
  harness.dispatchCreated();
  second.resolve(payout({ queue: { pendingCount: 2, requestedAmountBmt: 3, amountBmt: 2.94, feeBmt: 0.06, totalPendingCount: 2, batchPendingCount: 2 } }));
  await settle();
  harness.render(props);
  assert.match(harness.text(), /2 payouts queued for this wallet/);

  first.resolve(payout({ queue: { pendingCount: 1, requestedAmountBmt: 1, amountBmt: 0.99, feeBmt: 0.01, totalPendingCount: 1, batchPendingCount: 1 } }));
  await settle();
  harness.render(props);
  assert.match(harness.text(), /2 payouts queued for this wallet/);
  assert.doesNotMatch(harness.text(), /1 payout queued for this wallet/);
  harness.cleanup();
});

test('keeps a valid cached status visible when a refresh fails', async () => {
  const cached = payout({ status: 'completed', amountBmt: 0.99, isEstimate: false });
  const harness = createHarness(async () => { throw new Error('offline'); }, cached);
  const props = { theme: 'dark', wallet: 'wallet-a', isConnected: true };

  harness.render(props);
  await settle();
  harness.render(props);
  assert.match(harness.text(), /0\.990000 BMT/);
  assert.match(harness.text(), /Queue refresh failed\. Displayed amounts may be out of date/);
  harness.cleanup();
});

test('renders an empty response and a completed payout without queue-only labels', async () => {
  const empty = createHarness(async () => null);
  const props = { theme: 'dark', wallet: 'wallet-a', isConnected: true };
  empty.render(props);
  await settle();
  empty.render(props);
  assert.match(empty.text(), /No payouts queued for this wallet/);
  empty.cleanup();

  const completed = createHarness(async () => payout({ status: 'completed', amountBmt: 0.99, isEstimate: false }));
  completed.render(props);
  await settle();
  completed.render(props);
  assert.match(completed.text(), /Latest payout/);
  assert.match(completed.text(), /Wallet received/);
  assert.doesNotMatch(completed.text(), /queued for this wallet/);
  completed.cleanup();
});

test('ignores corrupt cached storage and cancels the old request across disconnect and reconnect', async () => {
  const first = deferred<unknown>();
  const second = deferred<unknown>();
  const responses = [first, second];
  const harness = createHarness(() => responses.shift()!.promise, null, '{bad json');
  const connected = { theme: 'dark', wallet: 'wallet-a', isConnected: true };

  harness.render(connected);
  assert.match(harness.text(), /Loading payout queue/);
  harness.render({ ...connected, isConnected: false });
  assert.equal(harness.text(), '');
  harness.render(connected);
  second.resolve(payout({ requestedAmountBmt: 2 }));
  await settle();
  harness.render(connected);
  assert.match(harness.text(), /2\.000000 BMT/);

  first.resolve(payout({ requestedAmountBmt: 9 }));
  await settle();
  harness.render(connected);
  assert.doesNotMatch(harness.text(), /9\.000000 BMT/);
  harness.cleanup();
});
