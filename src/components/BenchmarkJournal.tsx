import React, { useEffect, useRef, useState } from 'react';
import { Award, Coins, Loader, RefreshCw, X, Zap } from './icons';
import { authStorage } from '../lib/auth-storage';
import { backendJson } from '../lib/backend-api';
import { BENCHMARK_JOURNAL_UPDATED_EVENT, getBenchmarkJournal, type BenchmarkJournalSession } from '../lib/benchmark-journal';
import { cn, formatHashrate } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { useSolanaAuth } from '../services/solanaAuth';

interface RewardHistoryEntry {
  id?: string;
  amount: number;
  currency: 'BMT' | 'XMR';
  type?: string;
  created_at: string;
}

interface BenchmarkJournalProps {
  wallet: string | null | undefined;
  isOpen: boolean;
  onClose: () => void;
}

const formatDate = (timestamp: number | string) => {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
};

const statusLabel: Record<BenchmarkJournalSession['status'], string> = {
  running: 'Running', completed: 'Completed', failed: 'Failed', stopped: 'Stopped'
};

const submissionLabel: Record<BenchmarkJournalSession['submissionStatus'], string> = {
  unsubmitted: 'Not submitted', saved: 'Submitted', failed: 'Submission failed'
};

export const BenchmarkJournal: React.FC<BenchmarkJournalProps> = ({ wallet, isOpen, onClose }) => {
  const { theme } = useTheme();
  const [sessions, setSessions] = useState<BenchmarkJournalSession[]>([]);
  const [rewards, setRewards] = useState<RewardHistoryEntry[]>([]);
  const [rewardState, setRewardState] = useState<'idle' | 'loading' | 'error' | 'loaded'>('idle');
  const requestRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const refreshLocal = () => setSessions(getBenchmarkJournal(wallet));
  const refreshRewards = async (requestId = requestRef.current) => {
    if (!wallet || useSolanaAuth.getState().user?.publicKey !== wallet) return;
    const token = authStorage.getToken();
    if (!token) {
      if (requestId !== requestRef.current) return;
      setRewards([]);
      setRewardState('loaded');
      return;
    }
    setRewardState('loading');
    try {
      const payload = await backendJson<unknown>('/api/rewards/history?limit=30', { token });
      if (
        requestId !== requestRef.current ||
        useSolanaAuth.getState().user?.publicKey !== wallet ||
        authStorage.getToken() !== token
      ) return;
      setRewards(Array.isArray(payload)
        ? payload.filter((entry: any) => entry?.currency === 'BMT' && Number(entry.amount) > 0).slice(0, 30)
        : []);
      setRewardState('loaded');
    } catch {
      if (
        requestId !== requestRef.current ||
        useSolanaAuth.getState().user?.publicKey !== wallet ||
        authStorage.getToken() !== token
      ) return;
      setRewards([]);
      setRewardState('error');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const requestId = ++requestRef.current;
    setSessions(getBenchmarkJournal(wallet));
    setRewards([]);
    setRewardState(wallet ? 'loading' : 'idle');
    refreshLocal();
    if (wallet) void refreshRewards(requestId);
    const onJournalUpdated = (event: Event) => {
      const changedWallet = (event as CustomEvent<{ wallet?: string }>).detail?.wallet;
      if (changedWallet === wallet) refreshLocal();
    };
    window.addEventListener(BENCHMARK_JOURNAL_UPDATED_EVENT, onJournalUpdated);
    return () => {
      ++requestRef.current;
      window.removeEventListener(BENCHMARK_JOURNAL_UPDATED_EVENT, onJournalUpdated);
    };
  }, [isOpen, wallet]);

  useEffect(() => {
    if (!isOpen) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusDialog = () => dialogRef.current?.focus();
    const frame = requestAnimationFrame(focusDialog);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => !element.hasAttribute('hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const panelClass = theme === 'light'
    ? 'bg-white border-zinc-200 text-zinc-900'
    : 'bg-zinc-950 border-white/10 text-white';
  const muted = theme === 'light' ? 'text-zinc-500' : 'text-zinc-400';

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 bg-black/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Benchmark journal">
      <div className={cn('w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-xl border shadow-2xl', panelClass)}>
        <div className={cn('sticky top-0 z-10 flex items-center justify-between border-b p-5', theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-950 border-white/10')}>
          <div>
            <h2 className="text-lg font-semibold">Benchmark journal</h2>
            <p className={cn('mt-1 text-xs', muted)}>Local benchmark and accepted-share records for this wallet.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { const requestId = ++requestRef.current; refreshLocal(); void refreshRewards(requestId); }} className={cn('rounded-md p-2 transition-colors', theme === 'light' ? 'hover:bg-zinc-100' : 'hover:bg-white/10')} aria-label="Refresh journal">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className={cn('rounded-md p-2 transition-colors', theme === 'light' ? 'hover:bg-zinc-100' : 'hover:bg-white/10')} aria-label="Close benchmark journal">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid gap-5 p-5 lg:grid-cols-2">
          <section>
            <div className="mb-3 flex items-center gap-2"><Award className="h-4 w-4 text-amber-400" /><h3 className="font-medium">Benchmark records</h3></div>
            <div className="space-y-2">
              {sessions.length === 0 ? <Empty className={muted} text="No benchmarks recorded on this device yet." /> : sessions.map((session) => (
                <div key={session.id} className={cn('rounded-lg border p-3 text-sm', theme === 'light' ? 'border-zinc-200 bg-zinc-50' : 'border-white/10 bg-white/[0.03]')}>
                  <div className="flex justify-between gap-3"><span>{formatDate(session.startedAt)}</span><span className={cn('font-medium', session.status === 'failed' ? 'text-red-400' : session.status === 'completed' ? 'text-emerald-400' : 'text-amber-400')}>{statusLabel[session.status]}</span></div>
                  <div className={cn('mt-2 grid grid-cols-3 gap-2 text-xs', muted)}><span>Avg {formatHashrate(session.avgHashrate || 0)}</span><span>Max {formatHashrate(session.maxHashrate || 0)}</span><span>{session.durationSeconds || 0}s</span></div>
                  {session.status !== 'running' && <p className={cn('mt-2 text-xs', session.submissionStatus === 'failed' ? 'text-red-400' : muted)}>Result: {submissionLabel[session.submissionStatus]}</p>}
                  {session.failureReason && <p className="mt-2 text-xs text-red-400">{session.failureReason}</p>}
                  {session.submissionFailureReason && <p className="mt-2 text-xs text-red-400">{session.submissionFailureReason}</p>}
                </div>
              ))}
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center gap-2"><Zap className="h-4 w-4 text-emerald-400" /><h3 className="font-medium">Accepted shares</h3></div>
            <div className="space-y-2">
              {sessions.flatMap((session) => session.shares.map((share) => ({ ...share, sessionId: session.id }))).length === 0
                ? <Empty className={muted} text="No locally observed accepted shares yet." />
                : sessions.flatMap((session) => session.shares.map((share) => ({ ...share, sessionId: session.id }))).sort((a, b) => b.recordedAt - a.recordedAt).slice(0, 100).map((share) => (
                  <div key={share.id} className={cn('flex items-center justify-between rounded-lg border p-3 text-sm', theme === 'light' ? 'border-zinc-200 bg-zinc-50' : 'border-white/10 bg-white/[0.03]')}>
                    <span className={muted}>{formatDate(share.recordedAt)}</span><span className="font-medium text-emerald-400">+{share.count} accepted</span>
                  </div>
                ))}
            </div>
            <p className={cn('mt-2 text-xs', muted)}>These are local miner observations and do not confirm a paid reward.</p>
          </section>

          <section className="lg:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Coins className="h-4 w-4 text-amber-400" /><h3 className="font-medium">Confirmed BMT reward history</h3></div>{rewardState === 'loading' && <Loader className="h-4 w-4 animate-spin" />}</div>
            <p className={cn('mb-3 text-xs', muted)}>Wallet-wide backend history. Rewards are not attributed to a specific benchmark unless the backend provides that link.</p>
            {rewardState === 'error' ? <Empty className={muted} text="Could not load confirmed reward history. Try refresh." />
              : rewards.length === 0 ? <Empty className={muted} text={rewardState === 'loading' ? 'Loading reward history…' : 'No confirmed BMT rewards yet.'} />
              : <div className="space-y-2">{rewards.map((reward, index) => <div key={reward.id || `${reward.created_at}-${index}`} className={cn('flex items-center justify-between rounded-lg border p-3 text-sm', theme === 'light' ? 'border-zinc-200 bg-zinc-50' : 'border-white/10 bg-white/[0.03]')}><span className={muted}>{formatDate(reward.created_at)} · {reward.type || 'MINING_REWARD'}</span><span className="font-medium text-amber-400">+{Number(reward.amount).toFixed(6)} BMT</span></div>)}</div>}
          </section>
        </div>
      </div>
    </div>
  );
};

const Empty: React.FC<{ className: string; text: string }> = ({ className, text }) => <div className={cn('rounded-lg border border-dashed p-4 text-sm', className)}>{text}</div>;
