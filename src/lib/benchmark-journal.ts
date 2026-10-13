export type BenchmarkJournalStatus = 'running' | 'completed' | 'failed' | 'stopped';
export type BenchmarkSubmissionStatus = 'unsubmitted' | 'saved' | 'failed';

export interface BenchmarkShareEntry {
  id: string;
  recordedAt: number;
  count: number;
}

export interface BenchmarkJournalSession {
  id: string;
  startedAt: number;
  completedAt?: number;
  durationSeconds?: number;
  avgHashrate?: number;
  maxHashrate?: number;
  acceptedShares: number;
  status: BenchmarkJournalStatus;
  submissionStatus: BenchmarkSubmissionStatus;
  submissionFailureReason?: string;
  failureReason?: string;
  shares: BenchmarkShareEntry[];
}

const STORAGE_PREFIX = 'minebench_benchmark_journal_v1:';
const MAX_SESSIONS = 30;
const MAX_SHARE_ENTRIES = 100;
export const BENCHMARK_JOURNAL_UPDATED_EVENT = 'minebench:benchmark-journal-updated';

const storageFor = () => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const keyForWallet = (wallet: string) => `${STORAGE_PREFIX}${encodeURIComponent(wallet)}`;

const validWallet = (wallet: string | null | undefined): wallet is string =>
  typeof wallet === 'string'; // An empty key keeps unauthenticated local runs separate from wallet history.

const asFiniteNumber = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizeSession = (value: any): BenchmarkJournalSession | null => {
  if (!value || typeof value.id !== 'string' || !Number.isFinite(Number(value.startedAt))) return null;
  const status: BenchmarkJournalStatus = ['running', 'completed', 'failed', 'stopped'].includes(value.status)
    ? value.status
    : 'stopped';
  const shares = Array.isArray(value.shares)
    ? value.shares
      .filter((entry: any) => entry && typeof entry.id === 'string' && Number(entry.count) > 0)
      .slice(-MAX_SHARE_ENTRIES)
      .map((entry: any) => ({
        id: entry.id,
        recordedAt: asFiniteNumber(entry.recordedAt, Date.now()),
        count: Math.max(1, Math.floor(asFiniteNumber(entry.count)))
      }))
    : [];

  return {
    id: value.id,
    startedAt: asFiniteNumber(value.startedAt),
    completedAt: Number.isFinite(Number(value.completedAt)) ? Number(value.completedAt) : undefined,
    durationSeconds: Number.isFinite(Number(value.durationSeconds)) ? Math.max(0, Number(value.durationSeconds)) : undefined,
    avgHashrate: Number.isFinite(Number(value.avgHashrate)) ? Math.max(0, Number(value.avgHashrate)) : undefined,
    maxHashrate: Number.isFinite(Number(value.maxHashrate)) ? Math.max(0, Number(value.maxHashrate)) : undefined,
    acceptedShares: Math.max(0, Math.floor(asFiniteNumber(value.acceptedShares))),
    status,
    submissionStatus: ['unsubmitted', 'saved', 'failed'].includes(value.submissionStatus)
      ? value.submissionStatus
      : 'unsubmitted',
    submissionFailureReason: typeof value.submissionFailureReason === 'string'
      ? value.submissionFailureReason.slice(0, 240)
      : undefined,
    failureReason: typeof value.failureReason === 'string' ? value.failureReason.slice(0, 240) : undefined,
    shares
  };
};

export function getBenchmarkJournal(wallet: string | null | undefined): BenchmarkJournalSession[] {
  if (!validWallet(wallet)) return [];
  try {
    const raw = storageFor()?.getItem(keyForWallet(wallet));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(normalizeSession).filter((entry): entry is BenchmarkJournalSession => !!entry).slice(-MAX_SESSIONS).reverse()
      : [];
  } catch {
    return [];
  }
}

function persist(wallet: string, sessionsNewestFirst: BenchmarkJournalSession[]) {
  try {
    storageFor()?.setItem(keyForWallet(wallet), JSON.stringify(sessionsNewestFirst.slice(0, MAX_SESSIONS).reverse()));
    window.dispatchEvent(new CustomEvent(BENCHMARK_JOURNAL_UPDATED_EVENT, { detail: { wallet } }));
  } catch {
    // Local history is optional. Mining and benchmarking must not fail if storage is unavailable.
  }
}

function newId() {
  return `benchmark-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBenchmarkJournalSession(
  wallet: string | null | undefined,
  details: Pick<BenchmarkJournalSession, 'startedAt' | 'durationSeconds'> & Partial<Pick<BenchmarkJournalSession, 'id'>>
): string | null {
  if (!validWallet(wallet)) return null;
  const id = details.id || newId();
  const session: BenchmarkJournalSession = {
    id,
    startedAt: asFiniteNumber(details.startedAt, Date.now()),
    durationSeconds: Number.isFinite(Number(details.durationSeconds)) ? Math.max(0, Number(details.durationSeconds)) : undefined,
    acceptedShares: 0,
    status: 'running',
    submissionStatus: 'unsubmitted',
    shares: []
  };
  persist(wallet, [session, ...getBenchmarkJournal(wallet)]);
  return id;
}

export function updateBenchmarkJournalSession(
  wallet: string | null | undefined,
  id: string | null | undefined,
  updates: Partial<Omit<BenchmarkJournalSession, 'id' | 'startedAt' | 'shares'>>
) {
  if (!validWallet(wallet) || !id) return;
  const sessions = getBenchmarkJournal(wallet);
  const index = sessions.findIndex((session) => session.id === id);
  if (index < 0) return;
  const previous = sessions[index];
  const status = updates.status && ['running', 'completed', 'failed', 'stopped'].includes(updates.status)
    ? updates.status
    : previous.status;
  sessions[index] = {
    ...previous,
    ...updates,
    status,
    acceptedShares: Math.max(previous.acceptedShares, Math.floor(asFiniteNumber(updates.acceptedShares, previous.acceptedShares)))
  };
  persist(wallet, sessions);
}

/** Stores only the delta from the cumulative miner/pool accepted-share count. */
export function recordBenchmarkAcceptedShares(
  wallet: string | null | undefined,
  id: string | null | undefined,
  cumulativeAcceptedShares: number,
  recordedAt = Date.now()
) {
  if (!validWallet(wallet) || !id) return;
  const total = Math.max(0, Math.floor(asFiniteNumber(cumulativeAcceptedShares)));
  const sessions = getBenchmarkJournal(wallet);
  const index = sessions.findIndex((session) => session.id === id);
  if (index < 0) return;
  const session = sessions[index];
  const delta = total - session.acceptedShares;
  if (delta <= 0) return;
  session.acceptedShares = total;
  session.shares = [...session.shares, { id: `${id}-share-${recordedAt}`, recordedAt, count: delta }].slice(-MAX_SHARE_ENTRIES);
  persist(wallet, sessions);
}
