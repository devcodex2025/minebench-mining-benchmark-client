import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Flame, Hammer, Settings, BarChart3, Terminal, TrendingUp, type LucideIcon } from './icons';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { useMinerStore } from '../store/useMinerStore';
import { useIsDevelopment } from '../hooks/useEnvironment';
import { SolanaAuthButton } from './SolanaAuthButton';
import { DeveloperSettings } from './DeveloperSettings';

export const Layout = ({ children }: { children: React.ReactNode }) => {
  const { theme } = useTheme();
  const { dbTotalBMT, status, pools, poolHashrateTotal, poolMinersCount, xmrUsd, bmtUsd, rateXmrBmt } = useMinerStore();
  const poolLabels: Record<string, string> = {
    'cpu': 'CPU Primary',
    'cpu-backup': 'CPU Reserve'
  };

  // Format hashrate function
  const formatHashrate = (hashrate: number): string => {
    if (hashrate === 0) return '0.00 H/s';
    if (hashrate < 1000) return `${hashrate.toFixed(2)} H/s`;
    if (hashrate < 1000000) return `${(hashrate / 1000).toFixed(2)} kH/s`;
    if (hashrate < 1000000000) return `${(hashrate / 1000000).toFixed(2)} MH/s`;
    if (hashrate < 1000000000000) return `${(hashrate / 1000000000).toFixed(2)} GH/s`;
    return `${(hashrate / 1000000000000).toFixed(2)} TH/s`;
  };

  return (
    <div className={cn(
      "flex h-screen min-w-[920px] overflow-hidden font-sans selection:bg-emerald-500/30 pt-8",
      theme === 'light' 
        ? 'bg-zinc-100 text-zinc-900' 
        : 'bg-zinc-950 text-white'
    )}>
      {/* Sidebar */}
      <aside className={cn(
        "w-56 xl:w-64 border-r flex flex-col justify-between p-3 xl:p-4 flex-shrink-0",
        theme === 'light'
          ? 'border-zinc-300 bg-zinc-100'
          : 'border-white/5 bg-zinc-900/50 backdrop-blur-xl'
      )}>
        <div className="flex-1 overflow-y-auto sidebar-scrollbar space-y-6">
           <div className="flex items-center gap-3 px-2 mt-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden">
                {/* Use relative path so it works with file:// protocol in packaged app */}
                <img src="minebench-logo-yellow.png" alt="MineBench Logo" className="w-full h-full object-contain" />
                </div>
                <div>
                    <h1 className="font-bold text-lg tracking-tight">MineBench</h1>
                </div>
           </div>

           <nav className="space-y-1">
              <NavItem to="/" icon={BarChart3} label="Dashboard" />
              <NavItem to="/benchmark" icon={Activity} label="Benchmarks" />
              <NavItem to="/mining" icon={Hammer} label="Mining Mode" />
              <NavItem to="/stress-test" icon={Flame} label="Stress Test" />
              <NavItem to="/statistics" icon={TrendingUp} label="Statistics" />
              <NavItem to="/logs" icon={Terminal} label="System Logs" />
           </nav>

           <div className={cn("space-y-3 pt-4 border-t", 
             theme === 'light' ? 'border-zinc-300' : 'border-white/5'
           )}>
                <div className={cn("px-2 text-[10px] font-bold uppercase tracking-widest",
                  theme === 'light' ? 'text-zinc-700' : 'text-zinc-600'
                )}>Active Pools</div>
                {Object.entries(pools).map(([id, pool]) => (
                    <div key={id} className={cn("p-3 rounded-lg border space-y-2",
                      theme === 'light'
                        ? 'bg-white border-zinc-200'
                        : 'bg-zinc-800/30 border-white/5'
                    )}>
                        <div className="flex items-center justify-between text-xs">
                            <span className={cn("uppercase font-medium tracking-wider",
                              theme === 'light' ? 'text-zinc-700' : 'text-zinc-500'
                            )}>{poolLabels[id] ?? id} Node</span>
                            <span className={cn(
                                "px-1.5 py-0.5 rounded text-[10px] uppercase font-bold",
                                !pool.connected ? "bg-yellow-500/10 text-yellow-500 animate-pulse" :
                                !pool.isSynced ? "bg-yellow-500/10 text-yellow-500 animate-pulse" :
                              (theme === 'light' ? "bg-emerald-500/10 text-emerald-500" : "bg-emerald-500/10 text-emerald-400")
                            )}>
                                {!pool.connected ? "Sync..." : !pool.isSynced ? "Sync" : "Ready"}
                            </span>
                        </div>
                        
                        <div className="space-y-1">
                            <div className={cn("flex justify-between text-[10px] font-mono",
                              theme === 'light' ? 'text-zinc-700' : 'text-zinc-400'
                            )}>
                                <span className={cn(
                                  theme === 'light' ? 'text-emerald-600/60' : 'text-emerald-500/60'
                                )}>{pool.coin}</span>
                                <span>{pool.progress.toFixed(1)}%</span>
                            </div>
                            <div className={cn("w-full h-1 rounded-full overflow-hidden",
                              theme === 'light' ? 'bg-zinc-300' : 'bg-zinc-900'
                            )}>
                                <div 
                                    className={cn(
                                        "h-full transition-all duration-1000",
                                        pool.isSynced ? "bg-emerald-500" : "bg-yellow-500"
                                    )}
                                    style={{ width: `${Math.max(pool.progress, 2)}%` }}
                                />
                            </div>
                        </div>
                    </div>
                ))}
           </div>
        </div>

        <div className="pt-4 space-y-3">
             {/* Solana Wallet */}
             <SolanaAuthButton />

             {/* Mini Stats Card */}
            <div className={cn("p-3 rounded-lg border",
              theme === 'light'
                ? 'bg-emerald-50 border-emerald-300'
                : 'bg-emerald-500/5 border-emerald-500/10'
            )}>
                <div className={cn("text-xs mb-1 font-medium italic",
                  theme === 'light' ? 'text-emerald-900' : 'text-zinc-500'
                )}>Confirmed Rewards</div>
                <div className={cn("font-mono text-xl font-medium flex items-baseline gap-1",
                  theme === 'light' ? 'text-emerald-600' : 'text-emerald-400'
                )}>
                    {(Number.isFinite(dbTotalBMT) ? dbTotalBMT : 0).toFixed(4)} <span className="text-[10px] text-emerald-500/70 uppercase tracking-widest">$BMT</span>
                </div>
            </div>

            <NavItem to="/settings" icon={Settings} label="Settings" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
         {/* Background Glows */}
         <div className={cn("absolute top-[-50%] left-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none",
           theme === 'light' ? 'bg-blue-200/20' : 'bg-emerald-500/5'
         )} />
         <div className={cn("absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full blur-[120px] pointer-events-none",
           theme === 'light' ? 'bg-emerald-200/20' : 'bg-blue-500/5'
         )} />

         <header className={cn("min-h-14 border-b flex flex-wrap items-center justify-between gap-3 px-4 xl:px-6 py-3 backdrop-blur z-10",
           theme === 'light'
             ? 'border-zinc-300 bg-white'
             : 'border-white/5 bg-zinc-950/50'
         )}>
            <div className="flex items-center gap-2">
                <div className={cn("w-2 h-2 rounded-full", status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-600')} />
                <span className={cn("text-xs uppercase tracking-wider font-semibold",
                  theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'
                )}>
                    {status === 'running' ? 'System Active' : 'System Idle'}
                </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                <div className={cn("font-mono text-sm",
                  theme === 'light' ? 'text-zinc-700' : 'text-zinc-400'
                )}>
                    <span className={cn("mr-2", theme === 'light' ? 'text-zinc-600' : 'text-zinc-600')}>NET_HASH:</span>
                    {formatHashrate(poolHashrateTotal)}
                </div>
                <div className={cn("font-mono text-sm",
                  theme === 'light' ? 'text-zinc-700' : 'text-zinc-400'
                )}>
                    <span className={cn("mr-2", theme === 'light' ? 'text-zinc-600' : 'text-zinc-600')}>MINERS:</span>
                    {poolMinersCount}
                </div>
            </div>
         </header>

         <div className="flex-1 overflow-auto p-4 xl:p-6 z-10 custom-scrollbar">
            {children}
         </div>

         {/* Developer Settings - only in development mode */}
         {useIsDevelopment() && <DeveloperSettings />}
      </main>
    </div>
  );
};

const NavItem = ({ to, icon: Icon, label }: { to: string, icon: LucideIcon, label: string }) => {
  const { theme } = useTheme();
  return (
    <NavLink 
      to={to}
      onClick={(e) => {
        const { status } = useMinerStore.getState();
        const isMining = status === 'running' || status === 'starting' || status === 'paused';
        if (isMining) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className={({ isActive }) => cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 group",
          isActive 
              ? theme === 'light'
                ? "bg-zinc-200 text-zinc-900 border border-zinc-300"
                : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
              : theme === 'light'
              ? "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-200"
              : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5",
          (() => {
            const { status } = useMinerStore.getState();
            const isMining = status === 'running' || status === 'starting' || status === 'paused';
            return isMining ? "opacity-50 cursor-not-allowed pointer-events-none" : "cursor-pointer";
          })()
      )}
      title={(() => {
        const { status } = useMinerStore.getState();
        const isMining = status === 'running' || status === 'starting' || status === 'paused';
        return isMining ? "Navigation disabled while mining" : "";
      })()}
    >
      <Icon size={18} className="opacity-70 group-hover:opacity-100" />
      <span className="text-sm font-medium">{label}</span>
    </NavLink>
  );
};
