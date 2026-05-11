import React, { useEffect, useState } from 'react';
import { Wallet, LogOut, Loader, AlertCircle, CheckCircle } from './icons';
import { useSolanaAuth, SolanaAuthService } from '../services/solanaAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useWalletAuthUrl } from '../hooks/useEnvironment';
import { getEnvironmentConfig } from '../config/environment';
import { cn } from '../lib/utils';
import { useMinerStore } from '../store/useMinerStore';

export const SolanaAuthButton: React.FC = () => {
  const { theme } = useTheme();
  const { user, isConnected, isConnecting } = useSolanaAuth();
  const [error, setError] = useState<string | null>(null);
  const [bmtBalance, setBmtBalance] = useState<number | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  const [balError, setBalError] = useState<string | null>(null);
  const [rewardBalance, setRewardBalance] = useState(0);
  const [walletTokenBalance, setWalletTokenBalance] = useState<number | null>(null);
  const tokenMint = getEnvironmentConfig().bmtTokenMint;
  const authService = SolanaAuthService.getInstance();
  const dbTotalBMT = useMinerStore(state => state.dbTotalBMT);

  useEffect(() => {
    if (isConnected && user?.publicKey && Number.isFinite(dbTotalBMT)) {
      const nextRewardBalance = Number(dbTotalBMT) || 0;
      setRewardBalance(nextRewardBalance);
      setBmtBalance(walletTokenBalance !== null ? walletTokenBalance : nextRewardBalance);
    }
  }, [dbTotalBMT, isConnected, user?.publicKey, walletTokenBalance]);

  // Fetch SPL token balance for BMT mint on Solana mainnet
  useEffect(() => {
    const fetchBalance = async () => {
      if (!user?.publicKey) return;
      try {
        setBalLoading(true);
        setBalError(null);

        try {
          const stats = await authService.fetchMiningStats(user.publicKey);
          const nextRewardBalance = Number.isFinite(stats.totalRewards) ? stats.totalRewards : 0;
          setRewardBalance(nextRewardBalance);
          setBmtBalance(nextRewardBalance);
        } catch (e: any) {
          console.warn('[BMT] DB reward balance failed, falling back to token balance:', e?.message);
        }

        const owner = user.publicKey;
        let resolved = false;

        // Prefer Electron IPC proxy (no CORS, fewer 403s)
        const ipc = (window as any)?.electron?.ipcRenderer;
        if (ipc?.invoke) {
          try {
            const res = await ipc.invoke('solana-get-token-balance', { owner, mint: tokenMint });
            if (res?.success) {
              const val = typeof res.balance === 'number' ? res.balance : Number(res.balance || 0);
              const nextTokenBalance = isFinite(val) ? val : 0;
              setWalletTokenBalance(nextTokenBalance);
              setBmtBalance(nextTokenBalance);
              resolved = true;
            } else if (res?.error) {
              console.warn('[BMT] IPC balance error:', res.error);
            }
          } catch (e: any) {
            console.warn('[BMT] IPC balance exception:', e?.message);
          }
        }

        if (!resolved) {
          // Fallback: direct RPC (may hit CORS/provider 403 in renderer)
          const endpoints = [
            'https://api.mainnet-beta.solana.com',
            'https://rpc.ankr.com/solana'
          ];
          const TOKEN_PROGRAMS = [
            'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
          ];
          const rpc = async (url: string, body: any) => {
            const res = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!res.ok) throw new Error(`RPC ${res.status}`);
            return res.json();
          };
          let total = 0;
          let found = false;
          for (const url of endpoints) {
            try {
              const body = { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { mint: tokenMint }, { encoding: 'jsonParsed' }] };
              const json = await rpc(url, body);
              const list = json?.result?.value ?? [];
              if (list.length > 0) {
                for (const acc of list) {
                  const amt = acc?.account?.data?.parsed?.info?.tokenAmount;
                  if (amt && typeof amt.uiAmount === 'number') total += amt.uiAmount;
                  else if (amt?.uiAmountString) total += Number(amt.uiAmountString);
                }
                found = true;
                break;
              }
            } catch {}
          }
          if (!found) {
            for (const url of endpoints) {
              for (const programId of TOKEN_PROGRAMS) {
                try {
                  const body = { jsonrpc: '2.0', id: 1, method: 'getTokenAccountsByOwner', params: [owner, { programId }, { encoding: 'jsonParsed' }] };
                  const json = await rpc(url, body);
                  const list = json?.result?.value ?? [];
                  for (const acc of list) {
                    const info = acc?.account?.data?.parsed?.info;
                    if (info?.mint === tokenMint) {
                      const amt = info?.tokenAmount;
                      if (amt && typeof amt.uiAmount === 'number') total += amt.uiAmount;
                      else if (amt?.uiAmountString) total += Number(amt.uiAmountString);
                    }
                  }
                  if (total > 0) { found = true; break; }
                } catch {}
              }
              if (found) break;
            }
          }
          setWalletTokenBalance(total);
          setBmtBalance(total);
        }
      } catch (e: any) {
        setBalError(e?.message || 'Failed to load balance');
        setBmtBalance(null);
      } finally {
        setBalLoading(false);
      }
    };
    fetchBalance();
  }, [user?.publicKey, tokenMint]);

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
        }
      }
    };

    loadUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConnect = async () => {
    try {
      setError(null);
      useSolanaAuth.getState().setConnecting(true);
      await authService.connectWallet();
    } catch (err: any) {
      setError(err.message);
    } finally {
      useSolanaAuth.getState().setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setError(null);
      await authService.disconnectWallet();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (isConnected && user) {
    return (
      <div className={cn(
        'flex items-center gap-3 px-4 py-2 rounded-lg border',
        isDark ? 'bg-amber-200/10 border-amber-200/20' : 'bg-yellow-400/10 border-yellow-400/30'
      )}>
        <CheckCircle className={cn('w-4 h-4 flex-shrink-0', isDark ? 'text-amber-200' : 'text-yellow-500')} />
        <div className="flex flex-col gap-0.5 min-w-0">
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
          className={cn(
            'ml-auto p-1.5 rounded hover:bg-red-500/20 transition cursor-pointer',
            isDark ? 'text-amber-200' : 'text-yellow-600',
            'hover:text-red-400'
          )}
          title="Disconnect wallet"
        >
          <LogOut className="w-4 h-4" />
        </button>
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
