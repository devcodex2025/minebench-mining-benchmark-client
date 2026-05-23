import React, { useEffect, useState } from 'react';
import { Minus, RefreshCw, Square, X } from './icons';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { nativeApi } from '../lib/native-api';
import { getAppUpdateStatus, getInitialAppUpdateStatus, RELEASES_URL } from '../services/appUpdate';

export const TitleBar: React.FC = () => {
  const { theme } = useTheme();
  const [updateStatus, setUpdateStatus] = useState(getInitialAppUpdateStatus);

  const handleMinimize = () => {
    nativeApi.invoke('window_minimize').catch((err) => {
      console.error('Failed to minimize window:', err);
    });
  };

  const handleMaximize = () => {
    nativeApi.invoke('window_maximize').catch((err) => {
      console.error('Failed to toggle fullscreen:', err);
    });
  };

  const handleClose = () => {
    nativeApi.invoke('window_close').catch((err) => {
      console.error('Failed to close window:', err);
    });
  };

  const handleOpenUpdate = () => {
    nativeApi.openExternal(RELEASES_URL).catch((err) => {
      console.warn('[TitleBar] open update page failed, falling back to window.open:', err);
      window.open(RELEASES_URL, '_blank', 'noopener,noreferrer');
    });
  };

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
    <div className={cn("fixed top-0 left-0 right-0 h-8 backdrop-blur-xl border-b flex items-center justify-between pl-4 pr-2 z-50 select-none",
      theme === 'light'
        ? 'bg-white/95 border-zinc-300 text-zinc-900'
        : 'bg-zinc-950/95 border-white/5 text-zinc-400'
    )} style={{ WebkitAppRegion: 'drag' } as any}>
      <div className="flex items-center gap-2">
        <span className={cn("text-xs font-medium", theme === 'light' ? 'text-zinc-600' : '')}>MineBench Client</span>
        {updateStatus.updateAvailable && (
          <button
            onClick={handleOpenUpdate}
            className={cn(
              "h-5 px-1.5 rounded flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
              theme === 'light'
                ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                : 'bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
            )}
            title={`Miner needs app update: v${updateStatus.currentVersion} -> v${updateStatus.latestVersion}`}
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <RefreshCw size={12} />
            Update
          </button>
        )}
      </div>

      <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={handleMinimize}
            className={cn("w-8 h-8 flex items-center justify-center rounded transition-colors",
              theme === 'light'
                ? 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                : 'text-zinc-400 hover:bg-white/10 hover:text-white'
            )}
            title="Minimize"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={handleMaximize}
            className={cn("w-8 h-8 flex items-center justify-center rounded transition-colors",
              theme === 'light'
                ? 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
                : 'text-zinc-400 hover:bg-white/10 hover:text-white'
            )}
            title="Maximize"
          >
            <Square size={12} />
          </button>
          <button
            onClick={handleClose}
            className={cn("w-8 h-8 flex items-center justify-center rounded transition-colors",
              theme === 'light'
                ? 'text-zinc-600 hover:bg-red-200 hover:text-red-600'
                : 'text-zinc-400 hover:bg-red-500/20 hover:text-red-400'
            )}
            title="Close"
          >
            <X size={14} />
          </button>
      </div>
    </div>
  );
};
