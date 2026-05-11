import React from 'react';
import { Minus, Square, X } from './icons';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

export const TitleBar: React.FC = () => {
  const { theme } = useTheme();
  const handleMinimize = () => {
    window.electron.invoke('window-minimize');
  };

  const handleMaximize = () => {
    window.electron.invoke('window-maximize');
  };

  const handleClose = () => {
    window.electron.invoke('window-close');
  };

  return (
    <div className={cn("fixed top-0 left-0 right-0 h-8 backdrop-blur-xl border-b flex items-center justify-between pl-4 pr-2 z-50 select-none",
      theme === 'light'
        ? 'bg-white/95 border-zinc-300 text-zinc-900'
        : 'bg-zinc-950/95 border-white/5 text-zinc-400'
    )} style={{ WebkitAppRegion: 'drag' } as any}>
      <span className={cn("text-xs font-medium", theme === 'light' ? 'text-zinc-600' : '')}>MineBench Client</span>

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
