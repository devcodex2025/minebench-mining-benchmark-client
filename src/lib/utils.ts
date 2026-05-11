import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatHashrate(hr: number) {
  const val = Number(hr);
  if (typeof val !== 'number' || isNaN(val)) return '0.00 H/s';

  if (val >= 1e9) return (val / 1e9).toFixed(2) + ' GH/s';
  if (val >= 1e6) return (val / 1e6).toFixed(2) + ' MH/s';
  if (val >= 1e3) return (val / 1e3).toFixed(2) + ' KH/s';
  return val.toFixed(2) + ' H/s';
}

