import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  formatClockGhz,
  formatPercent,
  formatRpm,
  formatTemperature,
  formatVoltage,
  formatWatts,
} from './cpu-telemetry.ts';

const read = (relativePath: string) => fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');

test('unavailable CPU metrics render as N/A instead of a fake zero', () => {
  for (const value of [null, undefined]) {
    assert.equal(formatTemperature(value), 'N/A');
    assert.equal(formatWatts(value), 'N/A');
    assert.equal(formatRpm(value), 'N/A');
    assert.equal(formatClockGhz(value), 'N/A');
    assert.equal(formatPercent(value), 'N/A');
    assert.equal(formatVoltage(value), 'N/A');
  }

  // Non-finite provider output must not leak through as a number.
  assert.equal(formatTemperature(Number.NaN), 'N/A');
  assert.equal(formatWatts(Number.POSITIVE_INFINITY), 'N/A');
  assert.equal(formatClockGhz(0), 'N/A');
});

test('a real zero stays distinguishable from an unavailable sensor', () => {
  // 0% utilization is a legitimate reading and must not be shown as N/A.
  assert.equal(formatPercent(0), '0%');
  // 0 W / 0 RPM are reported by stalled hardware; they are values, not N/A.
  assert.equal(formatWatts(0), '0.0 W');
  assert.equal(formatRpm(0), '0 RPM');
});

test('CPU metrics use the documented units and precision', () => {
  assert.equal(formatTemperature(72.4), '72.4 °C');
  assert.equal(formatTemperature(100), '100 °C');
  assert.equal(formatPercent(98.4), '98%');
  assert.equal(formatClockGhz(4350), '4.35 GHz');
  assert.equal(formatWatts(84.2), '84.2 W');
  assert.equal(formatWatts(120.6), '121 W');
  assert.equal(formatRpm(1420), '1,420 RPM');
  assert.equal(formatVoltage(1.237), '1.24 V');
});

test('stress test never aborts a session because a sensor is missing', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  // The old implementation hard-stopped the run when temperature or power was
  // momentarily unavailable, which made Stress Test unusable on machines
  // without a CPU temperature provider.
  assert.doesNotMatch(stressTest, /Stress test stopped because temperature or power telemetry/);
  assert.doesNotMatch(stressTest, /Stress test requires CPU temperature and power telemetry/);
  assert.doesNotMatch(stressTest, /get_cpu_temp|get_cpu_power/);
});

test('stress telemetry charts the sensors independently of the pool API', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  // Charting used to require hashrate + temperature + power together, then it
  // required a hashrate alone. Either way a machine whose local pool API was
  // unreachable charted nothing, while its CPU sensors were reporting fine.
  assert.doesNotMatch(stressTest, /samples\.filter\(\(sample\) => isPositiveNumber\(sample\.hashrate\)\)/);
  assert.match(stressTest, /const chartData = useMemo/);
  assert.match(stressTest, /connectNulls=\{false\}/);

  // Sampling must not sit behind the hashrate poll, which returns early when the
  // pool does not answer: the sensor series is recorded on its own clock.
  assert.match(stressTest, /SAMPLE_INTERVAL_MS/);
  assert.match(stressTest, /session: startedAt !== null/);
});

test('every charted metric has its own visible, correctly scaled Y axis', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  // Three metrics in three different units, so three axes: forcing them onto a
  // shared scale, or hiding an axis, makes the lines unreadable.
  for (const axis of ['temp', 'clock', 'power']) {
    assert.match(
      stressTest,
      new RegExp(`<YAxis\\s+yAxisId="${axis}"(?![^>]*hide)`),
      `the ${axis} axis must be visible`
    );
  }
  assert.match(stressTest, /unit=" °C"/);
  assert.match(stressTest, /unit=" GHz"/);
  assert.match(stressTest, /unit=" W"/);
  // Each metric is its own line.
  for (const line of ['temp', 'clock_ghz', 'power']) {
    assert.match(stressTest, new RegExp(`<Line yAxisId="[a-z]+"[^>]*dataKey="${line}"`));
  }
});

