import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, RefreshCw, Info, Settings as SettingsIcon, Lock, ExternalLink, Cpu, Shield } from '../components/icons';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';
import {
  formatClockGhz,
  formatPercent,
  formatRpm,
  formatTemperature,
  formatWatts,
} from '../lib/cpu-telemetry';
import type { CpuTelemetryDebug, CpuSensorBrokerStatus, CpuSensorBrokerSnapshot, CpuSensorBrokerDiagnostic } from '../lib/cpu-telemetry';
import { useMinerStore } from '../store/useMinerStore';
import { useEnvironment } from '../hooks/useEnvironment';
import { nativeApi } from '../lib/native-api';
import { getAppUpdateStatus, getInitialAppUpdateStatus, installAppUpdate, RELEASES_URL } from '../services/appUpdate';
import {
  getInitialXmrigVersionInfo,
  getXmrigVersionPresentation,
} from '../services/xmrigVersion';

export const Settings = () => {
  const { theme, toggleTheme } = useTheme();
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [checkingXmrig, setCheckingXmrig] = useState(false);
  const [xmrigVersion, setXmrigVersion] = useState(getInitialXmrigVersionInfo);
  const [autoStart, setAutoStart] = useState(false);
  const [autoStartSupported, setAutoStartSupported] = useState(true);
  const [autoStartLoading, setAutoStartLoading] = useState(false);
  const isNative = (window as any).__TAURI_INTERNALS__;
  const autoStartDisabled = autoStartLoading || !autoStartSupported || !isNative;
  const [updateStatus, setUpdateStatus] = useState(getInitialAppUpdateStatus);
  const xmrigPresentation = useMemo(
    () => getXmrigVersionPresentation(xmrigVersion),
    [xmrigVersion]
  );

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

  const refreshXmrigVersion = useCallback(async () => {
    if (!isNative) return;
    setCheckingXmrig(true);
    try {
      setXmrigVersion(await nativeApi.miner.getVersionInfo());
    } catch (err) {
      setXmrigVersion((current) => ({
        ...current,
        error: err instanceof Error ? err.message : 'Failed to detect XMRig version',
      }));
    } finally {
      setCheckingXmrig(false);
    }
  }, [isNative]);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    const [status] = await Promise.all([
      getAppUpdateStatus(),
      refreshXmrigVersion(),
    ]);
    setUpdateStatus(status);
    setUpdateChecked(true);
    setCheckingUpdates(false);
  };

  const handleDownloadUpdate = async () => {
    if (!updateStatus.canInstall) {
      await openExternal(RELEASES_URL);
      return;
    }

    setInstallingUpdate(true);
    setUpdateProgress(0);
    let downloaded = 0;
    let total = 0;
    try {
      await installAppUpdate((event) => {
        if (event.event === 'Started') total = event.data.contentLength || 0;
        if (event.event === 'Progress') downloaded += event.data.chunkLength;
        if (event.event === 'Finished') setUpdateProgress(100);
        else if (total > 0) setUpdateProgress(Math.min(99, Math.round((downloaded / total) * 100)));
      });
    } catch (err) {
      setUpdateStatus((current) => ({
        ...current,
        error: err instanceof Error ? err.message : 'Failed to install update',
      }));
      setInstallingUpdate(false);
      setUpdateProgress(null);
    }
  };

  const handleXmrigUpdate = () => {
    openExternal(xmrigVersion.releaseUrl);
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
    refreshXmrigVersion();
  }, [refreshXmrigVersion]);

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
            <h2 className={cn("text-lg font-semibold", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Runtime Versions</h2>
            <p className={cn("mt-1", textClass)}>Installed application and mining engine</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className={cn(
            "rounded-lg border p-4",
            theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10'
          )}>
            <div className="flex items-center justify-between gap-3">
              <span className={labelClass}>MineBench Client</span>
              <span className="font-mono text-sm font-bold text-yellow-400">v{updateStatus.currentVersion}</span>
            </div>
            <p className={cn("mt-2 min-h-4", subLabelClass)}>
              {updateStatus.updateAvailable
                  ? `v${updateStatus.latestVersion} available`
                : updateStatus.error
                  ? 'Latest-version check unavailable'
                  : updateChecked
                    ? 'Latest installed'
                    : 'Ready to check'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCheckUpdates}
                disabled={checkingUpdates}
                className={cn(
                  "inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold transition-colors",
                  theme === 'light'
                    ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10',
                  checkingUpdates && 'cursor-wait opacity-60'
                )}
              >
                <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
                Check updates
              </button>
              {updateStatus.updateAvailable && (
                <button
                  type="button"
                  onClick={handleDownloadUpdate}
                  disabled={installingUpdate}
                  className="inline-flex items-center gap-2 rounded bg-yellow-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-yellow-300"
                >
                  <Download size={14} className={installingUpdate ? 'animate-pulse' : ''} />
                  {installingUpdate
                    ? `Updating${updateProgress !== null ? ` ${updateProgress}%` : '…'}`
                    : updateStatus.canInstall
                      ? `Install v${updateStatus.latestVersion}`
                      : `Get v${updateStatus.latestVersion}`}
                </button>
              )}
            </div>
          </div>

          <div className={cn(
            "rounded-lg border p-4",
            theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10'
          )}>
            <div className="flex items-center justify-between gap-3">
              <span className={labelClass}>XMRig Engine</span>
              <span
                data-testid="xmrig-current-version"
                className="font-mono text-sm font-bold text-emerald-400"
              >
                {xmrigPresentation.currentLabel}
              </span>
            </div>
            <p className={cn("mt-2 min-h-4", subLabelClass)}>
              {xmrigPresentation.statusLabel}
              {xmrigVersion.platform ? ` · ${xmrigVersion.platform}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={refreshXmrigVersion}
                disabled={!isNative || checkingXmrig}
                className={cn(
                  "inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold transition-colors",
                  theme === 'light'
                    ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10',
                  (!isNative || checkingXmrig) && 'cursor-not-allowed opacity-60'
                )}
              >
                <RefreshCw size={14} className={checkingXmrig ? 'animate-spin' : ''} />
                Check engine
              </button>
              {xmrigPresentation.showUpdateAction && (
                <button
                  type="button"
                  data-testid="xmrig-update-button"
                  onClick={handleXmrigUpdate}
                  className="inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-emerald-300"
                >
                  <ExternalLink size={14} />
                  {xmrigPresentation.updateActionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CPU sensor diagnostics. Windows has no generic CPU die temperature API,
          so this exists to explain on any given PC which provider was found and
          which sensors are missing. */}
      <CpuSensorDiagnostics theme={theme} isNative={!!isNative} />

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
/**
 * CPU sensor diagnostics.
 *
 * Hardware monitoring varies wildly between PCs, so this reports the detected
 * CPU, the active telemetry provider, every raw sensor the provider exposes,
 * and the normalized values MineBench derived from them. The JSON export is what
 * a user sends us when a sensor cannot be detected on their machine.
 *
 * Only hardware identifiers are included; no wallet or account data is read.
 */
const CpuSensorDiagnostics: React.FC<{ theme: 'light' | 'dark'; isNative: boolean }> = ({ theme, isNative }) => {
  const [debug, setDebug] = useState<CpuTelemetryDebug | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSensors, setShowSensors] = useState(false);
  const [broker, setBroker] = useState<CpuSensorBrokerStatus | null>(null);
  const [brokerReading, setBrokerReading] = useState<CpuSensorBrokerSnapshot | null>(null);
  const [brokerDiagnostic, setBrokerDiagnostic] = useState<CpuSensorBrokerDiagnostic | null>(null);
  const [brokerBusy, setBrokerBusy] = useState(false);
  const [brokerMessage, setBrokerMessage] = useState<string | null>(null);

  const cardClass = cn(
    'rounded-xl border p-5 space-y-4',
    theme === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900/60 border-white/10'
  );
  const textClass = cn('text-sm', theme === 'light' ? 'text-zinc-600' : 'text-zinc-400');

  const refreshBrokerStatus = useCallback(async () => {
    if (!isNative) return;
    try {
      setBroker(await nativeApi.system.getCpuSensorBrokerStatus());
    } catch {
      // Diagnostics must not fail just because the broker status is unreadable.
    }
  }, [isNative]);

  /**
   * Asks the privileged broker for a reading.
   *
   * The broker is started by a scheduled task the installer registered, so this
   * never raises an approval prompt. When the task is absent the call simply
   * returns no snapshot, which is a normal state rather than an error.
   */
  const requestBrokerReading = useCallback(async () => {
    setBrokerBusy(true);
    setBrokerMessage(null);
    try {
      const result = await nativeApi.system.readCpuSensorBroker();
      if (result?.snapshot) {
        setBrokerReading(result.snapshot);
        setBrokerMessage(null);
      } else {
        setBrokerReading(null);
        setBrokerMessage(
          'The sensor broker returned no reading. Check the detail above; the installer must register its scheduled task.'
        );
      }
      await refreshBrokerStatus();
    } catch (err: any) {
      setBrokerMessage(err?.message ?? String(err));
    } finally {
      setBrokerBusy(false);
    }
  }, [refreshBrokerStatus]);

  useEffect(() => {
    void refreshBrokerStatus();
  }, [refreshBrokerStatus]);

  /**
   * Runs the full broker diagnostic.
   *
   * This is the report to ask for when temperature is missing on a machine we
   * cannot inspect: it names the failing link instead of leaving a bare "N/A".
   */
  const runBrokerDiagnostic = useCallback(async () => {
    setBrokerBusy(true);
    setBrokerMessage(null);
    try {
      setBrokerDiagnostic(await nativeApi.system.diagnoseCpuSensorBroker());
      await refreshBrokerStatus();
    } catch (err: any) {
      setBrokerMessage(err?.message ?? String(err));
    } finally {
      setBrokerBusy(false);
    }
  }, [refreshBrokerStatus]);

  const runDiagnostics = useCallback(async () => {
    if (!isNative) {
      setError('CPU sensor diagnostics require the desktop app.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDebug(await nativeApi.system.getCpuTelemetryDebug());
      await refreshBrokerStatus();
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [isNative, refreshBrokerStatus]);

  const downloadDiagnostics = useCallback(() => {
    if (!debug) return;
    const blob = new Blob([JSON.stringify(debug, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `minebench-cpu-sensors-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [debug]);

  return (
    <div className={cardClass}>
      <div className="flex items-start gap-3">
        <Cpu size={20} className="text-emerald-400 mt-1 flex-shrink-0" />
        <div className="flex-1">
          <h2 className={cn('text-lg font-semibold', theme === 'light' ? 'text-zinc-900' : 'text-white')}>
            CPU Sensor Diagnostics
          </h2>
          <p className={cn('mt-1', textClass)}>
            Determine which CPU sensors MineBench can read on this PC, and why others are missing.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={runDiagnostics}
          disabled={loading || !isNative}
          className={cn(
            'inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold transition-colors',
            theme === 'light'
              ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
              : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10',
            (loading || !isNative) && 'cursor-not-allowed opacity-60'
          )}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Scanning…' : 'Run diagnostics'}
        </button>
        {debug && (
          <button
            type="button"
            onClick={downloadDiagnostics}
            className="inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-emerald-300"
          >
            <Download size={14} />
            Save report
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-500">{error}</div>
      )}

      {/* Bundled sensor helper: the only path to CPU die temperature on a stock
          Windows install, because it needs a kernel driver and therefore one
          administrator approval. */}
      <div className={cn('rounded-lg border p-4 space-y-3', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className={cn('text-xs font-semibold uppercase tracking-widest', theme === 'light' ? 'text-zinc-700' : 'text-zinc-300')}>
              CPU temperature broker
            </div>
            <p className={cn('mt-1 text-xs', textClass)}>
              Windows exposes no generic CPU temperature sensor. MineBench reads it through the
              WHQL-signed PawnIO driver with a small native broker that the installer starts
              through a scheduled task — no administrator prompt, and no third-party monitoring
              application.
            </p>
          </div>
          <span
            className={cn(
              'whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              broker?.taskRegistered
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : theme === 'light'
                  ? 'border-zinc-300 bg-white text-zinc-600'
                  : 'border-white/10 bg-white/5 text-zinc-400'
            )}
          >
            {broker ? (broker.taskRegistered ? 'Ready' : 'Task not registered') : 'Checking…'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={requestBrokerReading}
            disabled={brokerBusy || !isNative || broker?.supported === false}
            className={cn(
              'inline-flex items-center gap-2 rounded bg-emerald-400 px-3 py-2 text-xs font-bold text-zinc-950 transition-colors hover:bg-emerald-300',
              (brokerBusy || !isNative || broker?.supported === false) && 'cursor-not-allowed opacity-60'
            )}
          >
            <Shield size={14} />
            {brokerBusy ? 'Reading…' : 'Read CPU temperature'}
          </button>
          <button
            type="button"
            onClick={runBrokerDiagnostic}
            disabled={brokerBusy || !isNative}
            className={cn(
              'inline-flex items-center gap-2 rounded border px-3 py-2 text-xs font-semibold transition-colors',
              theme === 'light'
                ? 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10',
              (brokerBusy || !isNative) && 'cursor-not-allowed opacity-60'
            )}
          >
            <RefreshCw size={14} className={brokerBusy ? 'animate-spin' : ''} />
            Diagnose
          </button>
        </div>

        {brokerDiagnostic && (
          <div className={cn('rounded-lg border p-3 space-y-1 text-xs font-mono', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
            {brokerDiagnostic.steps.map((step) => (
              <div key={step.step} className="flex items-start justify-between gap-3">
                <span className={step.ok ? 'text-emerald-500' : 'text-amber-500'}>
                  {step.ok ? '✓' : '✗'} {step.step}
                </span>
                <span className={cn('text-right flex-1', textClass)}>{step.detail}</span>
              </div>
            ))}
          </div>
        )}

        {(brokerMessage || broker?.detail) && (
          <p className={cn('text-xs', broker?.taskRegistered ? textClass : 'text-amber-500')}>
            {brokerMessage ?? broker?.detail}
          </p>
        )}

        {brokerReading && (
          <div className={cn('rounded-lg border p-3 space-y-1 text-xs font-mono', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Temperature</span>
              <span>{formatTemperature(brokerReading.temperature_c)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Register</span>
              <span>{brokerReading.temperature_source ?? 'n/a'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Package power</span>
              <span>{formatWatts(brokerReading.package_power_w)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Module</span>
              <span>{brokerReading.module ?? 'n/a'}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Raw SMN</span>
              <span>{brokerReading.raw_smn ?? 'n/a'}</span>
            </div>
          </div>
        )}
      </div>

      {debug && (
        <div className="space-y-3">
          <div className={cn('rounded-lg border p-4 space-y-2 text-xs font-mono', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
            <div className="flex justify-between gap-4">
              <span className={textClass}>CPU</span>
              <span className="text-right">{debug.cpu_model}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Cores</span>
              <span>
                {debug.physical_cores ?? '?'} physical / {debug.logical_cores} logical
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Provider</span>
              <span>{debug.provider_label}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Temperature reliable</span>
              <span className={debug.temperature_reliable ? 'text-emerald-400' : 'text-amber-400'}>
                {debug.temperature_reliable ? 'yes' : 'no'}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className={textClass}>Raw sensors</span>
              <span>{debug.raw_sensors.length}</span>
            </div>
          </div>

          {debug.notes.length > 0 && (
            <ul className={cn('list-disc pl-5 space-y-1 text-xs', textClass)}>
              {debug.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <div className={cn('rounded-lg border p-4 space-y-2 text-xs font-mono', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
            <div className={cn('uppercase tracking-widest text-[10px]', textClass)}>Normalized values</div>
            <div className="flex justify-between gap-4"><span className={textClass}>Temperature</span><span>{formatTemperature(debug.normalized.temperature_c)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Package temp</span><span>{formatTemperature(debug.normalized.package_temperature_c)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Utilization</span><span>{formatPercent(debug.normalized.utilization_percent)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Clock</span><span>{formatClockGhz(debug.normalized.clock_mhz)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Power</span><span>{formatWatts(debug.normalized.package_power_w)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Fan</span><span>{formatRpm(debug.normalized.fan_rpm)}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Missing</span><span>{debug.normalized.missing.join(', ') || 'none'}</span></div>
            <div className="flex justify-between gap-4"><span className={textClass}>Collection cost</span><span>{debug.normalized.collection_ms.toFixed(1)} ms</span></div>
          </div>

          <button
            type="button"
            onClick={() => setShowSensors((value) => !value)}
            className={cn('text-xs font-semibold underline-offset-2 hover:underline', textClass)}
          >
            {showSensors ? 'Hide raw sensor dump' : `Show raw sensor dump (${debug.raw_sensors.length})`}
          </button>

          {showSensors && (
            <div className={cn('max-h-72 overflow-auto rounded-lg border p-3 text-[11px] font-mono', theme === 'light' ? 'bg-zinc-50 border-zinc-200' : 'bg-black/20 border-white/10')}>
              {debug.raw_sensors.length === 0 ? (
                <div className={textClass}>The active provider reported no sensors.</div>
              ) : (
                debug.raw_sensors.map((sensor, index) => (
                  <div key={`${sensor.name}-${index}`} className="flex justify-between gap-3 py-0.5">
                    <span className="truncate" title={`${sensor.hardware ?? ''} ${sensor.name}`}>
                      {sensor.type}: {sensor.name}
                    </span>
                    <span className="whitespace-nowrap">{sensor.value ?? 'null'}{sensor.unit ?? ''}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const validateXmrWallet = (addr: string) => {  const trimmed = addr.trim();
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
  const [localDonate] = useState(donateLevel);
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
              Custom Monero wallet support requires Premium (29 USDC once, no expiry; network fees extra).
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
          placeholder="host:port (e.g., xmr.minebench.cloud:3333)"
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
