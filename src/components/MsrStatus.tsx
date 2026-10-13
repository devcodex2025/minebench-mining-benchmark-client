import React from 'react';
import type { MinerMsrStatus } from '../lib/miner-msr';
import { cn } from '../lib/utils';

interface MsrStatusProps {
    status: MinerMsrStatus;
    theme: string;
}

const presentation: Record<MinerMsrStatus, { label: string; detail: string; light: string; dark: string; dot: string }> = {
    enabled: {
        label: 'MSR enabled',
        detail: 'RandomX CPU optimization is active.',
        light: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        dark: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
        dot: 'bg-emerald-500',
    },
    unavailable: {
        label: 'MSR unavailable',
        detail: 'XMRig could not apply the CPU optimization.',
        light: 'border-amber-200 bg-amber-50 text-amber-800',
        dark: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
        dot: 'bg-amber-500',
    },
    unknown: {
        label: 'MSR status unknown',
        detail: 'Waiting for XMRig startup telemetry.',
        light: 'border-zinc-200 bg-zinc-50 text-zinc-600',
        dark: 'border-white/10 bg-white/[0.03] text-zinc-400',
        dot: 'bg-zinc-400',
    },
};

export const MsrStatus: React.FC<MsrStatusProps> = ({ status, theme }) => {
    const current = presentation[status];
    return (
        <div
            className={cn('rounded-lg border px-3 py-2 text-xs', theme === 'light' ? current.light : current.dark)}
            data-testid="msr-status"
            aria-live="polite"
        >
            <div className="flex items-center gap-2 font-semibold">
                <span className={cn('h-2 w-2 rounded-full', current.dot)} aria-hidden="true" />
                <span>{current.label}</span>
            </div>
            <p className="mt-1 opacity-80">{current.detail}</p>
        </div>
    );
};
