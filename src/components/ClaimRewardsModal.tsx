import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader } from './icons';
import { cn } from '../lib/utils';
import { SolanaAuthService } from '../services/solanaAuth';

interface ClaimRewardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: string;
  availableBalance: number;
  minWithdrawal: number;
  theme: 'light' | 'dark';
  onClaimed?: () => void | Promise<void>;
}

interface PayoutQuote {
  requestedAmountBmt: number;
  netAmountBmt: number;
  feeBmt: number;
  networkFeeSol: number;
  transactionNetworkFeeSol?: number;
  ataRentSol: number;
  totalSolCost: number;
  batchTargetSize?: number;
  recipientAtaExists: boolean;
  canClaim: boolean;
  isEstimate?: boolean;
  requiresFullBatch?: boolean;
}

const toFiniteAmount = (value: unknown) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
};

const formatBmt = (value: number) => toFiniteAmount(value).toFixed(6);

export const ClaimRewardsModal: React.FC<ClaimRewardsModalProps> = ({
  isOpen,
  onClose,
  wallet,
  availableBalance,
  minWithdrawal,
  theme,
  onClaimed,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<PayoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isDark = theme === 'dark';
  const MIN_WITHDRAWAL = Math.max(minWithdrawal, 0.000001);
  const amountNum = parseFloat(amount);
  const grossAmount = toFiniteAmount(quote?.requestedAmountBmt ?? amountNum);
  const netAmount = toFiniteAmount(quote?.netAmountBmt);
  const canClaim = !!amount && !isNaN(amountNum) && amountNum >= MIN_WITHDRAWAL && amountNum <= availableBalance && quote?.canClaim === true;

  React.useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccess(null);
    setQuote(null);
    setQuoteError(null);
    setAmount(availableBalance > 0 ? formatBmt(availableBalance) : '');
  }, [isOpen, availableBalance]);

  React.useEffect(() => {
    if (!isOpen || !amount || isNaN(amountNum) || amountNum <= 0 || amountNum > availableBalance) {
      setQuote(null);
      setQuoteError(null);
      setIsQuoteLoading(false);
      return;
    }

    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    setIsQuoteLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const data = await SolanaAuthService.getInstance().quotePayout(amountNum) as PayoutQuote;
        if (!cancelled) setQuote(data);
      } catch (err: unknown) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setIsQuoteLoading(false);
      }
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen, amount, amountNum, availableBalance]);

  const handleMaxClick = () => {
    setAmount(formatBmt(availableBalance));
  };

  const handleClaim = async () => {
    setError(null);
    setSuccess(null);

    // Validation
    if (!amount || isNaN(amountNum)) {
      setError('Please enter a valid amount');
      return;
    }

    if (amountNum < MIN_WITHDRAWAL) {
      setError(`Minimum withdrawal is ${MIN_WITHDRAWAL} BMT`);
      return;
    }

    if (amountNum > availableBalance) {
      setError('Insufficient balance');
      return;
    }

    if (quote && !quote.canClaim) {
      setError('Claim amount is lower than the estimated Solana network cost');
      return;
    }

    setIsLoading(true);

    try {
      const data = await SolanaAuthService.getInstance().requestPayout(amountNum);
      const payoutId = data?.id ? `ID: ${data.id}` : 'pending processing';
      const received = Number(data?.amount_bmt ?? data?.quote?.netAmountBmt ?? 0);
      setSuccess(`Withdrawal request submitted — approximately ${received.toFixed(6)} BMT after fee, ${payoutId}`);
      window.dispatchEvent(new CustomEvent('minebench:payout-created', { detail: { payoutId: data?.id || null } }));
      setAmount('');
      await onClaimed?.();

      // Close modal after 3 seconds
      setTimeout(() => {
        onClose();
        setSuccess(null);
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to submit withdrawal');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className={cn(
          'fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2',
          'w-full max-w-md p-6 rounded-lg shadow-xl z-50',
          isDark
            ? 'bg-zinc-900 border border-zinc-800'
            : 'bg-white border border-zinc-200'
        )}
      >
        <h2
          className={cn(
            'text-2xl font-bold mb-4',
            isDark ? 'text-white' : 'text-zinc-900'
          )}
        >
          Claim Rewards
        </h2>

        {/* Available Balance */}
        <div
          className={cn(
            'p-4 rounded-lg mb-6',
            isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-zinc-50 border border-zinc-200'
          )}
        >
          <p className={isDark ? 'text-zinc-400' : 'text-zinc-600'}>
            Available Balance
          </p>
          <p className="text-3xl font-bold text-yellow-400 mt-2">
            {formatBmt(availableBalance)} BMT
          </p>
          <p
            className={cn(
              'text-sm mt-2',
              isDark ? 'text-zinc-500' : 'text-zinc-500'
            )}
          >
            Minimum claim: {MIN_WITHDRAWAL.toFixed(6).replace(/\.?0+$/, '')} BMT. The payout fee is deducted from the claim amount.
          </p>
        </div>

        {/* Amount Input */}
        <div className="mb-6">
          <label
            className={cn(
              'block text-sm font-medium mb-2',
              isDark ? 'text-zinc-300' : 'text-zinc-700'
            )}
          >
            Claim Amount, including fee (BMT)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount to claim"
              disabled={isLoading}
              className={cn(
                'flex-1 px-4 py-2 rounded-lg border text-sm',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isDark
                  ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500'
                  : 'bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400'
              )}
            />
            <button
              onClick={handleMaxClick}
              disabled={isLoading}
              className={cn(
                'px-4 py-2 rounded-lg text-sm font-medium',
                'disabled:opacity-50 disabled:cursor-not-allowed',
                isDark
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-white'
                  : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
              )}
            >
              Max
            </button>
          </div>
        </div>

        {amount && !isNaN(amountNum) && amountNum > 0 && (
          <div
            className={cn(
              'p-3 rounded-lg mb-6 text-sm space-y-1',
              isDark ? 'bg-zinc-800 border border-zinc-700 text-zinc-200' : 'bg-zinc-50 border border-zinc-200 text-zinc-700'
            )}
          >
            {isQuoteLoading ? (
              <p>Estimating Solana payout cost...</p>
            ) : quote ? (
              <>
                <div className="flex justify-between gap-3">
                  <span>Amount deducted</span>
                  <span>{grossAmount.toFixed(6)} BMT</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Estimated payout cost</span>
                  <span>{Number(quote.totalSolCost || 0).toFixed(9)} SOL</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>Estimated payout fee</span>
                  <span>{Number(quote.feeBmt || 0).toFixed(6)} BMT</span>
                </div>
                {toFiniteAmount(quote.ataRentSol) > 0 && (
                  <div className={cn('text-xs', isDark ? 'text-zinc-400' : 'text-zinc-500')}>
                    Includes first-time BMT token account rent: {toFiniteAmount(quote.ataRentSol).toFixed(9)} SOL
                  </div>
                )}
                <div className="flex justify-between gap-3 font-semibold">
                  <span>Estimated wallet amount</span>
                  <span className={netAmount > 0 ? 'text-yellow-400' : 'text-red-400'}>
                    {formatBmt(netAmount)} BMT
                  </span>
                </div>
                {(quote.batchTargetSize || 0) > 1 && (
                  <div className={cn('text-xs', isDark ? 'text-zinc-400' : 'text-zinc-500')}>
                    Network fee is shared across a full batch of {quote.batchTargetSize} payouts. The final amount is recorded when the batch is executed.
                  </div>
                )}
              </>
            ) : (
              <p className={isDark ? 'text-red-300' : 'text-red-600'}>
                {quoteError || 'Fee quote is unavailable. Retry before submitting the claim.'}
              </p>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div
            className={cn(
              'p-3 rounded-lg mb-6 flex items-center gap-2',
              isDark
                ? 'bg-red-950 border border-red-900 text-red-200'
                : 'bg-red-50 border border-red-200 text-red-700'
            )}
          >
            <AlertCircle size={16} />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div
            className={cn(
              'p-3 rounded-lg mb-6 flex items-center gap-2',
              isDark
                ? 'bg-emerald-950 border border-emerald-900 text-emerald-200'
                : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            )}
          >
            <CheckCircle size={16} />
            <p className="text-sm">{success}</p>
          </div>
        )}

        {/* Warning */}
        <div
          className={cn(
            'p-3 rounded-lg mb-6 text-xs',
            isDark
              ? 'bg-yellow-950/50 border border-yellow-900/50 text-yellow-200'
              : 'bg-yellow-50 border border-yellow-200 text-yellow-700'
          )}
        >
          <p>
            <strong>Note:</strong> The transaction is sent only after its payout batch is completely filled. There is no automatic partial-batch timeout.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg font-medium',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              isDark
                ? 'bg-zinc-800 hover:bg-zinc-700 text-white'
                : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
            )}
          >
            Cancel
          </button>
          <button
            onClick={handleClaim}
            disabled={isLoading || isQuoteLoading || !canClaim}
            className={cn(
              'flex-1 px-4 py-2 rounded-lg font-medium flex items-center justify-center gap-2',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'bg-yellow-400 hover:bg-yellow-500 text-black transition-colors'
            )}
          >
            {isLoading ? (
              <>
                <Loader size={16} className="animate-spin" />
                Processing...
              </>
            ) : (
              'Claim Rewards'
            )}
          </button>
        </div>
      </div>
    </>
  );
};
