import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import {
  TrendingUp,
  Award,
  Zap,
  Cpu,
  Calendar,
  TrendingDown,
  AlertCircle,
  Loader,
  Database
} from '../components/icons';
import { SolanaAuthService, useSolanaAuth } from '../services/solanaAuth';
import { useTheme } from '../contexts/ThemeContext';
import { useMinerStore } from '../store/useMinerStore';
import { cn, formatHashrate } from '../lib/utils';
import { p2poolAPI } from '../services/p2poolAPI';

interface RewardData {
  date: string;
  rewards: number;
  source: string;
  type: string;
}

interface DeviceStats {
  id: string;
  name: string;
  type: 'cpu' | 'gpu';
  hashrate: number;
  lastSeen: number;
  isActive: boolean;
  rewards: number;
}

interface PoolRewardStats {
  totalBmtRewards: number;
  totalBmtPayouts: number;
  availableBmtRewards: number;
  rewardEntries: number;
}

const StatCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  value: string;
  subtitle?: string;
  trend?: number;
  theme: string;
}> = ({ icon, title, value, subtitle, trend, theme }) => (
  <div className={cn(
    'p-4 rounded-lg border',
    theme === 'light'
      ? 'bg-white border-zinc-200'
      : 'bg-zinc-900/50 border-white/10'
  )}>
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn(
            'p-2 rounded-lg',
            theme === 'light'
              ? 'bg-zinc-100 text-zinc-700'
              : 'bg-white/10 text-white/60'
          )}>
            {icon}
          </span>
        </div>
        <p className={cn(
          'text-xs font-medium mb-1',
          theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'
        )}>
          {title}
        </p>
        <p className={cn(
          'text-2xl font-bold',
          theme === 'light' ? 'text-zinc-900' : 'text-white'
        )}>
          {value}
        </p>
        {subtitle && (
          <p className={cn(
            'text-xs mt-1',
            theme === 'light' ? 'text-zinc-500' : 'text-zinc-500'
          )}>
            {subtitle}
          </p>
        )}
      </div>
      {trend !== undefined && (
        <div className="flex items-center gap-1">
          {trend > 0 ? (
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          ) : (
            <TrendingDown className="w-4 h-4 text-red-500" />
          )}
          <span className={cn(
            'text-sm font-semibold',
            trend > 0 ? 'text-emerald-600' : 'text-red-600'
          )}>
            {trend > 0 ? '+' : ''}{trend}%
          </span>
        </div>
      )}
    </div>
  </div>
);

