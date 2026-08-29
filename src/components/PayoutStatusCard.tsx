import React, { useCallback, useEffect, useState } from 'react';
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
  return { label: 'Waiting for batch', Icon: Clock, tone: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10' };
};

const shortSignature = (value: string) => `${value.slice(0, 8)}…${value.slice(-8)}`;
const isCachedPayoutStatus = (value: any): value is PayoutStatus => !!value
  && typeof value.id === 'string'
  && typeof value.status === 'string'
  && Number.isFinite(Number(value.batchTargetSize))
  && Number.isFinite(Number(value.amountBmt));

export const PayoutStatusCard: React.FC<PayoutStatusCardProps> = ({ theme, wallet, isConnected }) => {
  const [payout, setPayout] = useState<PayoutStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const isDark = theme === 'dark';
  const cacheKey = wallet ? `minebench:payout-status:${wallet}` : '';

  const refresh = useCallback(async () => {
    if (!isConnected || !wallet) return;
    setRefreshing(true);
    try {
      const latest = await SolanaAuthService.getInstance().getLatestPayoutStatus();
      setPayout(latest);
      if (cacheKey) {
        if (latest) localStorage.setItem(cacheKey, JSON.stringify(latest));
        else localStorage.removeItem(cacheKey);
      }
    } catch (error) {
      console.warn('[PayoutStatus] Backend refresh failed; keeping cached status', error);
    } finally {
      setRefreshing(false);
    }
  }, [cacheKey, isConnected, wallet]);

  useEffect(() => {
    if (!cacheKey) {
      setPayout(null);
      return;
    }
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      if (isCachedPayoutStatus(cached)) setPayout(cached);
      else localStorage.removeItem(cacheKey);
    } catch {
      localStorage.removeItem(cacheKey);
    }
    void refresh();
    const interval = payout?.status === 'pending'
      ? window.setInterval(() => void refresh(), 15_000)
      : null;
    const handleCreated = () => window.setTimeout(() => void refresh(), 250);
    window.addEventListener('minebench:payout-created', handleCreated);
    return () => {
      if (interval) window.clearInterval(interval);
      window.removeEventListener('minebench:payout-created', handleCreated);
    };
  }, [cacheKey, payout?.status, refresh]);

  if (!payout) return null;

  const meta = statusMeta(payout.status);
  const progress = payout.batchTargetSize > 0
    ? Math.min((payout.batchFilled / payout.batchTargetSize) * 100, 100)
    : 0;
  const amountLabel = payout.isEstimate ? 'Estimated wallet amount' : 'Wallet received';

  return (
    <section className={cn(
      'relative overflow-hidden rounded-lg border p-5',
      isDark ? 'border-white/10 bg-zinc-900/60' : 'border-zinc-200 bg-white'
    )}>
      <div className="absolute inset-y-0 left-0 w-1 bg-yellow-400" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className={cn('text-[10px] font-mono uppercase tracking-[0.22em]', isDark ? 'text-zinc-500' : 'text-zinc-500')}>
            Latest payout · backend verified
          </div>
          <h3 className={cn('mt-1 text-lg font-semibold', isDark ? 'text-white' : 'text-zinc-900')}>
            {payout.batchKind === 'missing_ata' ? 'ATA creation batch' : 'Standard payout batch'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider', meta.tone)}>
            <meta.Icon size={13} />
            {meta.label}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
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
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>Claim amount</div>
          <div className={cn('mt-1 font-mono text-sm', isDark ? 'text-white' : 'text-zinc-900')}>{payout.requestedAmountBmt.toFixed(6)} BMT</div>
        </div>
        <div>
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>{payout.isEstimate ? 'Estimated fee' : 'Final fee'}</div>
          <div className="mt-1 font-mono text-sm text-yellow-400">{payout.feeBmt.toFixed(6)} BMT</div>
        </div>
        <div>
          <div className={cn('text-[10px] uppercase tracking-wider', isDark ? 'text-zinc-500' : 'text-zinc-500')}>{amountLabel}</div>
          <div className="mt-1 font-mono text-sm text-emerald-400">{payout.amountBmt.toFixed(6)} BMT</div>
        </div>
      </div>

      {payout.status === 'pending' && (
        <div className="mt-5">
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
            Queue position #{payout.queuePosition} · slot {payout.positionInBatch}/{payout.batchTargetSize}
          </div>
        </div>
      )}

      {payout.txSignature && (
        <div className={cn('mt-4 border-t pt-3 font-mono text-[10px]', isDark ? 'border-white/10 text-zinc-500' : 'border-zinc-200 text-zinc-500')}>
          Transaction {shortSignature(payout.txSignature)}
        </div>
      )}
      {payout.errorMessage && <div className="mt-3 text-xs text-red-400">{payout.errorMessage}</div>}
    </section>
  );
};
