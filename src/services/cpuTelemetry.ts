import { useEffect, useState } from 'react';
import { nativeApi } from '../lib/native-api';
import type { CpuTelemetry } from '../lib/cpu-telemetry';

/**
 * How often telemetry is requested. The Rust backend keeps utilization deltas
 * fresh independently, so this is purely a UI refresh cadence.
 */
export const TELEMETRY_INTERVAL_MS = 1000;

/** Consecutive failures before the UI marks the feed as stale. */
const STALE_AFTER_FAILURES = 3;

const isTauri = () => typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

export interface CpuTelemetryState {
  telemetry: CpuTelemetry | null;
  /** Last successful reading was too long ago; values shown are not live. */
  stale: boolean;
  /** True while a request is in flight and no reading has arrived yet. */
  loading: boolean;
  consecutiveFailures: number;
  lastError: string | null;
}

type Listener = (state: CpuTelemetryState) => void;

/**
 * Single telemetry poller for the whole app.
 *
 * Guarantees required by Stress Test mode:
 * - at most one in-flight request (a recursive timeout, never an interval),
 * - polling stops completely when no component is subscribed,
 * - a transient provider failure keeps the last good values and only flags
 *   staleness after several consecutive failures, instead of blanking the UI.
 */
class CpuTelemetryMonitor {
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private disposed = false;
  private state: CpuTelemetryState = {
    telemetry: null,
    stale: false,
    loading: true,
    consecutiveFailures: 0,
    lastError: null,
  };

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    // A late subscriber (e.g. Benchmark opened after Stress Test) must not wait
    // a full interval for the first reading.
    if (!this.timer && !this.inFlight) {
      void this.tick();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stop();
      }
    };
  }

  getState(): CpuTelemetryState {
    return this.state;
  }

  private emit(patch: Partial<CpuTelemetryState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.disposed = true;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, TELEMETRY_INTERVAL_MS);
  }

  private async tick() {
    // Overlap guard: a slow provider response must never stack up requests.
    if (this.inFlight || this.disposed || this.listeners.size === 0) {
      return;
    }
    if (!isTauri()) {
      this.emit({ loading: false, lastError: 'CPU telemetry requires the desktop app' });
      return;
    }

    this.inFlight = true;
    try {
      const telemetry = await nativeApi.system.getCpuTelemetry();
      this.emit({
        telemetry,
        loading: false,
        stale: false,
        consecutiveFailures: 0,
        lastError: null,
      });
    } catch (error) {
      const failures = this.state.consecutiveFailures + 1;
      // Keep the previous reading so a single failure does not blank the chart.
      this.emit({
        loading: false,
        consecutiveFailures: failures,
        stale: failures >= STALE_AFTER_FAILURES,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.inFlight = false;
      if (!this.disposed && this.listeners.size > 0) {
        this.schedule();
      }
    }
  }
}

const monitor = new CpuTelemetryMonitor();

/** Subscribes to CPU telemetry; polling stops when the last consumer unmounts. */
export function useCpuTelemetry(): CpuTelemetryState {
  const [state, setState] = useState<CpuTelemetryState>(() => monitor.getState());

  useEffect(() => {
    // The monitor is a module singleton; a StrictMode double-mount must not
    // leave a second poller running, so each subscription owns its teardown.
    return monitor.subscribe(setState);
  }, []);

  return state;
}

export const cpuTelemetryMonitor = monitor;