test('the stress test layout is chart, then controls, then live metrics', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  // The order is the spec: the chart is read first, the controls act on it, and
  // the numbers being watched sit directly under them.
  const chart = stressTest.indexOf('title="Real-Time Monitoring"');
  const controls = stressTest.indexOf('data-testid="stress-controls"');
  const liveMetrics = stressTest.indexOf('data-testid="live-metrics"');
  assert.ok(chart > -1 && controls > -1 && liveMetrics > -1, 'all three sections must exist');
  assert.ok(chart < controls, 'the chart comes first');
  assert.ok(controls < liveMetrics, 'the controls come before the live metrics');

  // The three metrics the page must show while a test runs.
  for (const label of ['CPU Temperature', 'CPU Frequency', 'CPU Power']) {
    assert.ok(liveMetrics !== -1 && stressTest.includes(`label="${label}"`), `${label} must be shown`);
  }
});

test('live metrics never fall back to a stale or placeholder value', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  // A frozen number presented as live is worse than N/A, so the tiles read the
  // current reading and render N/A when telemetry is stale.
  assert.match(stressTest, /const live: CpuTelemetry \| null = cpuTelemetry\.stale \? null : cpuTelemetry\.telemetry/);
  assert.doesNotMatch(stressTest, /isActive && lastSample\?\.temp != null/);
  // The three required tiles read that reading, not a sample from the series.
  for (const field of ['live?.temperature_c', 'live?.clock_mhz', 'live?.package_power_w']) {
    assert.ok(stressTest.includes(field), `${field} must drive a live tile`);
  }
});

test('stress test consumes the shared 1 Hz telemetry monitor', () => {
  const stressTest = read('src/pages/StressTest.tsx');

  assert.ok(stressTest.includes('useCpuTelemetry()'), 'stress test must use the shared telemetry monitor');
  // The per-page CPU poll that re-fetched temperature and power every 3 seconds
  // is gone; only the P2Pool hashrate poll remains.
  assert.ok(
    !stressTest.includes('get_cpu_temp') && !stressTest.includes('get_cpu_power'),
    'stress test must not fetch CPU metrics directly'
  );
  assert.ok(
    stressTest.includes('const pollHashrate = async ()'),
    'the remaining poll must be the hashrate poll'
  );
});

