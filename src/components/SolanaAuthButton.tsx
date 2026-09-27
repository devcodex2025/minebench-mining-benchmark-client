import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, LogOut, Loader, AlertCircle, CheckCircle } from './icons';
import { useSolanaAuth, SolanaAuthService } from '../services/solanaAuth';
import { useTheme } from '../contexts/ThemeContext';
import { getEnvironmentConfig } from '../config/environment';
import { cn } from '../lib/utils';
import { useMinerStore } from '../store/useMinerStore';
import { nativeApi } from '../lib/native-api';
import { authStorage } from '../lib/auth-storage';
import { notifyPayoutCompleted, notifyRewardsDistributed } from '../lib/reward-events';
import { subscribeToRewardEvents } from '../lib/reward-event-stream';

interface TokenAccount {
  account?: {
    data?: {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { uiAmount?: number; uiAmountString?: string };
        };
      };
    };
  };
}

interface TokenAccountsResponse {
  result?: { value?: TokenAccount[] };
}

interface NativeTokenBalanceResponse {
  success?: boolean;
  balance?: number | string;
  error?: string;
}

const fetchWalletTokenBalance = async (owner: string, mint: string): Promise<number> => {
  if ((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const result = await nativeApi.invoke<NativeTokenBalanceResponse>('solana_get_token_balance', { owner, mint });
      if (result?.success) {
        const balance = Number(result.balance || 0);
        return Number.isFinite(balance) ? balance : 0;
      }
      if (result?.error) console.warn('[BMT] Native balance error:', result.error);
    } catch (error) {
      console.warn('[BMT] Native balance unavailable, trying direct RPC:', error);
    }
  }

  const endpoints = [
    'https://api.mainnet-beta.solana.com',
    'https://rpc.ankr.com/solana'
  ];
  const tokenPrograms = [
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
  ];
  const rpc = async (url: string, body: unknown): Promise<TokenAccountsResponse> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`RPC ${response.status}`);
    return response.json() as Promise<TokenAccountsResponse>;
  };

  for (const url of endpoints) {
    try {
      const body = { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { mint }, { encoding: 'jsonParsed' }] };
      const payload = await rpc(url, body);
      const accounts = payload?.result?.value ?? [];
      if (accounts.length > 0) {
        return accounts.reduce((total: number, account: TokenAccount) => {
          const tokenAmount = account?.account?.data?.parsed?.info?.tokenAmount;
          return total + Number(tokenAmount?.uiAmountString ?? tokenAmount?.uiAmount ?? 0);
        }, 0);
      }
    } catch {
      continue;
    }
  }

  for (const url of endpoints) {
    for (const programId of tokenPrograms) {
      try {
        const body = { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { programId }, { encoding: 'jsonParsed' }] };
        const payload = await rpc(url, body);
        const accounts = payload?.result?.value ?? [];
        const total = accounts.reduce((balance: number, account: TokenAccount) => {
          const info = account?.account?.data?.parsed?.info;
          if (info?.mint !== mint) return balance;
          return balance + Number(info?.tokenAmount?.uiAmountString ?? info?.tokenAmount?.uiAmount ?? 0);
        }, 0);
        if (total > 0) return total;
      } catch {
        continue;
      }
    }
  }

  return 0;
};

const WalletAirdrop: React.FC<{ amount: number; animationKey: number }> = ({ amount, animationKey }) => (
  <div
    key={animationKey}
    className="pointer-events-none absolute inset-x-0 -top-10 z-20 flex justify-center"
    role="status"
    aria-live="polite"
  >
    <div className="relative h-20 w-36">
      {[-38, 0, 38].map((x, index) => (
        <span
          key={x}
          className="wallet-airdrop-coin absolute left-1/2 top-0 grid h-7 w-7 place-items-center rounded-full border border-yellow-200/80 bg-yellow-400 text-[8px] font-black text-yellow-950 shadow-[0_0_18px_rgba(250,204,21,0.55)]"
          style={{
            '--airdrop-x': `${x}px`,
            '--airdrop-delay': `${index * 120}ms`
          } as React.CSSProperties}
        >
          BMT
        </span>
      ))}
      <span className="wallet-airdrop-amount absolute inset-x-0 bottom-0 text-center text-xs font-bold text-emerald-400 drop-shadow">
        +{amount.toFixed(4)} BMT
      </span>
    </div>
  </div>
);