export const MiningStatistics: React.FC = () => {
  const { theme } = useTheme();
  const { user, miningStats, statsLoading } = useSolanaAuth();
  const currentHashrate = useMinerStore(state => state.currentHashrate);
  const dbTotalBMT = useMinerStore(state => state.dbTotalBMT);
  const history = useMinerStore(state => state.history);
  const poolHashrateTotal = useMinerStore(state => state.poolHashrateTotal);
  const poolMinersCount = useMinerStore(state => state.poolMinersCount);
  const cpuName = useMinerStore(state => state.cpuName);
  const workerName = useMinerStore(state => state.workerName);
  const deviceType = useMinerStore(state => state.deviceType);
  const status = useMinerStore(state => state.status);
  const [rewardHistory, setRewardHistory] = useState<RewardData[]>([]);
  const [rewardHistoryLoading, setRewardHistoryLoading] = useState(false);
  const [poolRewardStats, setPoolRewardStats] = useState<PoolRewardStats | null>(null);
  const safeTotalRewards = Number.isFinite(miningStats?.totalRewards)
    ? Number(miningStats?.totalRewards)
    : (Number.isFinite(dbTotalBMT) ? dbTotalBMT : 0);
  const totalBmtEarned = Number(miningStats?.totalBmtEarned || 0);
  const totalBmtWithdrawn = Number(miningStats?.totalBmtWithdrawn || 0);
  const totalXmrMined = Number(miningStats?.totalXmrMined || 0);

  useEffect(() => {
    let cancelled = false;
    const loadPoolRewards = async () => {
      try {
        const stats = await p2poolAPI.getPoolStats();
        if (!cancelled) setPoolRewardStats(stats.rewards || null);
      } catch (err) {
        console.warn('[Statistics] Failed to load pool reward stats:', err);
        if (!cancelled) setPoolRewardStats(null);
      }
    };

    loadPoolRewards();
    const interval = setInterval(loadPoolRewards, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!user?.publicKey) return;

    let cancelled = false;
    const loadRewardHistory = async () => {
      setRewardHistoryLoading(true);
      try {
        const entries = await SolanaAuthService.getInstance().fetchRewardHistory(50);
        if (cancelled) return;
        setRewardHistory(entries
          .filter((entry) => entry.currency === 'BMT' && Number(entry.amount) > 0)
          .slice(0, 20)
          .reverse()
          .map((entry) => ({
            date: new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            rewards: Number(entry.amount),
            source: entry.metadata?.source || 'pool',
            type: entry.type || 'MINING_REWARD'
          })));
      } catch (err) {
        console.warn('[Statistics] Failed to load reward history:', err);
        if (!cancelled) setRewardHistory([]);
      } finally {
        if (!cancelled) setRewardHistoryLoading(false);
      }
    };

    loadRewardHistory();
    const interval = setInterval(loadRewardHistory, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.publicKey]);

  const deviceStats = useMemo<DeviceStats[]>(() => {
    const devices = (miningStats?.devices || []).map((device) => ({
      id: device.id,
      name: device.name || `${device.deviceType.toUpperCase()} device`,
      type: device.deviceType,
      hashrate: Number(device.totalHashrate || 0),
      lastSeen: Number(device.lastSeen || Date.now()),
      isActive: !!device.isActive,
      rewards: Number(device.totalRewards || 0)
    }));

    if (currentHashrate > 0) {
      const localName = deviceType === 'cpu'
        ? (cpuName || workerName || 'Local CPU')
        : (workerName || 'Local GPU');
      const hasLocal = devices.some((device) =>
        device.name === localName || (device.isActive && device.type === deviceType)
      );

      if (!hasLocal) {
        devices.unshift({
          id: 'local-current-device',
          name: localName,
          type: deviceType,
          hashrate: currentHashrate,
          lastSeen: Date.now(),
          isActive: status === 'running' || status === 'starting',
          rewards: safeTotalRewards
        });
      }
    }

    return devices;
  }, [miningStats?.devices, currentHashrate, cpuName, workerName, deviceType, status, safeTotalRewards]);


  if (!user) {
    return (
      <div className={cn(
        'p-6 rounded-lg border text-center',
        theme === 'light'
          ? 'bg-zinc-50 border-zinc-200'
          : 'bg-zinc-900/50 border-white/10'
      )}>
        <AlertCircle className={cn(
          'w-12 h-12 mx-auto mb-3',
          theme === 'light' ? 'text-zinc-400' : 'text-zinc-600'
        )} />
        <p className={cn(
          'font-semibold mb-1',
          theme === 'light' ? 'text-zinc-900' : 'text-white'
        )}>
          Connect Your Wallet
        </p>
        <p className={cn(
          'text-sm',
          theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'
        )}>
          Sign in with Solana to view mining statistics and rewards across devices
        </p>
      </div>
    );
  }

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className={cn(
          'text-2xl font-bold mb-2',
          theme === 'light' ? 'text-zinc-900' : 'text-white'
        )}>
          Mining Statistics
        </h1>
        <p className={cn(
          'text-sm',
          theme === 'light' ? 'text-zinc-600' : 'text-zinc-400'
        )}>
          Track your mining rewards across all devices
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Award className="w-5 h-5" />}
          title="Available BMT"
          value={`${safeTotalRewards.toFixed(4)} $BMT`}
          subtitle="Confirmed database balance"
          theme={theme}
        />
        <StatCard
          icon={<Database className="w-5 h-5" />}
          title="Pool Rewards"
          value={`${(poolRewardStats?.totalBmtRewards ?? totalBmtEarned).toFixed(4)} BMT`}
          subtitle={`Available ${(poolRewardStats?.availableBmtRewards ?? safeTotalRewards).toFixed(4)} / paid ${(poolRewardStats?.totalBmtPayouts ?? totalBmtWithdrawn).toFixed(4)}`}
          theme={theme}
        />
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          title="Total XMR Mined"
          value={`${totalXmrMined.toFixed(6)} XMR`}
          subtitle="Lifetime from pool"
          theme={theme}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          title="This Session"
          value={`${(history.length).toString()} samples`}
          subtitle="Live data"
          theme={theme}
        />
        <StatCard
          icon={<Zap className="w-5 h-5" />}
          title="Current Hashrate"
          value={formatHashrate(currentHashrate)}
          subtitle={`${deviceStats.length} devices`}
          theme={theme}
        />
        <StatCard
          icon={<Calendar className="w-5 h-5" />}
          title="Pool Sync"
          value={`${useMinerStore.getState().pools['cpu']?.progress.toFixed(1) || 0}%`}
          subtitle={useMinerStore.getState().pools['cpu']?.isSynced ? 'Ready' : 'Syncing'}
          theme={theme}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
          title="Pool Performance"
          value={formatHashrate(poolHashrateTotal)}
          subtitle={`${poolMinersCount} Miners Active`}
          theme={theme}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Reward History */}
        <div className={cn(
          'p-6 rounded-lg border',
          theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/10'
        )}>
          <h2 className={cn(
            'text-lg font-semibold mb-4',
            theme === 'light' ? 'text-zinc-900' : 'text-white'
          )}>
            Reward History (live)
          </h2>
          {rewardHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rewardHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme === 'light' ? '#e4e4e7' : '#27272a'} />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} stroke={theme === 'light' ? '#71717a' : '#a1a1aa'} />
                <YAxis tick={{ fontSize: 12 }} stroke={theme === 'light' ? '#71717a' : '#a1a1aa'} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: theme === 'light' ? '#fafafa' : '#18181b',
                    border: `1px solid ${theme === 'light' ? '#e4e4e7' : '#27272a'}`,
                    borderRadius: '8px'
                  }}
                  formatter={(value: any) => [`${Number(value).toFixed(6)} $BMT`, 'Reward']}
                  labelFormatter={(_, payload) => {
                    const entry = payload?.[0]?.payload as RewardData | undefined;
                    return entry ? `${entry.date} - ${entry.source}` : '';
                  }}
                />
                <Bar dataKey="rewards" fill="#facc15" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className={cn(
              'h-[300px] rounded-lg border border-dashed flex items-center justify-center text-sm',
              theme === 'light'
                ? 'border-zinc-200 bg-zinc-50 text-zinc-500'
                : 'border-white/10 bg-white/[0.03] text-zinc-500'
            )}>
              {rewardHistoryLoading ? 'Loading reward history...' : 'No confirmed BMT rewards yet'}
            </div>
          )}
        </div>

        {/* Device Performance */}
        <div className={cn(
          'p-6 rounded-lg border',
          theme === 'light'
            ? 'bg-white border-zinc-200'
            : 'bg-zinc-900/50 border-white/10'
        )}>
          <h2 className={cn(
            'text-lg font-semibold mb-4',
            theme === 'light' ? 'text-zinc-900' : 'text-white'
          )}>
            Device Performance
          </h2>
          <div className="space-y-3 min-h-[300px]">
            {deviceStats.length > 0 ? (
              deviceStats.map((device) => {
                const maxHashrate = Math.max(...deviceStats.map((item) => item.hashrate), 1);
                const width = Math.max(4, Math.min(100, (device.hashrate / maxHashrate) * 100));
                return (
                  <div
                    key={device.id}
                    className={cn(
                      'p-4 rounded-lg border',
                      theme === 'light'
                        ? 'bg-zinc-50 border-zinc-200'
                        : 'bg-white/[0.04] border-white/10'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          'p-2 rounded-lg shrink-0',
                          device.isActive
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : theme === 'light'
                              ? 'bg-zinc-100 text-zinc-500'
                              : 'bg-zinc-800 text-zinc-400'
                        )}>
                          {device.type === 'cpu' ? <Cpu className="w-5 h-5" /> : <Zap className="w-5 h-5" />}
                        </div>
                        <div className="min-w-0">
                          <p className={cn('font-semibold truncate', theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                            {device.name}
                          </p>
                          <p className={cn('text-xs', theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                            {device.isActive ? 'Active' : 'Offline'} - {device.type.toUpperCase()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn('font-mono font-semibold', theme === 'light' ? 'text-zinc-900' : 'text-white')}>
                          {formatHashrate(device.hashrate)}
                        </p>
                        <p className={cn('text-xs', theme === 'light' ? 'text-zinc-500' : 'text-zinc-400')}>
                          {device.rewards.toFixed(4)} BMT
                        </p>
                      </div>
                    </div>
                    <div className={cn('h-2 rounded-full overflow-hidden', theme === 'light' ? 'bg-zinc-200' : 'bg-zinc-800')}>
                      <div
                        className="h-full rounded-full bg-emerald-500"
                        style={{ width: `${width}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className={cn(
                'h-[300px] rounded-lg border border-dashed flex items-center justify-center text-sm',
                theme === 'light'
                  ? 'border-zinc-200 bg-zinc-50 text-zinc-500'
                  : 'border-white/10 bg-white/[0.03] text-zinc-500'
              )}>
                No connected devices yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Devices List */}
      <div className={cn(
        'p-6 rounded-lg border',
        theme === 'light'
          ? 'bg-white border-zinc-200'
          : 'bg-zinc-900/50 border-white/10'
      )}>
        <h2 className={cn(
          'text-lg font-semibold mb-4',
          theme === 'light' ? 'text-zinc-900' : 'text-white'
        )}>
          Connected Devices
        </h2>
        <div className="space-y-3">
          {deviceStats.length > 0 ? (
            deviceStats.map((device) => (
              <div
                key={device.id}
                className={cn(
                  'p-4 rounded-lg border flex items-center justify-between',
                  theme === 'light'
                    ? 'bg-zinc-50 border-zinc-200'
                    : 'bg-white/5 border-white/10'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn(
                    'p-2 rounded-lg',
                    device.isActive
                      ? theme === 'light'
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-emerald-900/30 text-emerald-400'
                      : theme === 'light'
                        ? 'bg-zinc-100 text-zinc-500'
                        : 'bg-zinc-800 text-zinc-400'
                  )}>
                    {device.type === 'cpu' ? (
                      <Cpu className="w-5 h-5" />
                    ) : (
                      <Zap className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <p className={cn(
                      'font-semibold',
                      theme === 'light' ? 'text-zinc-900' : 'text-white'
                    )}>
                      {device.name}
                    </p>
                    <p className={cn(
                      'text-xs',
                      theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'
                    )}>
                      {formatHashrate(device.hashrate)} - Last seen: {new Date(device.lastSeen).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn(
                    'font-semibold',
                    device.isActive
                      ? 'text-emerald-600'
                      : theme === 'light'
                        ? 'text-zinc-500'
                        : 'text-zinc-400'
                  )}>
                    {device.isActive ? 'Active' : 'Offline'}
                  </p>
                  <p className={cn(
                    'text-xs',
                    theme === 'light' ? 'text-zinc-500' : 'text-zinc-400'
                  )}>
                    {device.rewards.toFixed(4)} BMT
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className={cn(
              'p-4 rounded-lg text-center',
              theme === 'light'
                ? 'bg-zinc-50 text-zinc-600'
                : 'bg-white/5 text-zinc-400'
            )}>
              <p className="text-sm">No devices connected yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
