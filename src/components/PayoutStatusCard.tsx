import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, RefreshCw } from './icons';
import { cn } from '../lib/utils';
import { SolanaAuthService } from '../services/solanaAuth';
import type { PayoutStatus } from '../services/solanaAuth';

interface PayoutStatusCardProps {
  theme: 'light' | 'dark';
  wallet: string;
  isConnected: boolean;
}

const statusMeta = (status: string) => {
  if (status === 'completed') return { label: 'Paid on Solana', Icon: CheckCircle, tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' };
  if (status === 'failed') return { label: 'Action required', Icon: AlertCircle, tone: 'text-red-400 border-red-500/30 bg-red-500/10' };
  return { label: 'Queued · waiting for batch', Icon: Clock, tone: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' };
};

const shortSignature = (value: string) => `${value.slice(0, 8)}…${value.slice(-8)}`;
const isCachedPayoutStatus = (value: any): value is PayoutStatus => !!value
  && typeof value.id === 'string'
  && typeof value.status === 'string'
  && ['batchTargetSize', 'batchFilled', 'batchRemaining', 'queuePosition', 'positionInBatch',
    'requestedAmountBmt', 'amountBmt', 'feeBmt'].every((key) => typeof value[key] === 'number' && Number.isFinite(value[key]))
  && (value.queue == null || ['pendingCount', 'requestedAmountBmt', 'amountBmt', 'feeBmt',
    'totalPendingCount', 'batchPendingCount'].every((key) => typeof value.queue[key] === 'number' && Number.isFinite(value.queue[key])));

export const PayoutStatusCard: React.FC<PayoutStatusCardProps> = ({ theme, wallet, isConnected }) => {
  const [snapshot, setSnapshot] = useState<{ wallet: string; payout: PayoutStatus | null } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const isDark = theme === 'dark';
  const cacheKey = wallet ? `minebench:payout-status:${wallet}` : '';
  const payout = isConnected && snapshot?.wallet === wallet ? snapshot.payout : null;

  useEffect(() => {
    if (!isConnected || !cacheKey) return;
    let cancelled = false;
    let requestVersion = 0;
    let timer: number | undefined;
    setVerified(false);
    setRefreshError(false);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      setSnapshot({ wallet, payout: isCachedPayoutStatus(cached) ? cached : null });
    } catch {
      setSnapshot({ wallet, payout: null });
    }
    const refresh = async () => {
      window.clearTimeout(timer);
      const version = ++requestVersion;
      setRefreshing(true);
      try {
        const latest = await SolanaAuthService.getInstance().getLatestPayoutStatus();
        if (cancelled || version !== requestVersion) return;
        setSnapshot({ wallet, payout: latest });
        setVerified(true);
        setRefreshError(false);
        try {
          if (latest) localStorage.setItem(cacheKey, JSON.stringify(latest));
          else localStorage.removeItem(cacheKey);
        } catch { /* Status remains available when browser storage is unavailable. */ }
      } catch {
        if (cancelled || version !== requestVersion) return;
        setVerified(false);
        setRefreshError(true);
      } finally {
        if (!cancelled && version === requestVersion) {
          setRefreshing(false);
          timer = window.setTimeout(() => void refresh(), 15_000);
        }
      }
    };
    void refresh();
    const handleCreated = () => void refresh();
    window.addEventListener('minebench:payout-created', handleCreated);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('minebench:payout-created', handleCreated);
    };
  }, [cacheKey, isConnected, wallet, refreshVersion]);

  if (!isConnected || !wallet) return null;
  if (!payout) return (
    <div role="status" className={cn('rounded-lg border p-4 text-sm', isDark ? 'border-white/10 text-zinc-400' : 'border-zinc-200 text-zinc-600')}>
      {refreshError ? 'Payout queue unavailable. Retrying automatically.' : refreshing || snapshot?.wallet !== wallet ? 'Loading payout queue…' : 'No payouts queued for this wallet.'}
    </div>
  );

  const queue = payout.queue;
  const pendingCount = queue?.pendingCount ?? (payout.status === 'pending' ? 1 : 0);
  const hasPending = pendingCount > 0;
  const requestedAmount = hasPending ? queue?.requestedAmountBmt ?? payout.requestedAmountBmt : payout.requestedAmountBmt;
  const fee = hasPending ? queue?.feeBmt ?? payout.feeBmt : payout.feeBmt;
  const amount = hasPending ? queue?.amountBmt ?? payout.amountBmt : payout.amountBmt;
  const meta = statusMeta(payout.status);
  const progress = payout.batchTargetSize > 0
    ? Math.min((payout.batchFilled / payout.batchTargetSize) * 100, 100)
    : 0;
  const amountLabel = hasPending ? 'Estimated wallet total' : payout.status === 'completed' ? 'Wallet received' : 'Estimated wallet amount';

  return (
    <section className={cn(
      'relative overflow-hidden rounded-lg border p-5',
      isDark ? 'border-white/10 bg-zinc-900/60' : 'border-zinc-200 bg-white'
    )}>
      <div className="absolute inset-y-0 left-0 w-1 bg-yellow-400" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={cn('text-[10px] font-mono uppercase tracking-[0.22em]', isDark ? 'text-zinc-500' : 'text-zinc-500')}>
            {hasPending ? 'Wallet payout queue' : 'Latest payout'} · {verified ? 'backend verified' : 'cached · awaiting refresh'}
          </div>
          <h3 className={cn('mt-1 text-lg font-semibold', isDark ? 'text-white' : 'text-zinc-900')}>
            {hasPending ? `${pendingCount} payout${pendingCount === 1 ? '' : 's'} queued for this wallet` : 'Latest payout'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider', meta.tone)}>
            <meta.Icon size={13} />
            {meta.label}
          </span>
          <button
            type="button"
            onClick={() => setRefreshVersion((value) => value + 1)}
            disabled={refreshing}
            aria-label="Refresh payout status"
            className={cn('rounded border p-1.5 transition-colors disabled:opacity-50', isDark ? 'border-white/10 text-zinc-400 hover:text-white' : 'border-zinc-200 text-zinc-500 hover:text-zinc-900')}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>{hasPending ? 'Total queued claims' : 'Claim amount'}</div>
          <div className={cn('mt-1 font-mono text-sm', isDark ? 'text-white' : 'text-zinc-900')}>{requestedAmount.toFixed(6)} BMT</div>
        </div>
        <div>
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>{hasPending ? 'Estimated total fees' : 'Final fee'}</div>
          <div className="mt-1 font-mono text-sm text-yellow-400">{fee.toFixed(6)} BMT</div>
        </div>
        <div>
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>{amountLabel}</div>
          <div className="mt-1 font-mono text-sm text-emerald-400">{amount.toFixed(6)} BMT</div>
        </div>
      </div>

      {hasPending && (
        <div className="mt-5">
          {queue && <p className={cn('mb-3 text-xs', isDark ? 'text-zinc-400' : 'text-zinc-600')}>
            Network queue: {queue.totalPendingCount} payouts · {queue.batchPendingCount} in this batch type
          </p>}
          <p className={cn('mb-2 text-xs', isDark ? 'text-zinc-400' : 'text-zinc-600')}>
            {queue ? 'Oldest queued payout' : 'Queued payout'} · {payout.batchKind === 'missing_ata' ? 'token account creation batch' : 'standard batch'}
          </p>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className={isDark ? 'text-zinc-400' : 'text-zinc-600'}>
              Batch {payout.batchFilled}/{payout.batchTargetSize}
            </span>
            <span className="font-mono text-yellow-400">
              {payout.batchRemaining === 0 ? 'Ready for worker' : `${payout.batchRemaining} slots remaining`}
            </span>
          </div>
          <div className={cn('mt-2 h-2 overflow-hidden rounded-full', isDark ? 'bg-zinc-950' : 'bg-zinc-200')}>
            <div className="h-full bg-yellow-400 transition-[width] duration-500" style={{ width: `${progress}%` }} />
          </div>
          <div className={cn('mt-2 text-[10px] font-mono', isDark ? 'text-zinc-600' : 'text-zinc-500')}>
            Queue position in this batch type #{payout.queuePosition} · slot {payout.positionInBatch}/{payout.batchTargetSize}
          </div>
        </div>
      )}

      {refreshError && <p role="status" className="mt-3 text-xs text-yellow-500">Queue refresh failed. Displayed amounts may be out of date; retrying automatically.</p>}
      {hasPending && <p className={cn('mt-3 text-xs', isDark ? 'text-zinc-400' : 'text-zinc-600')}>Payouts wait until their batch is full. Final amounts and fees are confirmed after processing.</p>}
      {payout.txSignature && (
        <div className={cn('mt-4 border-t pt-3 font-mono text-[10px]', isDark ? 'border-white/10 text-zinc-500' : 'border-zinc-200 text-zinc-500')}>
          Transaction {shortSignature(payout.txSignature)}
        </div>
      )}
      {payout.errorMessage && <div className="mt-3 text-xs text-red-400">{payout.errorMessage}</div>}
    </section>
  );
};