export const SolanaAuthButton: React.FC = () => {
  const { theme } = useTheme();
  const { user, isConnected, isConnecting, sessionExpired } = useSolanaAuth();
  const [error, setError] = useState<string | null>(null);
  const [bmtBalance, setBmtBalance] = useState<number | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);
  const [rewardBalance, setRewardBalance] = useState(0);
  const [walletTokenBalance, setWalletTokenBalance] = useState<number | null>(null);
  const [airdrop, setAirdrop] = useState<{ amount: number; key: number } | null>(null);
  const previousWalletBalanceRef = useRef<number | null>(null);
  const balanceOwnerRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef(false);
  const airdropTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenMint = getEnvironmentConfig().bmtTokenMint;
  const authService = SolanaAuthService.getInstance();
  const dbTotalBMT = useMinerStore(state => state.dbTotalBMT);
  const miningStatus = useMinerStore(state => state.status);
  const isMiningLocked = miningStatus === 'running' || miningStatus === 'starting' || miningStatus === 'paused';

  useEffect(() => {
    if (isConnected && user?.publicKey && Number.isFinite(dbTotalBMT)) {
      const nextRewardBalance = Number(dbTotalBMT) || 0;
      setRewardBalance(nextRewardBalance);
      setBmtBalance(walletTokenBalance !== null ? walletTokenBalance : nextRewardBalance);
    }
  }, [dbTotalBMT, isConnected, user?.publicKey, walletTokenBalance]);

  const refreshWalletBalance = useCallback(async () => {
    const owner = user?.publicKey;
    if (!owner || refreshInFlightRef.current) return;

    refreshInFlightRef.current = true;
    setBalLoading(previousWalletBalanceRef.current === null);
    setBalError(null);

    try {
      const nextWalletBalance = await fetchWalletTokenBalance(owner, tokenMint);
      const previousWalletBalance = previousWalletBalanceRef.current;
      previousWalletBalanceRef.current = nextWalletBalance;
      setWalletTokenBalance(nextWalletBalance);
      setBmtBalance(nextWalletBalance);

      if (previousWalletBalance !== null && nextWalletBalance > previousWalletBalance + 0.000001) {
        if (airdropTimeoutRef.current) clearTimeout(airdropTimeoutRef.current);
        setAirdrop({ amount: nextWalletBalance - previousWalletBalance, key: Date.now() });
        airdropTimeoutRef.current = setTimeout(() => setAirdrop(null), 3200);
      }
    } catch (error) {
      console.warn('[BMT] Failed to refresh wallet token balance:', error);
      setBalError(error instanceof Error ? error.message : 'Failed to load balance');
    } finally {
      setBalLoading(false);
      refreshInFlightRef.current = false;
    }
  }, [tokenMint, user?.publicKey]);

  useEffect(() => {
    if (!user?.publicKey) {
      previousWalletBalanceRef.current = null;
      balanceOwnerRef.current = null;
      setWalletTokenBalance(null);
      setBmtBalance(null);
      return;
    }

    if (balanceOwnerRef.current !== user.publicKey) {
      balanceOwnerRef.current = user.publicKey;
      previousWalletBalanceRef.current = null;
      setWalletTokenBalance(null);
      setAirdrop(null);
    }

    void refreshWalletBalance();
  }, [refreshWalletBalance, user?.publicKey]);

  useEffect(() => {
    const owner = user?.publicKey;
    if (!isConnected || !owner) return;

    let rewardRefreshTimer: number | null = null;
    const stop = subscribeToRewardEvents((event) => {
      if (event.type === 'rewards-distributed') {
        if (rewardRefreshTimer !== null) window.clearTimeout(rewardRefreshTimer);
        rewardRefreshTimer = window.setTimeout(() => {
          rewardRefreshTimer = null;
          void authService.fetchMiningStats(owner).finally(notifyRewardsDistributed);
        }, 150);
        return;
      }

      notifyPayoutCompleted();
      void Promise.allSettled([
        authService.fetchMiningStats(owner),
        refreshWalletBalance()
      ]);
    });

    return () => {
      stop();
      if (rewardRefreshTimer !== null) window.clearTimeout(rewardRefreshTimer);
    };
  }, [authService, isConnected, refreshWalletBalance, user?.publicKey]);

  useEffect(() => () => {
    if (airdropTimeoutRef.current) clearTimeout(airdropTimeoutRef.current);
  }, []);

  const isDark = theme === 'dark';
  const btnGradient = isDark
    ? 'bg-gradient-to-r from-amber-200/15 to-yellow-100/10 text-zinc-200'
    : 'bg-gradient-to-r from-yellow-700 to-yellow-400 text-black';
  const btnHover = isDark
    ? 'hover:from-amber-200/25 hover:to-yellow-100/20'
    : 'hover:from-yellow-800 hover:to-yellow-500';
  const btnShadow = isDark ? 'shadow-none' : 'shadow-lg shadow-yellow-600/20';
  const btnBorder = isDark ? 'border border-amber-200/20' : 'border border-yellow-600/30';

  useEffect(() => {
    const loadUser = async () => {
      const stored = authService.loadUserFromStorage();
      if (stored) {
        const stillConnected = await authService.verifyConnection();
        if (!stillConnected) {
          useSolanaAuth.getState().disconnect();
          return;
        }
        const [statsResult, premiumResult] = await Promise.allSettled([
          authService.fetchMiningStats(stored.publicKey),
          authService.loadPremiumStatusOnStartup()
        ]);
        authService.scheduleTokenRefresh();
        if (statsResult.status === 'rejected') {
          console.warn('[SolanaAuthButton] Failed to refresh restored wallet stats:', statsResult.reason);
        }
        if (premiumResult.status === 'rejected') {
          console.warn('[SolanaAuthButton] Failed to load startup premium status:', premiumResult.reason);
        }
      }
    };

    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop restores the session via the backend; the browser build must react to
  // the injected wallet switching accounts or disconnecting, otherwise mining
  // reports and rewards would be attributed to the previous wallet.
  useEffect(() => {
    if ((window as any).__TAURI_INTERNALS__) return;
    const provider =
      (window as any).phantom?.solana ||
      (window as any).solflare ||
      (window as any).backpack ||
      (window as any).glow ||
      (window as any).solana;
    if (!provider?.on) return;

    const invalidateSession = () => {
      authStorage.removeToken();
      authService.stopTokenRefresh();
      useSolanaAuth.getState().setSessionExpired(true);
      useSolanaAuth.getState().disconnect();
    };

    provider.on('accountChanged', invalidateSession);
    provider.on('disconnect', invalidateSession);
    return () => {
      provider.off?.('accountChanged', invalidateSession);
      provider.off?.('disconnect', invalidateSession);
    };
  }, [authService]);

  const handleConnect = async () => {
    try {
      setError(null);
      useSolanaAuth.getState().setConnecting(true);
      await authService.connectWallet();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    } finally {
      useSolanaAuth.getState().setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setError(null);
      if (isMiningLocked) {
        setError('Stop mining before disconnecting wallet');
        return;
      }
      await authService.disconnectWallet();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect wallet');
    }
  };

  if (isConnected && user) {
    return (
      <div className="flex flex-col gap-1.5">
      {sessionExpired && (
        <div className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs border',
          isDark
            ? 'bg-orange-500/10 border-orange-500/30 text-orange-300'
            : 'bg-orange-100 border-orange-400/40 text-orange-700'
        )}>
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1">Session expired — reconnect to refresh stats</span>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className={cn(
              'font-semibold underline underline-offset-2 hover:no-underline transition cursor-pointer',
              isDark ? 'text-orange-200' : 'text-orange-700'
            )}
          >
            {isConnecting ? 'Connecting…' : 'Reconnect'}
          </button>
        </div>
      )}
      <div className={cn(
        'relative flex items-center gap-2 xl:gap-3 px-3 xl:px-4 py-2 rounded-lg border',
        isDark ? 'bg-amber-200/10 border-amber-200/20' : 'bg-yellow-400/10 border-yellow-400/30'
      )}>
        {airdrop ? <WalletAirdrop amount={airdrop.amount} animationKey={airdrop.key} /> : null}
        <CheckCircle className={cn('w-4 h-4 flex-shrink-0', isDark ? 'text-amber-200' : 'text-yellow-500')} />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <code
            className={cn('text-[10px] font-mono truncate', isDark ? 'text-amber-200/80' : 'text-yellow-700/80')}
            title={user.publicKey}
          >
            {user.publicKey}
          </code>
          {walletTokenBalance !== null && rewardBalance > 0 && Math.abs(walletTokenBalance - rewardBalance) > 0.000001 && (
            <div className={cn('text-[10px]', isDark ? 'text-amber-200/60' : 'text-yellow-700/60')}>
              rewards {rewardBalance.toFixed(4)} BMT
            </div>
          )}
          <div className={cn('text-xs font-mono', isDark ? 'text-amber-200/90' : 'text-yellow-700')}>
            {balLoading ? 'Loading…' : (bmtBalance !== null ? `${bmtBalance.toFixed(4)} BMT` : (balError ? '—' : '0.0000 BMT'))}
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={isMiningLocked}
          className={cn(
            'ml-auto p-1.5 rounded hover:bg-red-500/20 transition cursor-pointer',
            isDark ? 'text-amber-200' : 'text-yellow-600',
            'hover:text-red-400',
            isMiningLocked && 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-current'
          )}
          title={isMiningLocked ? 'Stop mining before disconnecting wallet' : 'Disconnect wallet'}
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleConnect}
        disabled={isConnecting}
        className={cn(
          'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-semibold transition cursor-pointer',
          btnGradient,
          btnHover,
          btnShadow,
          btnBorder,
          'tracking-wide',
          isConnecting && 'opacity-50 cursor-not-allowed'
        )}
      >
        {isConnecting ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <Wallet className="w-4 h-4" />
        )}
        {isConnecting ? 'Connecting...' : 'Connect Wallet'}
      </button>

      {error && (
        <div className={cn(
          'flex gap-2 p-3 rounded-lg text-sm',
          'bg-red-500/10 text-red-300 border border-red-500/30'
        )}>
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <p className="text-xs text-center text-zinc-500 font-mono">
        connect solana wallet to track and receive mining rewards
      </p>
    </div>
  );
};
