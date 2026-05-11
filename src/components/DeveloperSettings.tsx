/**
 * Developer Settings Component
 * Дозволяє швидко змінювати конфігурацію для розробки та продакшну
 */

import React, { useState } from 'react';
import { Settings, Loader } from './icons';
import { useEnvironment, useIsDevelopment } from '../hooks/useEnvironment';
import { useTheme } from '../contexts/ThemeContext';
import { cn } from '../lib/utils';

export const DeveloperSettings: React.FC = () => {
  const { theme } = useTheme();
  const config = useEnvironment();
  const isDev = useIsDevelopment();
  const [isOpen, setIsOpen] = useState(false);

  const isDark = theme === 'dark';
  const containerClass = isDark
    ? 'bg-slate-900/80 border border-slate-700'
    : 'bg-white border border-slate-200';
  const textClass = isDark ? 'text-slate-300' : 'text-slate-600';
  const labelClass = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'p-3 rounded-lg transition-all duration-200',
          isDark ? 'bg-amber-900/20 hover:bg-amber-900/40' : 'bg-yellow-100 hover:bg-yellow-200',
          'border',
          isDark ? 'border-amber-700/30' : 'border-yellow-300/50'
        )}
        title="Developer Settings"
      >
        <Settings className={cn(
          'w-5 h-5',
          isDark ? 'text-amber-200' : 'text-yellow-700'
        )} />
      </button>

      {/* Settings Panel */}
      {isOpen && (
        <div className={cn(
          'absolute bottom-16 right-0 rounded-lg shadow-2xl p-4 w-80 max-h-96 overflow-y-auto',
          containerClass
        )}>
          <div className="space-y-4">
            {/* Header */}
            <div>
              <h3 className={cn('font-semibold mb-1', isDark ? 'text-amber-200' : 'text-yellow-700')}>
                Developer Settings
              </h3>
              <p className={cn('text-xs', labelClass)}>
                Environment: <span className="font-mono font-semibold">{config.env}</span>
              </p>
            </div>

            {/* Environment Indicator */}
            <div className={cn(
              'p-3 rounded border',
              isDark ? 'bg-slate-800 border-slate-600' : 'bg-slate-50 border-slate-200'
            )}>
              <div className="flex items-center gap-2 mb-2">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  isDev ? 'bg-blue-500' : 'bg-green-500'
                )} />
                <span className={cn('text-sm font-medium', textClass)}>
                  {isDev ? 'Development Mode' : 'Production Mode'}
                </span>
              </div>
              <p className={cn('text-xs', labelClass)}>
                To switch modes, rebuild with:{' '}
                <code className="font-mono">npm run build:prod</code>
                {' '}or{' '}
                <code className="font-mono">npm run build:dev</code>
              </p>
            </div>

            {/* Configuration URLs */}
            <div className="space-y-2">
              <h4 className={cn('text-sm font-semibold', isDark ? 'text-slate-300' : 'text-slate-700')}>
                Active URLs
              </h4>

              <div className="space-y-2 text-xs">
                {/* Wallet Auth URL */}
                <div>
                  <p className={labelClass}>Wallet Auth</p>
                  <code className={cn(
                    'block p-2 rounded font-mono text-xs break-all',
                    isDark ? 'bg-slate-800 text-amber-200' : 'bg-slate-100 text-amber-700'
                  )}>
                    {config.walletAuthUrl}
                  </code>
                </div>

                {/* API Base URL */}
                <div>
                  <p className={labelClass}>API Base</p>
                  <code className={cn(
                    'block p-2 rounded font-mono text-xs break-all',
                    isDark ? 'bg-slate-800 text-blue-200' : 'bg-slate-100 text-blue-700'
                  )}>
                    {config.apiBaseUrl}
                  </code>
                </div>

                {/* Backend URL */}
                <div>
                  <p className={labelClass}>Backend</p>
                  <code className={cn(
                    'block p-2 rounded font-mono text-xs break-all',
                    isDark ? 'bg-slate-800 text-green-200' : 'bg-slate-100 text-green-700'
                  )}>
                    {config.backendUrl}
                  </code>
                </div>

                {/* Solana RPC */}
                <div>
                  <p className={labelClass}>Solana RPC</p>
                  <code className={cn(
                    'block p-2 rounded font-mono text-xs break-all',
                    isDark ? 'bg-slate-800 text-purple-200' : 'bg-slate-100 text-purple-700'
                  )}>
                    {config.solanaRpcUrl}
                  </code>
                </div>

                {/* Sync Service URL */}
                <div>
                  <p className={labelClass}>Sync Service</p>
                  <code className={cn(
                    'block p-2 rounded font-mono text-xs break-all',
                    isDark ? 'bg-slate-800 text-pink-200' : 'bg-slate-100 text-pink-700'
                  )}>
                    {config.syncServiceUrl}
                  </code>
                </div>
              </div>
            </div>

            {/* Instructions */}
            <div className={cn(
              'p-3 rounded border',
              isDark ? 'bg-blue-900/20 border-blue-700/30' : 'bg-blue-50 border-blue-200'
            )}>
              <p className={cn('text-xs', labelClass)}>
                <strong>To switch environments:</strong>
              </p>
              <ul className={cn('text-xs mt-2 space-y-1', labelClass)}>
                <li>• <code className="font-mono">npm run dev:local</code> - Local development</li>
                <li>• <code className="font-mono">npm run dev:prod</code> - Prod endpoints in dev</li>
                <li>• <code className="font-mono">npm run build:dev</code> - Build for dev</li>
                <li>• <code className="font-mono">npm run build:prod</code> - Build for prod</li>
              </ul>
            </div>

            {/* Close Button */}
            <button
              onClick={() => setIsOpen(false)}
              className={cn(
                'w-full px-3 py-2 rounded text-sm font-medium transition-colors',
                isDark
                  ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
                  : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
              )}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
