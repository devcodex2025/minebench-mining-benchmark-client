import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Info, Settings as SettingsIcon, CheckCircle, Lock, ExternalLink } from '../components/icons';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';
import { useMinerStore } from '../store/useMinerStore';
import { useEnvironment } from '../hooks/useEnvironment';
import { nativeApi } from '../lib/native-api';
import { getAppUpdateStatus, getInitialAppUpdateStatus, RELEASES_URL } from '../services/appUpdate';

export const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartSupported, setAutoStartSupported] = useState(true);
  const [autoStartLoading, setAutoStartLoading] = useState(false);
  const isNative = (window as any).__TAURI_INTERNALS__;
  const autoStartDisabled = autoStartLoading || !autoStartSupported || !isNative;
  const [updateStatus, setUpdateStatus] = useState(getInitialAppUpdateStatus);

  const openExternal = useCallback(async (url: string) => {
    try {
      if (isNative) {
        await nativeApi.openExternal(url);
        return;
      }
    } catch (err) {
      console.warn('[Settings] openExternal failed, falling back to window.open:', err);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [isNative]);

  const cardClass = cn(
    'rounded-lg p-6 space-y-4',
    theme === 'light'
      ? 'bg-white border border-zinc-200'
      : 'bg-zinc-900/50 backdrop-blur-xl border border-white/5'
  );

  const labelClass = cn(
    'text-xs font-bold uppercase tracking-widest',
    theme === 'light' ? 'text-zinc-600' : 'text-zinc-600'
  );

  const textClass = cn(
    'text-sm',
    theme === 'light' ? 'text-zinc-700' : 'text-zinc-400'
  );

  const subLabelClass = cn(
    'text-xs',
    theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
  );

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    const status = await getAppUpdateStatus();
    setUpdateStatus(status);
    setUpdateAvailable(status.updateAvailable);
    setUpdateChecked(true);
    setCheckingUpdates(false);
  };

  const handleDownloadUpdate = () => {
    openExternal(RELEASES_URL);
  };

  const refreshAutoStart = useCallback(async () => {
    if (!isNative) return;
    setAutoStartLoading(true);
    try {
      const enabled = await nativeApi.system.getAutoStart();
      setAutoStart(!!enabled);
      setAutoStartSupported(true);
    } catch (err) {
      console.error('get-auto-start failed', err);
      setAutoStartSupported(false);
    } finally {
      setAutoStartLoading(false);
    }
  }, [isNative]);

  const toggleAutoStart = async () => {
    if (!isNative || autoStartLoading) return;
    const next = !autoStart;
    setAutoStart(next);
    setAutoStartLoading(true);
    try {
      await nativeApi.system.setAutoStart(next);
      setAutoStartSupported(true);
    } catch (err) {
      console.error('set-auto-start failed', err);
      setAutoStart(!next);
    } finally {
      setAutoStartLoading(false);
    }
  };

  useEffect(() => {
    refreshAutoStart();
  }, [refreshAutoStart]);

  useEffect(() => {
    let active = true;

    getAppUpdateStatus().then((status) => {
      if (active) setUpdateStatus(status);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className={cn("text-3xl font-light", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Settings</h1>
      </div>

      {/* Version Information */}
      <div className={cardClass}>
        <div className="flex items-start gap-3">
          <Info size={20} className="text-yellow-400 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h2 className={cn("text-lg font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Application Version</h2>
            <p className={cn("mt-1", textClass)}>Current version: <span className="text-yellow-400 font-mono font-bold">v{updateStatus.currentVersion}</span></p>
            {updateStatus.updateAvailable && (
              <p className={cn("mt-1 text-xs", theme === 'light' ? 'text-yellow-700' : 'text-yellow-400')}>
                Update required: v{updateStatus.latestVersion} is available.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Other Settings */}
      <div className={cardClass}>
        <div className="flex items-start gap-3 mb-4">
          <SettingsIcon size={20} className="text-blue-400 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h2 className={cn("text-lg font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Preferences</h2>
            <p className={cn("mt-1", textClass)}>Configure application settings</p>
          </div>
        </div>

        <div className="space-y-3 ml-8">
          {/* Theme Setting */}
          <div className={cn("flex items-center justify-between p-3 rounded border",
            theme === 'light'
              ? 'bg-white border-zinc-200'
              : 'bg-zinc-800/50 border-white/5'
          )}>
            <div>
              <p className={cn("text-sm font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Dark Mode</p>
              <p className={cn("text-xs mt-0.5", theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>Enable dark theme</p>
            </div>
            <button
              onClick={toggleTheme}
              className={`w-12 h-6 rounded-full flex items-center px-1 transition-colors cursor-pointer ${theme === 'dark' ? 'bg-emerald-500' : 'bg-zinc-600'
                }`}
            >
              <div className={`w-5 h-5 bg-white rounded-full transition-transform ${theme === 'dark' ? 'ml-auto' : ''
                }`}></div>
            </button>
          </div>

          {/* Auto Start Setting */}
          <div className={cn("flex items-center justify-between p-3 rounded border",
            theme === 'light'
              ? 'bg-white border-zinc-200'
              : 'bg-zinc-800/50 border-white/5'
          )}>
            <div>
              <p className={cn("text-sm font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Auto-Start on Boot</p>
              <p className={cn("text-xs mt-0.5", theme === 'light' ? 'text-zinc-600' : 'text-zinc-400')}>
                {autoStartSupported ? 'Launch MineBench automatically' : 'Auto-start not available on this OS'}
              </p>
            </div>
            <button
              onClick={toggleAutoStart}
              disabled={autoStartDisabled}
              className={cn(
                "w-12 h-6 rounded-full flex items-center px-1 transition-colors",
                autoStartDisabled ? 'opacity-50 cursor-not-allowed bg-zinc-400/50' : 'cursor-pointer',
                autoStart ? 'bg-emerald-500' : 'bg-zinc-600'
              )}
            >
              <div className={`w-5 h-5 bg-white rounded-full transition-transform ${autoStart ? 'ml-auto' : ''
                }`}></div>
            </button>
          </div>
        </div>
      </div>

      {/* Mining Configuration */}
      <div className={cardClass}>
        <div className="flex items-start gap-3 mb-4">
          <SettingsIcon size={20} className="text-yellow-400 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <h2 className={cn("text-lg font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Mining Configuration</h2>
            <p className={cn("mt-1", textClass)}>Set your wallet and preferred pool</p>
          </div>
        </div>

        <MiningConfigForm theme={theme} />
      </div>

      {/* About Section */}
      <div className={cardClass}>
        <h2 className={cn("text-lg font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>About MineBench</h2>

        <div className={cn("space-y-2 text-sm", theme === 'light' ? 'text-zinc-700' : 'text-zinc-400')}>
          <p>
            MineBench is a decentralized mining benchmark platform designed to provide accurate and real-time performance metrics for cryptocurrency mining operations.
          </p>

          <div className="pt-4 space-y-2 text-xs">
            <p><span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>License:</span> MIT</p>
            <p>
              <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Website:</span>{' '}
              <button
                type="button"
                className="text-blue-400 hover:underline cursor-pointer"
                onClick={() => openExternal('https://minebench.cloud')}
              >
                minebench.cloud
              </button>{' '}
              - Benchmark results, latest releases, and downloads.
            </p>
            <p>
              <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Discord:</span>{' '}
              <button
                type="button"
                className="text-blue-400 hover:underline cursor-pointer"
                onClick={() => openExternal('https://discord.gg/vsDyYh4rma')}
              >
                discord.gg/vsDyYh4rma
              </button>{' '}
              - Join the community for support, updates, and technical guidance.
            </p>
            <p>
              <span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Twitter/X:</span>{' '}
              <button
                type="button"
                className="text-blue-400 hover:underline cursor-pointer"
                onClick={() => openExternal('https://x.com/MineBenchdapp')}
              >
                x.com/MineBenchdapp
              </button>{' '}
              - Official product news and release updates.
            </p>
            <p><span className={theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'}>Platform Support:</span> Windows, macOS, Linux (with Wayland support)</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Simple Monero wallet validation: starts with 4 or 8 and ~95 characters
const validateXmrWallet = (addr: string) => {
  const trimmed = addr.trim();
  if (!trimmed) return { ok: false, reason: 'Wallet is required' };
  if (!(trimmed.startsWith('4') || trimmed.startsWith('8'))) return { ok: false, reason: 'Must start with 4 or 8' };
  if (trimmed.length < 90 || trimmed.length > 110) return { ok: false, reason: 'Unexpected length' };
  return { ok: true };
};

const MiningConfigForm: React.FC<{ theme: 'light' | 'dark' }> = ({ theme }) => {
  const isNative = (window as any).__TAURI_INTERNALS__;
  const env = useEnvironment();
  const wallet = useMinerStore((s) => s.wallet);
  const poolUrl = useMinerStore((s) => s.poolUrl);
  const backendPoolEndpoints = useMinerStore((s) => s.backendPoolEndpoints);
  const donateLevel = useMinerStore((s) => s.donateLevel);
  const isPremium = useMinerStore((s) => s.isPremium);
  
  const setWallet = useMinerStore((s) => s.setWallet);
  const setPoolUrl = useMinerStore((s) => s.setPoolUrl);
  const setDonateLevel = useMinerStore((s) => s.setDonateLevel);
  const setManualPoolSelection = useMinerStore((s) => s.setManualPoolSelection);

  const [localWallet, setLocalWallet] = useState(wallet);
  const [localPool, setLocalPool] = useState(poolUrl);
  const [localDonate, setLocalDonate] = useState(donateLevel);
  const [saving, setSaving] = useState(false);
  const validation = useMemo(() => validateXmrWallet(localWallet), [localWallet]);

  const openExternal = useCallback(async (url: string) => {
    if (isNative) {
      await nativeApi.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }, [isNative]);

  // Local label style
  const labelClass = cn(
    'text-xs font-bold uppercase tracking-widest',
    theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
  );

  const backendPresetPools = backendPoolEndpoints.map((endpoint) => ({
    name: endpoint.label,
    url: endpoint.url
  }));
  const presetPools = [
    ...(backendPresetPools.length > 0 ? backendPresetPools : [{ name: 'MineBench Pool (Primary)', url: env.poolStratumUrl }]),
    { name: 'SupportXMR', url: 'pool.supportxmr.com:3333' },
    { name: 'MoneroOcean', url: 'gulf.moneroocean.stream:10032' },
  ];

  const save = async () => {
    if (!validation.ok || !isPremium) return;
    setSaving(true);
    try {
      setWallet(localWallet.trim());
      setPoolUrl(localPool.trim());
      setDonateLevel(Math.max(0, Math.min(5, Math.round(localDonate))));
      setManualPoolSelection(true); // Enable manual override
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 ml-8">
      {/* Premium Lock Overlay for Wallet */}
      {!isPremium && (
        <div className={cn(
          "p-4 rounded-xl border flex flex-col items-center text-center gap-3",
          theme === 'light' ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/10 border-amber-500/20'
        )}>
          <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
            <Lock size={20} className="text-amber-500" />
          </div>
          <div>
            <p className={cn("text-xs font-black uppercase tracking-[0.2em]", theme === 'light' ? 'text-amber-900' : 'text-amber-400')}>Premium Feature</p>
            <p className={cn("text-xs mt-1 font-medium", theme === 'light' ? 'text-amber-800' : 'text-amber-200/50')}>
              Custom Monero wallet support requires a Premium License ($29/year).
            </p>
          </div>
          <button
            onClick={() => openExternal('https://minebench.cloud/premium')}
            className={cn(
               "flex items-center gap-2 px-6 py-2 rounded-full text-[10px] font-bold transition-all transform hover:scale-102 cursor-pointer shadow-lg active:scale-95",
               theme === 'light' 
                ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-zinc-950/20"
                : "bg-amber-500 text-black hover:bg-amber-400 shadow-amber-500/20"
            )}
          >
            UPGRADE TO PREMIUM <ExternalLink size={10} />
          </button>
        </div>
      )}

      {/* Wallet */}
      <div className={cn(
        "p-4 rounded-xl border relative overflow-hidden group",
        theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/40 border-white/5'
      )}>
        <label className={labelClass}>Wallet Address (XMR)</label>
        <div className="relative mt-2">
          <input
            value={localWallet}
            onChange={(e) => setLocalWallet(e.target.value)}
            placeholder="Enter your Monero wallet"
            disabled={!isPremium}
            className={cn(
              'w-full px-4 py-3 rounded-lg border text-sm outline-none transition-all',
              theme === 'light' 
                ? 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-emerald-500/50' 
                : 'bg-zinc-950/50 border-white/10 text-white focus:border-emerald-500/30',
              !isPremium && "cursor-not-allowed grayscale"
            )}
          />
        </div>

        {/* Central Lock Overlay */}
        {!isPremium && (
          <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[1px] flex items-center justify-center z-10 transition-all group-hover:bg-zinc-950/60">
             <div className="p-3 bg-zinc-900/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center gap-1 scale-90 group-hover:scale-100 transition-transform">
                <Lock size={20} className="text-amber-500" />
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Locked</span>
             </div>
          </div>
        )}

        {isPremium && !validation.ok && (
          <div className={cn('mt-2 text-xs', theme === 'light' ? 'text-red-600' : 'text-red-400')}>{validation.reason}</div>
        )}
      </div>

      {/* Pool Selection */}
      <div className={cn(
        "p-4 rounded-xl border relative overflow-hidden group",
        theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/40 border-white/5'
      )}>
        <div className="flex items-center justify-between mb-3">
          <label className={labelClass}>Mining Pool</label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {presetPools.map((p) => (
            <button
              key={p.url}
              onClick={() => isPremium && setLocalPool(p.url)}
              disabled={!isPremium}
              className={cn(
                'px-4 py-3 rounded-lg border text-sm text-center transition-all',
                localPool === p.url
                  ? theme === 'light' ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/5'
                  : theme === 'light' ? 'bg-zinc-50 border-zinc-200 text-zinc-800' : 'bg-zinc-950/50 border-white/10 text-white',
                !isPremium && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="font-bold text-xs uppercase tracking-tight">{p.name}</div>
              <div className="text-[10px] opacity-60 font-mono mt-0.5">{p.url}</div>
            </button>
          ))}
        </div>
        <input
          value={localPool}
          onChange={(e) => setLocalPool(e.target.value)}
          placeholder="host:port (e.g., xmr-us.minebench.cloud:3333)"
          disabled={!isPremium}
          className={cn(
            'mt-3 w-full px-4 py-3 rounded-lg border text-sm outline-none transition-all font-mono',
            theme === 'light' 
              ? 'bg-zinc-50 border-zinc-200 text-zinc-900 focus:border-emerald-500/50' 
              : 'bg-zinc-950/50 border-white/10 text-white focus:border-emerald-500/30',
            !isPremium && "cursor-not-allowed grayscale"
          )}
        />

        {/* Central Lock Overlay */}
        {!isPremium && (
          <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[1px] flex items-center justify-center z-10 transition-all group-hover:bg-zinc-950/60">
             <div className="p-3 bg-zinc-900/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col items-center gap-1 scale-90 group-hover:scale-100 transition-transform">
                <Lock size={20} className="text-amber-500" />
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">Locked</span>
             </div>
          </div>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving || !validation.ok || !isPremium}
          className={cn(
            'px-8 py-3 rounded-xl border text-[10px] font-black uppercase tracking-widest transition-all shadow-md active:scale-95',
            (saving || !isPremium) ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer hover:shadow-emerald-500/20 hover:-translate-y-0.5',
            theme === 'light' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-500 text-black border-emerald-500'
          )}
        >
          {isPremium ? 'Save Configuration' : 'Premium Only'}
        </button>
        <div className={cn('text-[10px] self-center uppercase tracking-widest font-bold opacity-30', theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>Changes apply on next start.</div>
      </div>
    </div>
  );
};