test('telemetry polling cannot overlap and stops when unused', () => {
  const service = read('src/services/cpuTelemetry.ts');

  // Overlap guard plus recursive timeout, never setInterval.
  assert.match(service, /if \(this\.inFlight \|\| this\.disposed \|\| this\.listeners\.size === 0\)/);
  assert.match(service, /this\.inFlight = true/);
  assert.match(service, /setTimeout\(\(\) => \{/);
  assert.doesNotMatch(service, /setInterval/);
  // Unsubscribing the last consumer stops polling entirely.
  assert.match(service, /this\.listeners\.size === 0\) \{\s*this\.stop\(\);/);
  assert.match(service, /clearTimeout\(this\.timer\)/);
});

test('a transient failure keeps the last reading instead of blanking the UI', () => {
  const service = read('src/services/cpuTelemetry.ts');

  assert.match(service, /STALE_AFTER_FAILURES = 3/);
  assert.match(service, /stale: failures >= STALE_AFTER_FAILURES/);
  // The previous telemetry object is preserved across failures.
  assert.match(service, /this\.state = \{ \.\.\.this\.state, \.\.\.patch \}/);
});

test('rust backend probes real CPU temperature providers, not just the first sensor', () => {
  const rust = read('src-tauri/src/cpu_telemetry.rs');

  // Provider coverage for AMD and Intel hardware monitor software.
  assert.match(rust, /root\\LibreHardwareMonitor/);
  assert.match(rust, /root\\OpenHardwareMonitor/);
  assert.match(rust, /MSAcpi_ThermalZoneTemperature/);
  assert.match(rust, /HWiNFO64/);
  // AMD Tctl/Tdie and Intel package temperature are ranked above generic
  // sensors, and unrelated sensors are excluded outright.
  assert.match(rust, /tctl\/tdie/);
  assert.match(rust, /is_unrelated_sensor/);
  assert.match(rust, /"ssd", "nvme", "hdd", "drive", "gpu", "gddr", "vram", "battery", "chipset"/);
});

test('rust telemetry distinguishes unsupported sensors from real zeroes', () => {
  const rust = read('src-tauri/src/cpu_telemetry.rs');

  // Optional metrics are Option<T> and serialize as null.
  assert.match(rust, /pub temperature_c: Option<f64>/);
  assert.match(rust, /pub package_power_w: Option<f64>/);
  assert.match(rust, /pub fan_rpm: Option<f64>/);
  // Zero readings are rejected as "unavailable" rather than surfaced as 0 °C.
  assert.match(rust, /value > 0\.0 && \*value < MAX_TEMPERATURE_C/);
  assert.match(rust, /filter\(\|value\| \*value > 0\.0\)/);
});

test('rust sensor provider is cached and watchdogged instead of spawned per poll', () => {
  const rust = read('src-tauri/src/cpu_telemetry.rs');

  // One provider probe, cached, retried on a timer rather than every second.
  assert.match(rust, /const SENSOR_CACHE_TTL/);
  assert.match(rust, /const PROVIDER_RETRY_INTERVAL/);
  assert.match(rust, /const PROVIDER_TIMEOUT/);
  // A wedged provider is killed rather than blocking telemetry.
  assert.match(rust, /child\.kill\(\)/);
  // Utilization comes from a long-lived sysinfo handle, not a new System per call.
  assert.match(rust, /system: System,/);
});

test('per-core, throttling and clock fields are exposed to the UI', () => {
  const rust = read('src-tauri/src/cpu_telemetry.rs');
  const types = read('src/lib/cpu-telemetry.ts');

  assert.match(rust, /pub per_core: Vec<CoreTelemetry>/);
  assert.match(rust, /pub throttling: Option<bool>/);
  assert.match(rust, /Processor Performance/);
  assert.match(types, /export interface CoreTelemetry/);
  assert.match(types, /clock_mhz: number \| null/);
});

test('the privileged broker is shipped, probed first, and needs no approval', () => {
  const registration = read('src-tauri/resources/sensor-broker/register-broker-task.ps1');
  const broker = read('src-tauri/src/bin/sensor_broker.rs');
  const client = read('src-tauri/src/sensor_broker_client.rs');
  const chain = read('src-tauri/src/cpu_telemetry.rs');
  const tauriConfig = read('src-tauri/tauri.conf.json');
  const hooks = read('src-tauri/installer-hooks.nsh');

  // No PowerShell helper and no .NET monitoring stack may come back: the whole
  // point of the broker is that it talks to the driver directly from Rust.
  assert.doesNotMatch(client, /LibreHardwareMonitor|WindowsPowerShell|Add-Type/);
  assert.doesNotMatch(chain, /sensor_helper/);

  // The broker must read the exact register that carries AMD die temperature,
  // and honour the -49 C offset flag; without it the value is plausible but
  // wrong, which is worse than no value.
  assert.match(broker, /0x0005_9800/);
  assert.match(broker, /AMD_TEMP_OFFSET_FLAG/);
  assert.match(broker, /AMD_TEMP_OFFSET_MILLIDEGREES: i64 = 49_000/);
  assert.match(broker, /AMD_TEMP_FIELD_SHIFT: u32 = 21/);

  // The driver device has no DOS symlink, so it is opened by its NT path.
  assert.match(broker, /NtOpenFile/);
  assert.match(broker, /\\\\Device\\\\PawnIO/);
  // Output size must match the module's declaration exactly.
  assert.match(broker, /out_cells/);

  // Package power is a delta over time, so the register pair and the unit
  // decode both matter. A RAPL unit register keeps the energy unit in bits
  // [12:8]; reading the power unit in bits [3:0] instead inflated every delta
  // by 8192 and left package power permanently null on an AMD Ryzen.
  assert.match(broker, /AMD_MSR_PKG_ENERGY_STAT: u64 = 0xC001_029B/);
  assert.match(broker, /AMD_MSR_PWR_UNIT: u64 = 0xC001_0299/);
  assert.match(broker, /INTEL_MSR_RAPL_POWER_UNIT: u64 = 0x0000_0606/);
  assert.match(broker, /INTEL_MSR_PKG_ENERGY_STATUS: u64 = 0x0000_0611/);
  assert.match(broker, /\(unit >> 8\) & 0x1F/);
  // The sampling interval is measured, never assumed: a starved sampler slept
  // 1.4 s while asking for 120 ms, which reported 237 W for a 65 W package.
  assert.match(broker, /started\.elapsed\(\)\.as_secs_f64\(\)/);

  // The CPU fan needs a second bus entirely. Fan tachometers are not in MSR
  // space: they sit behind the LPC configuration port, so they need PawnIO's
  // LPC module and a second device handle.
  assert.match(broker, /LpcIO\.bin/);
  assert.match(broker, /Access_ISABUS\.HTP\.Method/);
  // Which tachometer input is the CPU header is a board routing decision no
  // register states, so the answer comes from the chip's own per-channel
  // Smart-Fan temperature source instead of from a channel index.
  assert.match(broker, /NCT_FAN_TEMP_SOURCE_REG/);
  assert.match(broker, /nct_is_cpu_temperature_source/);
  // Measured on this board: its curves follow the calibrated PECI source, which
  // the kernel marks undocumented, so the documented pair alone finds nothing.
  assert.match(broker, /2,  \/\/ CPUTIN/);
  assert.match(broker, /28, \/\/ PECI Agent 0 Calibration/);
  // The monitor registers are read through the index/data window, not the
  // configuration port: reading them through configuration space returns 0xFF.
  assert.match(broker, /HWM_INDEX_OFFSET: u64 = 0x05/);
  assert.match(broker, /HWM_DATA_OFFSET: u64 = 0x06/);
  assert.match(broker, /ioctl_find_bars/);
  // An input with nothing plugged in is not silent, so a floating header must
  // not be mistaken for a fan.
  assert.match(broker, /MAX_PLAUSIBLE_FAN_RPM: f64 = 8000\.0/);

  // Two registers carry the same speed in different encodings, and reading the
  // RPM register with the count decoder reported 3600 rpm for a fan running at
  // 2967. Both are read and required to agree before a speed is reported.
  assert.match(broker, /NCT_FAN_RPM_REG/);
  assert.match(broker, /NCT_FAN_COUNT_REG/);
  assert.match(broker, /fn nct_fan_rpm\(rpm_raw: u16, count_raw: Option<u16>\)/);
  assert.match(broker, /count_raw & 0xFF1F == 0xFF1F/);
  assert.match(broker, /a decoder that is wrong for one of them/);

  // Supporting one board is not supporting a platform: the whole NCT6779-and-
  // later family shares the layout, and parts that do not are refused.
  assert.match(broker, /const NCT_FAMILY/);
  assert.match(broker, /NCT_ID_MASK: u16 = 0xFFF8/);
  assert.match(broker, /fn nct_family_entry/);
  assert.match(broker, /\("NCT6779D", 5, false\)/);
  assert.match(broker, /\("NCT6799D", 7, false\)/);
  // The calibrated PECI sources are trusted only on the part whose label table
  // was verified: the tables differ between families, and reading those indices
  // elsewhere could bind a chassis header to the processor.
  assert.match(broker, /NCT6798D_CPU_TEMPERATURE_SOURCES/);
  assert.match(broker, /28, \/\/ PECI Agent 0 Calibration/);
  assert.match(broker, /verified_sources && NCT6798D_CPU_TEMPERATURE_SOURCES/);

  // Elevation happens once, through the installer, never per session.
  assert.match(registration, /RunLevel Highest/);
  assert.match(registration, /ValidateSet\('register', 'remove', 'status'\)/);
  assert.match(hooks, /NSIS_HOOK_POSTINSTALL/);
  assert.match(hooks, /NSIS_HOOK_PREUNINSTALL/);
  assert.match(client, /schtasks/);

  // The broker is the preferred provider, with fallbacks preserved.
  assert.match(chain, /snapshot_from_broker\(\)/);
  assert.match(chain, /BundledHelper => "bundled-helper"/);

  // It must actually be bundled, or the feature silently cannot ship.
  assert.match(tauriConfig, /"externalBin"/);
  assert.match(tauriConfig, /binaries\/minebench-sensor-broker/);
  assert.match(tauriConfig, /resources\/sensor-broker\/\*\*\/\*/);
});

test('broker snapshots are validated before they can supply telemetry', () => {
  const rust = read('src-tauri/src/sensor_broker_client.rs');

  // Schema mismatch, malformed JSON, stale files and empty readings must all
  // degrade to "unavailable" rather than to a fabricated zero.
  assert.match(rust, /fn is_usable\(&self\)/);
  assert.match(rust, /self\.schema == SCHEMA/);
  assert.match(rust, /pub fn has_readings\(&self\)/);
  assert.match(rust, /serde_json::from_str/);
  assert.match(rust, /SNAPSHOT_STALE_AFTER/);
  // A registered task pointing at a missing binary must be reported, since that
  // is the most likely field failure.
  assert.match(rust, /resolve_broker_path/);
});
