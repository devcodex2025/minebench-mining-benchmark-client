/**
 * Typed mirror of the Rust `cpu_telemetry` module.
 *
 * Optional metrics are `null` - never `0` - when the hardware or provider does
 * not expose them. A real `0` therefore stays distinguishable from an
 * unavailable sensor, and the UI can render `N/A`.
 */

export type CpuProviderKind =
  | 'bundled-helper'
  | 'libre-hardware-monitor'
  | 'hwinfo-registry'
  | 'acpi-thermal-zone'
  | 'sysinfo-components'
  | 'none';

export type CpuTelemetryStatus = 'unavailable' | 'ready' | 'degraded';

export interface CoreTelemetry {
  index: number;
  utilization_percent: number | null;
  clock_mhz: number | null;
  temperature_c: number | null;
}

export interface RawSensor {
  name: string;
  type: string;
  value: string | null;
  min?: string | null;
  max?: string | null;
  unit?: string | null;
  hardware?: string | null;
  identifier?: string | null;
}

export interface CpuTelemetry {
  model: string;
  utilization_percent: number | null;
  temperature_c: number | null;
  package_temperature_c: number | null;
  clock_mhz: number | null;
  max_clock_mhz: number | null;
  base_clock_mhz: number | null;
  package_power_w: number | null;
  fan_rpm: number | null;
  physical_cores: number | null;
  logical_cores: number;
  voltage_v: number | null;
  per_core: CoreTelemetry[];
  throttling: boolean | null;
  temperature_source: string | null;
  power_source: string | null;
  fan_source: string | null;
  power_is_estimated: boolean;
  provider: CpuProviderKind;
  provider_label: string;
  status: CpuTelemetryStatus;
  /** `windows`, `macos`, `linux` — drives platform-specific guidance. */
  platform: string;
  temperature_reliable: boolean;
  timestamp: string;
  missing: string[];
  /** Wall-clock cost of the Rust collection, in milliseconds. */
  collection_ms: number;
}

export interface CpuTelemetryDebug {
  cpu_model: string;
  logical_cores: number;
  physical_cores: number | null;
  provider: CpuProviderKind;
  provider_label: string;
  provider_detail: string;
  temperature_reliable: boolean;
  raw_sensors: RawSensor[];
  detected: Record<string, unknown>;
  normalized: CpuTelemetry;
  notes: string[];
  platform: string;
  /** MineBench's bundled elevated sensor helper. */
  helper_state: CpuHelperState;
  helper_detail: string;
}

export type CpuHelperState = 'not-started' | 'running' | 'stalled' | 'declined';

/**
 * Privileged sensor broker.
 *
 * The broker is a small native binary that reads CPU die temperature through
 * the WHQL-signed PawnIO kernel driver. Because that device is only reachable
 * from an elevated process, the installer registers a highest-privileges
 * scheduled task that starts it on demand - MineBench itself never elevates and
 * the user is never prompted.
 */
export interface CpuSensorBrokerStatus {
  supported: boolean;
  /** False when the installer has not registered the task (or policy blocked it). */
  taskRegistered: boolean;
  detail: string;
  taskName: string;
}

/** Human-readable broker state for the diagnostics panel. */
export const CPU_BROKER_LABELS: Record<CpuHelperState, string> = {
  'not-started': 'Task not registered',
  running: 'Working',
  stalled: 'Task registered',
  declined: 'Blocked by policy',
};

/** One reading produced by the broker. */
export interface CpuSensorBrokerSnapshot {
  schema: number;
  module?: string | null;
  vendor?: string | null;
  temperature_c: number | null;
  temperature_source?: string | null;
  package_power_w: number | null;
  /** The fan the broker identified as the CPU's, and how it decided. */
  fan_rpm?: number | null;
  fan_source?: string | null;
  /** Every fan channel the motherboard's controller reported. */
  fans?: CpuSensorBrokerFanChannel[];
  /** Raw register value, so a wrong reading cannot hide behind a plausible number. */
  raw_smn?: string | null;
  provider_detail?: string | null;
}

/** One channel of the motherboard's fan controller. */
export interface CpuSensorBrokerFanChannel {
  channel: number;
  rpm: number | null;
  temperature_source: number;
  temperature_source_name: string;
  is_cpu: boolean;
  /** The speed register pair exactly as read, in revolutions per minute. */
  rpm_raw?: string;
  /** The companion 13-bit count register, which has to agree with it. */
  count_raw?: number | null;
  temperature_source_raw: number;
}

/** One link in the broker chain, as reported by the diagnostic. */
export interface CpuSensorBrokerDiagnosticStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface CpuSensorBrokerDiagnostic {
  ok: boolean;
  steps: CpuSensorBrokerDiagnosticStep[];
}

export const isMetric = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Temperature, e.g. `72 °C`. */
export const formatTemperature = (value: number | null | undefined): string =>
  isMetric(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} °C` : 'N/A';

/** Utilization, e.g. `98%`. */
export const formatPercent = (value: number | null | undefined): string =>
  isMetric(value) ? `${Math.round(value)}%` : 'N/A';

/** Clock, e.g. `4.35 GHz` for values reported in MHz. */
export const formatClockGhz = (mhz: number | null | undefined): string =>
  isMetric(mhz) && mhz > 0 ? `${(mhz / 1000).toFixed(2)} GHz` : 'N/A';

/** Power, e.g. `84 W`. */
export const formatWatts = (value: number | null | undefined): string =>
  isMetric(value) ? `${value.toFixed(value >= 100 ? 0 : 1)} W` : 'N/A';

/** Fan, e.g. `1,420 RPM`. */
export const formatRpm = (value: number | null | undefined): string =>
  isMetric(value) ? `${Math.round(value).toLocaleString('en-US')} RPM` : 'N/A';

export const formatVoltage = (value: number | null | undefined): string =>
  isMetric(value) ? `${value.toFixed(2)} V` : 'N/A';
