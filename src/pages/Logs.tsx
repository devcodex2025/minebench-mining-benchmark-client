import React, { useEffect, useState, useRef } from 'react';
import { Terminal, Circle, Trash2, Download, FolderOpen } from '../components/icons';
import { useMinerStore } from '../store/useMinerStore';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';
import { getEnvironmentConfig } from '../config/environment';

interface LogEntry {
  time: string;
  message: string;
  type: 'mining' | 'benchmark' | 'node';
}

export const Logs: React.FC = () => {
  const { theme } = useTheme();
  const { logs: storeLogs, pools } = useMinerStore();
  const [minerLogs, setMinerLogs] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<'all' | 'mining' | 'benchmark' | 'node'>('all');
  const [logsDir, setLogsDir] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const env = getEnvironmentConfig();

  useEffect(() => {
    const handleMinerLog = (_: any, data: string) => {
      setMinerLogs(prev => [...prev.slice(-200), data.trim()].filter(Boolean));
    };

    if (window.electron) {
      window.electron.onMinerLog(handleMinerLog);
    }

    // Load logs directory path
    if (window.electron?.invoke) {
      window.electron.invoke('get-logs-directory')
        .then((result: any) => {
          if (result?.path) {
            setLogsDir(result.path);
          }
        })
        .catch((err: any) => {
          console.warn('Failed to get logs directory:', err);
        });
    }

    return () => {
      // Cleanup if needed
    };
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [minerLogs, storeLogs, autoScroll]);

  const clearLogs = () => {
    setMinerLogs([]);
  };

  const openLogsFolder = () => {
    if (logsDir && window.electron?.invoke) {
      window.electron.invoke('open-folder', logsDir).catch((err: any) => {
        console.warn('Failed to open folder:', err);
      });
    }
  };

  const downloadLogs = () => {
    const allLogs = [
      '=== SYSTEM LOGS ===',
      ...storeLogs,
      '',
      '=== MINER LOGS ===',
      ...minerLogs
    ].join('\n');

    const blob = new Blob([allLogs], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `minebench-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getPoolStatus = (poolId: string) => {
    const pool = pools[poolId];
    if (!pool) return { status: 'disconnected', text: 'Not Connected', pool: undefined };
    
    if (!pool.connected) return { status: 'syncing', text: 'Connecting...', pool };
    if (!pool.isSynced) return { status: 'syncing', text: `Syncing ${pool.progress.toFixed(1)}%`, pool };
    return { status: 'ready', text: 'Synced', pool };
  };

  const primaryStatus = getPoolStatus('cpu');
  const backupStatus = env.enableBackupPool ? getPoolStatus('cpu-backup') : null;
  const categorizeSystemLog = (log: string): LogEntry['type'] => {
    const lower = log.toLowerCase();
    if (lower.includes('benchmark')) return 'benchmark';
    if (lower.includes('mining') || lower.includes('miner')) return 'mining';
    if (
      lower.includes('node') ||
      lower.includes('pool') ||
      lower.includes('sync') ||
      lower.includes('synced') ||
      lower.includes('reserve') ||
      lower.includes('primary')
    ) {
      return 'node';
    }
    return 'node';
  };

  const combinedLogs = [
    ...storeLogs.map(log => ({ type: categorizeSystemLog(log), message: log })),
    ...minerLogs.map(log => ({ type: 'mining' as const, message: log }))
  ];

  const filteredLogs = filter === 'all' 
    ? combinedLogs 
    : combinedLogs.filter(log => log.type === filter);

  return (
    <div className="p-6 space-y-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className={cn("text-2xl font-bold flex items-center gap-3", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
            <Terminal className="w-7 h-7 text-emerald-500" />
            System Logs
          </h1>
          <p className="text-sm text-zinc-500 mt-1">Real-time system and miner output</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={openLogsFolder}
            disabled={!logsDir}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
              theme === 'light'
                ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900'
                : 'bg-emerald-900/40 hover:bg-emerald-900/60 text-emerald-200'
            )}>
            <FolderOpen className="w-4 h-4" />
            Open Logs Folder
          </button>
          <button
            onClick={downloadLogs}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
              theme === 'light'
                ? 'bg-zinc-100 hover:bg-zinc-200 text-zinc-900'
                : 'bg-zinc-800 hover:bg-zinc-700 text-white'
            )}>
            <Download className="w-4 h-4" />
            Export
          </button>
          <button
            onClick={clearLogs}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors",
              theme === 'light'
                ? 'bg-zinc-100 hover:bg-red-500/20 hover:text-red-500 text-zinc-900'
                : 'bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 text-white'
            )}>
            <Trash2 className="w-4 h-4" />
            Clear
          </button>
        </div>
      </div>

      {/* Logs info */}
      {logsDir && (
        <div className={cn("p-3 rounded-lg border text-xs",
          theme === 'light'
            ? 'bg-blue-50 border-blue-200 text-blue-700'
            : 'bg-blue-500/10 border-blue-500/20 text-blue-400'
        )}>
          📁 Logs automatically saved to: <code className="font-mono text-[11px] break-all">{logsDir}</code>
        </div>
      )}

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Node Status */}
        <div className={cn("border rounded-lg p-4",
          theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/5'
        )}>
          <div className="flex items-center justify-between">
            <div className={cn("text-xs uppercase font-bold tracking-wider",
              theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
            )}>XMR Node</div>
            <Circle 
              className={`w-3 h-3 ${
                primaryStatus.status === 'ready' ? 'fill-emerald-500 text-emerald-500' :
                primaryStatus.status === 'syncing' ? 'fill-yellow-500 text-yellow-500 animate-pulse' :
                'fill-zinc-600 text-zinc-600'
              }`}
            />
          </div>
          <div className={cn("mt-2 text-sm font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>{primaryStatus.text}</div>
          {primaryStatus.pool && primaryStatus.pool.height > 0 && (
            <div className={cn("mt-1 text-xs font-mono", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
              Block {primaryStatus.pool.height.toLocaleString()} / {(primaryStatus.pool.targetHeight || 0).toLocaleString()}
            </div>
          )}
          {backupStatus?.pool && (
            <div className={cn("mt-2 text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
              CPU Reserve NODE: {backupStatus.text}
            </div>
          )}
        </div>

        {/* Miner Status */}
        <div className={cn("border rounded-lg p-4",
          theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/5'
        )}>
          <div className="flex items-center justify-between">
            <div className={cn("text-xs uppercase font-bold tracking-wider",
              theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
            )}>Miner</div>
            <Circle 
              className={`w-3 h-3 ${
                minerLogs.length > 0 && minerLogs[minerLogs.length - 1].includes('accepted') 
                  ? 'fill-emerald-500 text-emerald-500' 
                  : minerLogs.length > 0 
                    ? 'fill-blue-500 text-blue-500' 
                    : 'fill-zinc-600 text-zinc-600'
              }`}
            />
          </div>
          <div className={cn("mt-2 text-sm font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>
            {minerLogs.length > 0 ? 'Active' : 'Idle'}
          </div>
          <div className={cn("mt-1 text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
            {minerLogs.length} log entries
          </div>
        </div>

        {/* System Logs */}
        <div className={cn("border rounded-lg p-4",
          theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/5'
        )}>
          <div className="flex items-center justify-between">
            <div className={cn("text-xs uppercase font-bold tracking-wider",
              theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
            )}>System</div>
            <Circle className="w-3 h-3 fill-zinc-500 text-zinc-500" />
          </div>
          <div className={cn("mt-2 text-sm font-medium", theme === 'light' ? 'text-zinc-900' : 'text-white')}>Monitoring</div>
          <div className={cn("mt-1 text-xs", theme === 'light' ? 'text-zinc-600' : 'text-zinc-500')}>
            {storeLogs.length} system events
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className={cn("flex items-center gap-2 border-b",
        theme === 'light' ? 'border-zinc-200' : 'border-white/5'
      )}>
        {([
          { key: 'all', label: 'All' },
          { key: 'mining', label: 'Mining' },
          { key: 'benchmark', label: 'Benchmarks' },
          { key: 'node', label: 'Node' }
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors relative ${
              filter === tab.key
                ? theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'
                : theme === 'light'
                ? 'text-zinc-600 hover:text-zinc-900'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.label}
            {filter === tab.key && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />
            )}
          </button>
        ))}
        
        <div className="ml-auto flex items-center gap-2">
          <label className={cn("flex items-center gap-2 text-sm cursor-pointer",
            theme === 'light' ? 'text-zinc-600' : 'text-zinc-500'
          )}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className={cn("rounded border text-emerald-500 focus:ring-emerald-500 focus:ring-offset-0",
                theme === 'light'
                  ? 'border-zinc-300 bg-white'
                  : 'border-zinc-700 bg-zinc-800'
              )}
            />
            Auto-scroll
          </label>
        </div>
      </div>

      {/* Logs Display */}
      <div
        ref={logContainerRef}
        className={cn("flex-1 border rounded-lg p-4 font-mono text-xs overflow-y-auto space-y-1",
          theme === 'light'
            ? 'bg-white border-zinc-200 text-zinc-900'
            : 'bg-black/40 border-white/5 text-zinc-100'
        )}
      >
        {filteredLogs.length === 0 ? (
          <div className={cn("text-center py-8", theme === 'light' ? 'text-zinc-500' : 'text-zinc-600')}>
            <Terminal className={cn("w-12 h-12 mx-auto mb-3 opacity-20", theme === 'light' ? 'text-zinc-400' : 'text-zinc-600')} />
            <p>No logs yet. Start mining to see output.</p>
          </div>
        ) : (
          filteredLogs.map((log, idx) => (
            <div
              key={idx}
              className={`py-1 px-2 rounded hover:bg-white/5 transition-colors ${
                log.type === 'mining' ? 'text-blue-400' :
                log.type === 'benchmark' ? (theme === 'light' ? 'text-purple-600' : 'text-purple-400') :
                (theme === 'light' ? 'text-emerald-600' : 'text-emerald-400')
              }`}
            >
              <span className="text-zinc-600 mr-2">[{log.type.toUpperCase()}]</span>
              {log.message}
            </div>
          ))
        )}
      </div>
    </div>
  );
};
