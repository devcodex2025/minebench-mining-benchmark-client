import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Loader } from './icons';
import { cn } from '../lib/utils';
import { SolanaAuthService } from '../services/solanaAuth';

interface ClaimRewardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  wallet: string;
  availableBalance: number;
  theme: 'light' | 'dark';
  onClaimed?: () => void | Promise<void>;
}

export const ClaimRewardsModal: React.FC<ClaimRewardsModalProps> = ({
  isOpen,
  onClose,
  wallet,
  availableBalance,
  theme,
  onClaimed,
}) => {
  const [amount, setAmount] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isDark = theme === 'dark';
  const MIN_WITHDRAWAL = 100;

  React.useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setSuccess(null);
    setAmount(availableBalance >= MIN_WITHDRAWAL ? Math.floor(availableBalance).toString() : '');
  }, [isOpen, availableBalance]);

  const handleMaxClick = () => {
    setAmount(Math.floor(availableBalance).toString());
  };

  const handleClaim = async () => {
    setError(null);
    setSuccess(null);

    const amountNum = parseFloat(amount);

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

    setIsLoading(true);

    try {
      const data = await SolanaAuthService.getInstance().requestPayout(amountNum);
      const payoutId = data?.id ? `ID: ${data.id}` : 'pending processing';
      setSuccess(`Withdrawal request submitted — ${payoutId}`);
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
            {availableBalance.toFixed(2)} BMT
          </p>
          <p
            className={cn(
              'text-sm mt-2',
              isDark ? 'text-zinc-500' : 'text-zinc-500'
            )}
          >
            Minimum withdrawal: {MIN_WITHDRAWAL} BMT
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
            Withdrawal Amount (BMT)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`Min: ${MIN_WITHDRAWAL}`}
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
            <strong>Note:</strong> Payouts are processed in batches. Please allow up to 24 hours for your transaction to appear on-chain.
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
            disabled={isLoading || !amount || parseFloat(amount) < MIN_WITHDRAWAL}
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
