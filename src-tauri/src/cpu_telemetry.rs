//! Normalized CPU telemetry for Stress Test mode.
//!
//! Windows does not expose CPU die temperature through a single generic API:
//! ACPI thermal zones are frequently absent (verified on AMD Ryzen parts) and
//! `MSAcpi_ThermalZoneTemperature` is not a CPU sensor when it does exist.
//! Reliable readings require a driver-backed monitor (LibreHardwareMonitor,
//! OpenHardwareMonitor, HWiNFO) which the user may or may not be running.
//!
//! The design therefore separates metrics by how reliably they can be obtained:
//!
//! * **Always available** - model, core/thread counts, utilization, clocks
//!   (Windows PDH `\Processor Information(*)\% Processor Performance`).
//! * **Provider dependent** - temperature, package power, fan RPM, per-core
//!   temperature. These come from an optional hardware-monitor provider and are
//!   reported as `None` (rendered `N/A`) when genuinely unsupported, never as 0.
//!
//! Collection is cheap: `sysinfo` runs against one long-lived `System` handle,
//! clocks use reusable PDH query handles, and the optional provider is probed
//! once and then cached - no PowerShell process is spawned per update.

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use sysinfo::{CpuRefreshKind, RefreshKind, System};

#[cfg(any(target_os = "linux", test))]
use std::path::{Path, PathBuf};

/// Utilisation between two samples cannot be meaningful below this interval.
/// Matches `sysinfo::MINIMUM_CPU_UPDATE_INTERVAL`.
pub const SAMPLE_INTERVAL: Duration = Duration::from_millis(1000);

/// A provider is re-probed at most this often after it stops returning data.
const PROVIDER_RETRY_INTERVAL: Duration = Duration::from_secs(15);

/// Hardware sensor cache lifetime. The provider is a driver-backed WMI query
/// that costs hundreds of milliseconds, so it is re-read on this cadence rather
/// than on every 1 Hz poll; requests always read the cached snapshot.
const SENSOR_CACHE_TTL: Duration = Duration::from_millis(3000);

/// External provider probes are hard-killed after this long. A wedged WMI
/// provider must never be able to stall telemetry indefinitely.
const PROVIDER_TIMEOUT: Duration = Duration::from_secs(2);

const MAX_TEMPERATURE_C: f64 = 125.0;
const MAX_PLAUSIBLE_POWER_W: f64 = 1500.0;
const MIN_PLAUSIBLE_FAN_RPM: f64 = 200.0;
const MAX_PLAUSIBLE_FAN_RPM: f64 = 12000.0;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Which provider supplied the optional hardware sensors.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    /// MineBench's bundled elevated helper (LibreHardwareMonitor library +
    /// PawnIO driver). Preferred when the user has enabled it.
    BundledHelper,
    /// LibreHardwareMonitor / OpenHardwareMonitor WMI namespace.
    LibreHardwareMonitor,
    /// HWiNFO "Shared Memory Viewer" registry interface.
    HwinfoRegistry,
    /// ACPI thermal zone. Kept as a last resort and flagged unreliable: it is
    /// routinely a mainboard/chassis zone rather than the CPU die.
    AcpiThermalZone,
    /// Linux `Components` (hwmon) or RAPL.
    SysinfoComponents,
    /// Nothing usable was found.
    None,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::BundledHelper => "bundled-helper",
            Self::LibreHardwareMonitor => "libre-hardware-monitor",
            Self::HwinfoRegistry => "hwinfo-registry",
            Self::AcpiThermalZone => "acpi-thermal-zone",
            Self::SysinfoComponents => "sysinfo-components",
            Self::None => "none",
        }
    }

    /// Human readable label for the UI/logs.
    pub fn label(self) -> &'static str {
        match self {
            Self::BundledHelper => "MineBench sensor helper",
            Self::LibreHardwareMonitor => "LibreHardwareMonitor (WMI)",
            Self::HwinfoRegistry => "HWiNFO (registry)",
            Self::AcpiThermalZone => "ACPI thermal zone (unreliable)",
            Self::SysinfoComponents => "System components (hwmon)",
            Self::None => "unavailable",
        }
    }

    /// An ACPI thermal zone is not a trustworthy CPU temperature source.
    pub fn is_reliable_temperature(self) -> bool {
        matches!(
            self,
            Self::BundledHelper
                | Self::LibreHardwareMonitor
                | Self::HwinfoRegistry
                | Self::SysinfoComponents
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TelemetryStatus {
    /// No usable provider: optional sensors are unavailable, essentials work.
    Unavailable,
    /// A provider is supplying sensors.
    Ready,
    /// A provider exists but some expected sensors are missing.
    Degraded,
}

impl TelemetryStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unavailable => "unavailable",
            Self::Ready => "ready",
            Self::Degraded => "degraded",
        }
    }
}

/// Per-logical-CPU telemetry. Optional entries stay `None` when the provider
/// does not expose them.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct CoreTelemetry {
    pub index: usize,
    pub utilization_percent: Option<f32>,
    pub clock_mhz: Option<f64>,
    pub temperature_c: Option<f64>,
}

/// One raw sensor exactly as the provider reported it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawSensor {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "type", default)]
    pub sensor_type: String,
    /// Kept as a string because providers localize decimal separators.
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub min: Option<String>,
    #[serde(default)]
    pub max: Option<String>,
    #[serde(default)]
    pub unit: Option<String>,
    #[serde(default)]
    pub hardware: Option<String>,
    #[serde(default)]
    pub identifier: Option<String>,
}

impl RawSensor {
    fn value_f64(&self) -> Option<f64> {
        parse_provider_number(self.value.as_deref()?)
    }

    fn normalized_type(&self) -> String {
        self.sensor_type.trim().to_ascii_lowercase()
    }
}

/// Normalized CPU telemetry consumed by the frontend. Optional sensor fields
/// are `None` - never `0` - when the value genuinely cannot be retrieved.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuTelemetry {
    pub model: String,
    pub utilization_percent: Option<f32>,
    pub temperature_c: Option<f64>,
    pub package_temperature_c: Option<f64>,
    pub clock_mhz: Option<f64>,
    pub max_clock_mhz: Option<f64>,
    pub base_clock_mhz: Option<f64>,
    pub package_power_w: Option<f64>,
    pub fan_rpm: Option<f64>,
    pub physical_cores: Option<usize>,
    pub logical_cores: usize,
    pub voltage_v: Option<f64>,
    pub per_core: Vec<CoreTelemetry>,
    /// Effective clock is well below the part's maximum while utilization is
    /// high. Derived from real measurements, never fabricated.
    pub throttling: Option<bool>,
    pub temperature_source: Option<String>,
    pub power_source: Option<String>,
    pub fan_source: Option<String>,
    /// Power derived from TDP heuristics rather than a hardware sensor.
    pub power_is_estimated: bool,
    pub provider: String,
    pub provider_label: String,
    pub status: String,
    /// `windows`, `macos`, `linux`, ... - lets the UI give guidance that matches
    /// how this platform exposes sensors.
    pub platform: String,
    /// True when the provider can be trusted for CPU temperature.
    pub temperature_reliable: bool,
    pub timestamp: String,
    /// Non-fatal problems, e.g. `temperature` or `power`.
    pub missing: Vec<String>,
    /// Wall-clock cost of this collection, for verifying telemetry overhead.
    pub collection_ms: f64,
}

/// Full diagnostic dump: what MineBench sees versus what the provider reports.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuTelemetryDebug {
    pub cpu_model: String,
    pub logical_cores: usize,
    pub physical_cores: Option<usize>,
    pub provider: String,
    pub provider_label: String,
    pub provider_detail: String,
    pub temperature_reliable: bool,
    pub raw_sensors: Vec<RawSensor>,
    pub detected: serde_json::Value,
    pub normalized: CpuTelemetry,
    pub notes: Vec<String>,
    pub platform: String,
    /// Whether MineBench's bundled elevated sensor helper is supplying data.
    pub broker_state: String,
    pub broker_detail: String,
}

/// Cached hardware sensor result plus the provider that produced it.
#[derive(Debug, Clone)]
struct SensorSnapshot {
    provider: ProviderKind,
    sensors: Vec<RawSensor>,
    detail: String,
}

struct CachedProvider {
    /// Created on first use; the first probe runs inline so callers and
    /// diagnostics get complete data, later probes run on a detached thread.
    probe: Option<Arc<ProviderProbe>>,
}

impl CachedProvider {
    fn new() -> Self {
        Self { probe: None }
    }
    /// Returns the current snapshot without ever blocking on a probe.
    ///
    /// A driver-backed WMI query can take over a second while the CPU is busy,
    /// so every probe - including the first - runs on a detached thread and the
    /// result is published when it lands. The first telemetry responses report
    /// hardware sensors as unavailable until then; callers treat them as
    /// optional and the UI renders `N/A` instead of stalling.
    fn get(&mut self) -> Option<SensorSnapshot> {
        if self.probe.is_none() {
            self.probe = Some(Arc::new(ProviderProbe::new()));
        }
        let probe = self.probe.clone().expect("probe initialized above");
        let stale = {
            let inner = probe.inner.lock().unwrap_or_else(|error| error.into_inner());
            match inner.checked_at {
                None => true,
                Some(at) if inner.snapshot.is_some() => at.elapsed() >= SENSOR_CACHE_TTL,
                Some(at) => at.elapsed() >= PROVIDER_RETRY_INTERVAL,
            }
        };

        if stale && !*probe.probing.read().unwrap_or_else(|error| error.into_inner()) {
            self.spawn_probe(probe.clone());
        }

        let cached = {
            let inner = probe.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner.snapshot.clone()
        };
        cached
    }

    /// Waits briefly for an in-flight probe so diagnostics report real sensors
    /// instead of racing the first probe. Used by the debug command only, which
    /// the user triggers explicitly and which is never on the 1 Hz path.
    fn wait_for_probe(&self) -> Option<SensorSnapshot> {
        let probe = self.probe.as_ref()?.clone();
        let deadline = Instant::now() + PROVIDER_TIMEOUT;
        while Instant::now() < deadline {
            if !*probe.probing.read().unwrap_or_else(|error| error.into_inner()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let cached = {
            let inner = probe.inner.lock().unwrap_or_else(|error| error.into_inner());
            inner.snapshot.clone()
        };
        cached
    }

    /// Runs a probe on a detached thread, publishing the result when it lands.
    fn spawn_probe(&self, probe: Arc<ProviderProbe>) {
        *probe.probing.write().unwrap_or_else(|error| error.into_inner()) = true;
        std::thread::spawn(move || {
            let result = probe_hardware_sensors();
            store_probe_result(&probe, result);
            *probe.probing.write().unwrap_or_else(|error| error.into_inner()) = false;
        });
    }

    /// Diagnostic message from the most recent failed probe.
    fn last_error(&self) -> Option<String> {
        self.probe.as_ref().and_then(|probe| {
            probe
                .inner
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .last_error
                .clone()
        })
    }
}

/// Shared probe state, published across threads.
struct ProviderProbe {
    inner: Mutex<ProbeState>,
    probing: std::sync::RwLock<bool>,
}

impl ProviderProbe {
    fn new() -> Self {
        Self {
            inner: Mutex::new(ProbeState {
                snapshot: None,
                checked_at: None,
                last_error: None,
            }),
            probing: std::sync::RwLock::new(false),
        }
    }
}

#[derive(Default)]
struct ProbeState {
    snapshot: Option<SensorSnapshot>,
    checked_at: Option<Instant>,
    last_error: Option<String>,
}

/// Applies a probe result, leaving the previous snapshot in place when the new
/// probe found nothing so a flaky provider does not blank the UI.
fn store_probe_result(
    probe: &Arc<ProviderProbe>,
    result: Result<SensorSnapshot, String>,
) -> Option<SensorSnapshot> {
    let mut inner = probe.inner.lock().unwrap_or_else(|error| error.into_inner());
    match result {
        Ok(snapshot) if snapshot.provider != ProviderKind::None => {
            inner.last_error = None;
            inner.snapshot = Some(snapshot.clone());
            inner.checked_at = Some(Instant::now());
            Some(snapshot)
        }
        Ok(snapshot) => {
            inner.last_error = Some(snapshot.detail.clone());
            inner.snapshot = None;
            inner.checked_at = Some(Instant::now());
            None
        }
        Err(error) => {
            inner.last_error = Some(error);
            inner.snapshot = None;
            inner.checked_at = Some(Instant::now());
            None
        }
    }
}

/// Samples CPU utilization for every logical processor plus the total.
///
/// On Windows this uses PDH `% Processor Time`, which reports the delta since
/// the previous collection. Measured on a saturated 16-thread Ryzen 7 5700G it
/// costs ~0.3 ms, whereas `sysinfo`'s per-processor counter refresh costs
/// ~130 ms and `GetSystemTimes` ~32 ms under the same load - either of which
/// would make telemetry a measurable part of the stress test it is measuring.
struct UtilizationSource {
    #[cfg(target_os = "windows")]
    query: Option<WindowsUtilizationQuery>,
}

impl UtilizationSource {
    fn new() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                query: WindowsUtilizationQuery::new(),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self {}
        }
    }

    /// Returns `(total_percent, per_logical_cpu_percent)`.
    fn sample(&mut self, system: &mut System) -> (Option<f32>, Vec<Option<f32>>) {
        #[cfg(target_os = "windows")]
        {
            if let Some(query) = self.query.as_mut() {
                if let Some(sample) = query.sample() {
                    return sample;
                }
            }
        }

        // Fallback, and the only path off Windows: sysinfo.
        system.refresh_cpu_usage();
        let total = system.global_cpu_usage();
        let per_core = system
            .cpus()
            .iter()
            .map(|cpu| {
                let value = cpu.cpu_usage();
                value.is_finite().then(|| value.clamp(0.0, 100.0))
            })
            .collect();
        (
            total.is_finite().then(|| total.clamp(0.0, 100.0)),
            per_core,
        )
    }
}

/// Reusable PDH query holding the total and per-instance `% Processor Time`
/// counters.
#[cfg(target_os = "windows")]
struct WindowsUtilizationQuery {
    query: *mut core::ffi::c_void,
    total: *mut core::ffi::c_void,
    instances: *mut core::ffi::c_void,
}

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsUtilizationQuery {}

#[cfg(target_os = "windows")]
impl WindowsUtilizationQuery {
    fn new() -> Option<Self> {
        let mut query: *mut core::ffi::c_void = std::ptr::null_mut();
        // SAFETY: a null data source requests a local live query; the out
        // pointer is valid for the duration of the call.
        if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
            return None;
        }

        let total_path = wide(r"\Processor Information(_Total)\% Processor Time");
        let all_path = wide(r"\Processor Information(*)\% Processor Time");
        let mut total: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut instances: *mut core::ffi::c_void = std::ptr::null_mut();

        // SAFETY: `query` is live and both paths are NUL-terminated.
        let total_ok =
            unsafe { PdhAddEnglishCounterW(query, total_path.as_ptr(), 0, &mut total) } == 0;
        let instances_ok =
            unsafe { PdhAddEnglishCounterW(query, all_path.as_ptr(), 0, &mut instances) } == 0;

        if !total_ok && !instances_ok {
            // SAFETY: closing a query this function opened and will not return.
            unsafe { PdhCloseQuery(query) };
            return None;
        }

        // The first collection only establishes a baseline; deltas begin with
        // the next one. This call is cheap even under load.
        // SAFETY: `query` is live.
        unsafe { PdhCollectQueryData(query) };

        Some(Self {
            query,
            total: if total_ok { total } else { std::ptr::null_mut() },
            instances: if instances_ok {
                instances
            } else {
                std::ptr::null_mut()
            },
        })
    }

    fn sample(&self) -> Option<(Option<f32>, Vec<Option<f32>>)> {
        // SAFETY: `query` is live for the lifetime of this struct.
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return None;
        }

        let total = if self.total.is_null() {
            None
        } else {
            read_double(self.total, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100)
                .map(|value| value.clamp(0.0, 100.0) as f32)
        };

        let per_core = if self.instances.is_null() {
            Vec::new()
        } else {
            read_double_array(self.instances)
                .into_iter()
                .map(|value| value.map(|value| value.clamp(0.0, 100.0) as f32))
                .collect()
        };

        Some((total, per_core))
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsUtilizationQuery {
    fn drop(&mut self) {
        if !self.query.is_null() {
            // SAFETY: closing the query owned by this struct exactly once.
            unsafe { PdhCloseQuery(self.query) };
            self.query = std::ptr::null_mut();
        }
    }
}

/// Cached utilization snapshot, published by the background sampler.
///
/// Sampling is kept off the request path so a busy machine cannot stall a
/// telemetry request: the sampler publishes a snapshot, `collect` reads it.
#[derive(Debug, Clone, Default)]
struct UtilizationSnapshot {
    sequence: u64,
    global_percent: Option<f32>,
    per_core_percent: Vec<Option<f32>>,
}

/// Long-lived telemetry state: one sysinfo handle, one PDH query, one cached
/// provider probe. Sharing these is what keeps 1 Hz polling cheap.
pub struct CpuTelemetryCollector {
    system: System,
    utilization_source: UtilizationSource,
    utilization: Arc<Mutex<UtilizationSnapshot>>,
    provider: CachedProvider,
    /// Last time the frontend asked for telemetry (unix millis).
    last_request_ms: u64,
    /// Last emitted diagnostic signature, to log transitions exactly once.
    last_diag_signature: Option<String>,
    clock: ClockSource,
}

impl CpuTelemetryCollector {
    pub fn new() -> Self {
        let system = System::new_with_specifics(
            RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_cpu_usage()),
        );
        Self {
            system,
            utilization_source: UtilizationSource::new(),
            utilization: Arc::new(Mutex::new(UtilizationSnapshot::default())),
            provider: CachedProvider::new(),
            last_request_ms: 0,
            last_diag_signature: None,
            clock: ClockSource::new(),
        }
    }

    fn mark_request(&mut self) {
        self.last_request_ms = now_millis();
    }

    /// True while the frontend is actively consuming telemetry.
    fn is_active(&self) -> bool {
        now_millis().saturating_sub(self.last_request_ms) < 5_000
    }

    /// Samples utilization and publishes it for [`collect`] to read.
    ///
    /// This is the only place the sampling call runs, and it is always called
    /// from the background sampler thread - never from a request handler.
    fn refresh_utilization(&mut self) {
        let (global, per_core) = self.utilization_source.sample(&mut self.system);

        if let Ok(mut guard) = self.utilization.lock() {
            let sequence = guard.sequence;
            *guard = UtilizationSnapshot {
                sequence: sequence + 1,
                global_percent: global,
                per_core_percent: per_core,
            };
        }
    }

    fn utilization_snapshot(&self) -> UtilizationSnapshot {
        self.utilization
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_default()
    }
}

impl Default for CpuTelemetryCollector {
    fn default() -> Self {
        Self::new()
    }
}

fn now_millis() -> u64 {    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

static COLLECTOR: OnceLock<Arc<Mutex<CpuTelemetryCollector>>> = OnceLock::new();

/// Shared collector handle, created on first use.
pub fn collector() -> Arc<Mutex<CpuTelemetryCollector>> {
    COLLECTOR
        .get_or_init(|| Arc::new(Mutex::new(CpuTelemetryCollector::new())))
        .clone()
}

/// Starts the single background sampler. Idempotent.
///
/// The sampler keeps `sysinfo` deltas fresh (so the first `get_cpu_telemetry`
/// call already has a valid utilization delta) and idles down to cheap work
/// once the frontend stops asking, so leaving Stress Test stops the expensive
/// provider polling.
pub fn start_sampler(app: tauri::AppHandle) {
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }

    let state = collector();
    std::thread::spawn(move || loop {
        std::thread::sleep(SAMPLE_INTERVAL);

        // One utilization sample per interval keeps deltas valid for the first
        // request after a quiet period, and keeps the expensive Windows counter
        // read off the request path.
        let active = {
            let mut guard = match state.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            guard.refresh_utilization();
            guard.is_active()
        };

        if active {
            emit_diagnostics_if_changed(&app, &state);
        }
    });
}

fn emit_diagnostics_if_changed(
    app: &tauri::AppHandle,
    state: &Arc<Mutex<CpuTelemetryCollector>>,
) {
    use tauri::Emitter;

    let (signature, message) = {
        let mut guard = match state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let snapshot = guard.provider.get();
        let provider = snapshot
            .as_ref()
            .map(|snapshot| snapshot.provider)
            .unwrap_or(ProviderKind::None);
        let temperatures = snapshot
            .as_ref()
            .map(|snapshot| count_type(&snapshot.sensors, "temperature"))
            .unwrap_or(0);
        let signature = format!("{}:{}", provider.as_str(), temperatures);
        let message = format!(
            "CPU sensor provider: {} ({} temperature sensor(s))",
            provider.label(),
            temperatures
        );
        (signature, message)
    };

    let changed = {
        let mut guard = match state.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        if guard.last_diag_signature.as_deref() == Some(signature.as_str()) {
            false
        } else {
            guard.last_diag_signature = Some(signature);
            true
        }
    };

    if changed {
        // Emitted only on transitions, so logs never flood at 1 Hz.
        let _ = app.emit("cpu-telemetry-provider", &message);
        eprintln!("[cpu-telemetry] {message}");
    }
}

fn count_type(sensors: &[RawSensor], sensor_type: &str) -> usize {
    sensors
        .iter()
        .filter(|sensor| sensor.normalized_type() == sensor_type)
        .count()
}

/// Collects a normalized snapshot. Individual metric failures are isolated.
pub fn collect(collector: &mut CpuTelemetryCollector) -> CpuTelemetry {
    let started = Instant::now();
    collector.mark_request();
    // Utilization comes from the sampler's cached snapshot. Sampling here would
    // block for >100 ms on a saturated CPU and stall the request, so it is only
    // done once as a bootstrap when no sampler has published yet.
    let mut utilization_snapshot = collector.utilization_snapshot();
    if utilization_snapshot.sequence == 0 {
        collector.refresh_utilization();
        utilization_snapshot = collector.utilization_snapshot();
    }

    let cpus = collector.system.cpus();
    let logical_cores = cpus.len().max(1);
    let utilization = utilization_snapshot.global_percent;
    let per_core_usage: Vec<Option<f32>> = utilization_snapshot.per_core_percent;

    let model = cpus
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|brand| !brand.is_empty())
        .unwrap_or_else(|| "Unknown CPU".to_string());

    // Physical cores, maximum clock and base clock all come from the same
    // device query; if it fails the affected fields stay `None`.
    let clock_info = collector.clock.read();
    let maximum_clock = clock_info.max_mhz;
    let base_clock = clock_info.base_mhz;

    let effective_clock = resolve_effective_clock(
        maximum_clock,
        clock_info.performance_percent,
        &clock_info.per_core_performance,
    );

    let snapshot = collector.provider.get();
    let provider = snapshot
        .as_ref()
        .map(|snapshot| snapshot.provider)
        .unwrap_or(ProviderKind::None);
    let sensors: &[RawSensor] = snapshot
        .as_ref()
        .map(|snapshot| snapshot.sensors.as_slice())
        .unwrap_or(&[]);

    let temperature_match = select_cpu_temperature_sensor(sensors);
    let temperature = temperature_match.as_ref().map(|(_, value)| *value);
    let package_temperature = select_package_temperature(sensors);
    let sensor_power = select_cpu_power(sensors);
    let fan = select_cpu_fan(sensors);
    let voltage = select_cpu_voltage(sensors);
    let per_core_temperature = select_per_core_temperatures(sensors, logical_cores);

    // No hardware power sensor: fall back to a bounded TDP model. Flagged as
    // estimated so the UI never presents it as a measurement.
    let power = sensor_power.or_else(|| {
        estimate_cpu_power_watts(collector, &model, logical_cores)
            .map(|value| (value, "estimated:cpu-utilization-tdp".to_string()))
    });

    let mut missing = Vec::new();
    if temperature.is_none() {
        missing.push("temperature".to_string());
    }
    if power.is_none() {
        missing.push("power".to_string());
    }
    if fan.is_none() {
        missing.push("fan".to_string());
    }

    let mut per_core: Vec<CoreTelemetry> = (0..logical_cores)
        .map(|index| CoreTelemetry {
            index,
            utilization_percent: per_core_usage.get(index).copied().flatten(),
            clock_mhz: clock_info
                .per_core_clock_mhz
                .get(index)
                .copied()
                .flatten()
                .or(effective_clock),
            temperature_c: per_core_temperature.get(index).copied().flatten(),
        })
        .collect();

    // A provider may report fewer per-core sensors than there are threads.
    for (index, value) in per_core_temperature.iter().enumerate() {
        if let Some(core) = per_core.get_mut(index) {
            if core.temperature_c.is_none() {
                core.temperature_c = *value;
            }
        }
    }

    let temperature_reliable = provider.is_reliable_temperature() && temperature.is_some();
    let power_is_estimated = power
        .as_ref()
        .map(|(_, source)| source.starts_with("estimated:"))
        .unwrap_or(false);

    let status = match (provider, temperature.is_some() || power.is_some()) {
        (ProviderKind::None, _) => TelemetryStatus::Unavailable,
        (_, false) => TelemetryStatus::Degraded,
        (_, true) if temperature.is_none() || fan.is_none() => TelemetryStatus::Degraded,
        _ => TelemetryStatus::Ready,
    };

    let total_ms = started.elapsed().as_secs_f64() * 1000.0;

    CpuTelemetry {
        model,
        utilization_percent: utilization,
        temperature_c: temperature,
        package_temperature_c: package_temperature,
        clock_mhz: effective_clock,
        max_clock_mhz: maximum_clock,
        base_clock_mhz: base_clock,
        package_power_w: power.as_ref().map(|(value, _)| *value),
        fan_rpm: fan.as_ref().map(|(value, _)| *value),
        physical_cores: clock_info.physical_cores,
        logical_cores,
        voltage_v: voltage,
        throttling: derive_throttling(utilization, effective_clock, maximum_clock),
        per_core,
        temperature_source: temperature_match.map(|(name, _)| name),
        power_source: power.as_ref().map(|(_, source)| source.clone()),
        fan_source: fan.as_ref().map(|(_, source)| source.clone()),
        power_is_estimated,
        provider: provider.as_str().to_string(),
        provider_label: provider.label().to_string(),
        status: status.as_str().to_string(),
        platform: std::env::consts::OS.to_string(),
        temperature_reliable,
        timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        missing,
        collection_ms: total_ms,
    }
}

/// Builds the diagnostic dump used to debug missing sensors on other PCs.
pub fn collect_debug(collector: &mut CpuTelemetryCollector) -> CpuTelemetryDebug {
    // Give an in-flight probe a moment so the report reflects reality rather
    // than racing the very first probe on a cold start.
    let _ = collector.provider.get();
    let _ = collector.provider.wait_for_probe();
    let normalized = collect(collector);
    let snapshot = collector.provider.get();

    let mut notes = Vec::new();
    let (provider, sensors, detail) = match snapshot {
        Some(snapshot) => (snapshot.provider, snapshot.sensors, snapshot.detail),
        None => {
            if let Some(error) = collector.provider.last_error() {
                notes.push(error);
            }
            (ProviderKind::None, Vec::new(), String::new())
        }
    };

    let broker_detail = crate::sensor_broker_client::diagnostic_detail();

    if provider == ProviderKind::AcpiThermalZone {
        notes.push(
            "ACPI thermal zones are an approximation and are often a mainboard zone rather than the CPU die."
                .to_string(),
        );
    }
    if provider == ProviderKind::None && cfg!(target_os = "windows") {
        notes.push(
            "No CPU temperature provider detected on Windows. MineBench reads it through a WHQL-signed kernel driver; the scheduled task that grants access is registered by the installer."
                .to_string(),
        );
    }

    let detected = serde_json::json!({
        "temperature_c": normalized.temperature_c,
        "package_temperature_c": normalized.package_temperature_c,
        "package_power_w": normalized.package_power_w,
        "fan_rpm": normalized.fan_rpm,
        "clock_mhz": normalized.clock_mhz,
        "max_clock_mhz": normalized.max_clock_mhz,
        "utilization_percent": normalized.utilization_percent,
        "sources": {
            "temperature": normalized.temperature_source,
            "power": normalized.power_source,
            "fan": normalized.fan_source,
        },
        "missing": normalized.missing,
    });

    CpuTelemetryDebug {
        cpu_model: normalized.model.clone(),
        logical_cores: normalized.logical_cores,
        physical_cores: normalized.physical_cores,
        provider: provider.as_str().to_string(),
        provider_label: provider.label().to_string(),
        provider_detail: detail,
        temperature_reliable: provider.is_reliable_temperature(),
        raw_sensors: sensors,
        detected,
        normalized,
        notes,
        platform: std::env::consts::OS.to_string(),
        broker_state: if crate::sensor_broker_client::task_registered() {
            "task-registered".to_string()
        } else {
            "task-absent".to_string()
        },
        broker_detail,
    }
}

/// Probes every known provider once and reports what is available.
fn probe_hardware_sensors() -> Result<SensorSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        probe_windows_sensors()
    }

    #[cfg(not(target_os = "windows"))]
    {
        probe_hardware_sensors_impl()
    }
}

// ---------------------------------------------------------------------------
// Sensor selection
// ---------------------------------------------------------------------------

/// Picks the most useful CPU temperature. Never falls back to "the first
/// temperature sensor": mainboard, chipset, VRM and SSD sensors are excluded.
#[cfg(test)]
pub fn select_cpu_temperature(sensors: &[RawSensor]) -> Option<f64> {
    select_cpu_temperature_sensor(sensors).map(|(_, value)| value)
}

/// Same selection, but also returns the sensor name for diagnostics.
pub fn select_cpu_temperature_sensor(sensors: &[RawSensor]) -> Option<(String, f64)> {
    let temperatures: Vec<(usize, &RawSensor, f64)> = sensors
        .iter()
        .enumerate()
        .filter(|(_, sensor)| is_temperature_sensor(sensor))
        .filter_map(|(index, sensor)| {
            sensor
                .value_f64()
                .filter(|value| *value > 0.0 && *value < MAX_TEMPERATURE_C)
                .map(|value| (index, sensor, value))
        })
        .collect();

    if temperatures.is_empty() {
        return None;
    }

    temperatures
        .iter()
        .min_by_key(|(index, sensor, _)| temperature_rank(sensor, *index))
        // Rank 100+ means nothing matched a CPU sensor name; report nothing
        // rather than surfacing a mainboard/SSD temperature as CPU temperature.
        .filter(|(index, sensor, _)| temperature_rank(sensor, *index) < 100)
        .map(|(_, sensor, value)| (sensor.name.trim().to_string(), *value))
}

/// Package/die temperature specifically, when the provider exposes one.
pub fn select_package_temperature(sensors: &[RawSensor]) -> Option<f64> {
    sensors
        .iter()
        .filter(|sensor| is_temperature_sensor(sensor))
        .filter(|sensor| {
            let name = sensor_name(sensor);
            name.contains("package")
                || name.contains("tctl")
                || name.contains("tdie")
                || name.contains("cpu die")
                || name.contains("die average")
        })
        .filter_map(|sensor| sensor.value_f64())
        .find(|value| *value > 0.0 && *value < MAX_TEMPERATURE_C)
}

/// Fan RPM, only when the label identifies it as a CPU/processor fan.
///
/// The second value is where the reading came from. For the native broker that
/// is the fan channel and the temperature source its curve follows, because the
/// app attributes a fan to the CPU without a vendor header map to lean on: how
/// it decided has to be visible, not implied.
pub fn select_cpu_fan(sensors: &[RawSensor]) -> Option<(f64, String)> {
    let fans: Vec<(usize, &RawSensor, f64)> = sensors
        .iter()
        .enumerate()
        .filter(|(_, sensor)| is_fan_sensor(sensor))
        .filter_map(|(index, sensor)| {
            let value = sensor.value_f64()?;
            if !(MIN_PLAUSIBLE_FAN_RPM..=MAX_PLAUSIBLE_FAN_RPM).contains(&value) {
                return None;
            }
            if let Some(unit) = sensor.unit.as_deref() {
                let unit = unit.to_ascii_lowercase();
                if unit.contains('%') || unit.contains("percent") {
                    return None;
                }
            }
            Some((index, sensor, value))
        })
        .collect();

    fans.iter()
        .min_by_key(|(index, sensor, _)| fan_rank(sensor, *index))
        .filter(|(_, sensor, _)| fan_rank(sensor, 0) < 100)
        .map(|(_, sensor, value)| {
            let source = sensor
                .identifier
                .as_deref()
                .map(str::trim)
                .filter(|identifier| !identifier.is_empty() && *identifier != "sensor-broker")
                .map(str::to_string)
                .unwrap_or_else(|| format!("sensor:{}", sensor_name(sensor)));
            (*value, source)
        })
}

/// Package power in watts, plus the source label used for diagnostics.
pub fn select_cpu_power(sensors: &[RawSensor]) -> Option<(f64, String)> {
    let powers: Vec<(usize, &RawSensor, f64)> = sensors
        .iter()
        .enumerate()
        .filter(|(_, sensor)| is_power_sensor(sensor))
        .filter_map(|(index, sensor)| {
            let value = sensor.value_f64()?;
            if !(value > 0.0 && value < MAX_PLAUSIBLE_POWER_W) {
                return None;
            }
            Some((index, sensor, value))
        })
        .collect();

    powers
        .iter()
        .min_by_key(|(index, sensor, _)| power_rank(sensor, *index))
        .filter(|(index, sensor, _)| power_rank(sensor, *index) < 100)
        .map(|(_, sensor, value)| (*value, format!("sensor:{}", sensor_name(sensor))))
}

/// CPU core voltage, preferring the CPU's own sensor over a board reading.
///
/// On a real ASUS B550M-A the CPU device reports `Core (SVI2 TFN)` while the
/// SuperIO reports `Vcore`; both look like CPU voltage by name, but only the
/// SVI2 reading comes from the processor. Ranking by name alone would pick the
/// board's value, so the device the sensor belongs to is part of the ranking.
pub fn select_cpu_voltage(sensors: &[RawSensor]) -> Option<f64> {
    const VOLTAGE_DEVICE: [&str; 6] = ["ryzen", "intel", "core i", "xeon", "epyc", "apple m"];
    const BOARD_DEVICE: [&str; 8] = [
        "nuvoton", "ite ", "winbond", "fintek", "asrock", "asus", "gigabyte", "msi",
    ];

    let candidates: Vec<(usize, &RawSensor, f64)> = sensors
        .iter()
        .enumerate()
        .filter(|(_, sensor)| is_voltage_sensor(sensor))
        .filter(|(_, sensor)| {
            let name = sensor_name(sensor);
            name.contains("cpu") || name.contains("core") || name.contains("svi2")
        })
        .filter_map(|(index, sensor)| {
            sensor
                .value_f64()
                .filter(|value| *value > 0.2 && *value < 2.0)
                .map(|value| (index, sensor, value))
        })
        .collect();

    // A mainboard SuperIO ranks last, so it is only reported when the CPU
    // exposes no voltage reading of its own.
    candidates
        .iter()
        .min_by_key(|&(index, sensor, _)| {
            let hardware = sensor
                .hardware
                .as_deref()
                .unwrap_or_default()
                .to_ascii_lowercase();
            let name = sensor.name.to_ascii_lowercase();

            // SVI2/TFN telemetry is the CPU's own voltage rail.
            if name.contains("svi2") || name.contains("tfn") {
                return 0;
            }
            // The processor's device outranks a mainboard SuperIO.
            if VOLTAGE_DEVICE.iter().any(|needle| hardware.contains(needle)) {
                return 1 + index;
            }
            if BOARD_DEVICE.iter().any(|needle| hardware.contains(needle)) {
                return 200 + index;
            }
            // Unknown device: usable, but behind the two above.
            100 + index
        })
        .map(|(_, _, value)| *value)
}

/// Per-core temperatures in logical-core order (CCD sensors expanded).
pub fn select_per_core_temperatures(sensors: &[RawSensor], logical_cores: usize) -> Vec<Option<f64>> {
    let mut cores: Vec<Option<f64>> = Vec::new();
    let mut ccd: Vec<f64> = Vec::new();

    for sensor in sensors {
        if !is_temperature_sensor(sensor) {
            continue;
        }
        let name = sensor_name(sensor);
        let Some(value) = sensor
            .value_f64()
            .filter(|value| *value > 0.0 && *value < MAX_TEMPERATURE_C)
        else {
            continue;
        };

        if let Some(index) = extract_core_index(&name) {
            while cores.len() <= index {
                cores.push(None);
            }
            cores[index] = Some(value);
        } else if name.contains("ccd") && !name.contains("max") {
            ccd.push(value);
        }
    }

    // Fan out CCD averages across the logical cores they cover.
    if cores.is_empty() && !ccd.is_empty() {
        let average = ccd.iter().sum::<f64>() / ccd.len() as f64;
        return vec![Some(average); logical_cores];
    }

    cores.resize(logical_cores, None);
    cores.truncate(logical_cores);
    cores
}

fn sensor_name(sensor: &RawSensor) -> String {
    let mut name = sensor.name.trim().to_ascii_lowercase();
    if let Some(hardware) = sensor.hardware.as_deref() {
        name.push(' ');
        name.push_str(&hardware.trim().to_ascii_lowercase());
    }
    name
}

fn is_temperature_sensor(sensor: &RawSensor) -> bool {
    let sensor_type = sensor.normalized_type();
    // LibreHardwareMonitor reports "Temperature"; labels exist in other
    // providers where only the sensor name is descriptive.
    sensor_type.contains("temperature")
        || sensor_type.contains("temp")
        || sensor_type.is_empty()
}

fn is_fan_sensor(sensor: &RawSensor) -> bool {
    let sensor_type = sensor.normalized_type();
    sensor_type.contains("fan") || sensor_type.contains("control")
}

fn is_power_sensor(sensor: &RawSensor) -> bool {
    let sensor_type = sensor.normalized_type();
    sensor_type.contains("power") || sensor_type.contains("wattage")
}

fn is_voltage_sensor(sensor: &RawSensor) -> bool {
    let sensor_type = sensor.normalized_type();
    sensor_type.contains("voltage") || sensor_type.contains("volt")
}

/// Rejects sensors that clearly belong to another component.
///
/// The sensor label is authoritative first: a GPU or drive sensor is not a CPU
/// sensor even when the device also contains the word "cpu" (e.g. "GPU Package"
/// on a machine whose device name is "AMD Ryzen..."). The device name is then
/// used to classify sensors with generic labels such as "Temperature".
fn is_unrelated_sensor(sensor: &RawSensor) -> bool {
    const UNRELATED: [&str; 14] = [
        "ssd", "nvme", "hdd", "drive", "gpu", "gddr", "vram", "battery", "chipset", "pch", "vrm",
        "motherboard", "system", "ambient",
    ];
    const CPU_DEVICE: [&str; 10] = [
        "cpu",
        "processor",
        "ryzen",
        "threadripper",
        "epyc",
        "intel",
        "core i",
        "xeon",
        "athlon",
        "apple m",
    ];

    let name = sensor.name.trim().to_ascii_lowercase();
    if UNRELATED.iter().any(|needle| name.contains(needle)) {
        return true;
    }

    if let Some(hardware) = sensor.hardware.as_deref() {
        let hardware = hardware.trim().to_ascii_lowercase();
        if !hardware.is_empty() && CPU_DEVICE.iter().any(|needle| hardware.contains(needle)) {
            return false;
        }
    }

    false
}

/// Lower is better. `>= 100` means "not a CPU sensor".
fn temperature_rank(sensor: &RawSensor, index: usize) -> usize {
    let name = sensor_name(sensor);
    if is_unrelated_sensor(sensor) {
        return 200 + index;
    }

    // AMD Ryzen exposes Tctl/Tdie; these are the die temperature.
    if name.contains("tctl/tdie") || name.contains("tctl") || name.contains("tdie") {
        return 0;
    }
    if name.contains("cpu package") || name.contains("package") {
        return 1;
    }
    if name.contains("cpu die") || name.contains("die average") || name.contains("die") {
        return 2;
    }
    if name.contains("core average") || name.contains("core max") {
        return 3;
    }
    if name.contains("cpu") && name.contains("temp") {
        return 4;
    }
    if name.contains("cpu") {
        return 5;
    }
    if name.contains("core") {
        return 6;
    }
    // Unnamed/ambiguous temperature: acceptable only if nothing else exists,
    // but never when it belongs to another component.
    100 + index
}

fn fan_rank(sensor: &RawSensor, index: usize) -> usize {
    let name = sensor_name(sensor);
    let hardware = sensor
        .hardware
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let is_cpu_fan = name.contains("cpu_fan")
        || name.contains("cpu fan")
        || name.contains("processor fan")
        || name.contains("cpu fan")
        || (hardware.contains("cpu") && name.contains("fan"));

    if is_cpu_fan {
        0
    } else {
        100 + index
    }
}

fn power_rank(sensor: &RawSensor, index: usize) -> usize {
    let name = sensor_name(sensor);
    if is_unrelated_sensor(sensor) {
        return 200 + index;
    }
    if name.contains("cpu package") || name.contains("package") {
        return 0;
    }
    if name.contains("cpu cores") || name.contains("cores") {
        return 1;
    }
    if name.contains("ppt") || name.contains("cpu power") || name.contains("processor") {
        return 2;
    }
    if name.contains("cpu") {
        return 3;
    }
    100 + index
}

fn extract_core_index(name: &str) -> Option<usize> {
    let normalized = name.replace("cpu core", "core");
    let (_, rest) = normalized.split_once("core")?;
    if rest.contains("max") || rest.contains("average") || rest.contains("distance") {
        return None;
    }
    let digits: String = rest
        .trim_start_matches(['#', ' ', '_'])
        .chars()
        .take_while(|character| character.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    let index: usize = digits.parse().ok()?;
    // Guard against unrelated numbering (e.g. "Distance to TjMax 3").
    let rest_after = &rest[digits.len()..];
    if rest_after.contains("distance") || rest_after.contains("tjmax") {
        return None;
    }
    // Providers label cores 1-based ("CPU Core #1"); the vector is 0-based.
    Some(index.saturating_sub(1))
}

/// Effective clock = maximum clock scaled by measured processor performance.
fn resolve_effective_clock(
    max_mhz: Option<f64>,
    performance_percent: Option<f64>,
    per_core_performance: &[Option<f64>],
) -> Option<f64> {
    let maximum = max_mhz?;
    if let Some(percent) = performance_percent.filter(|value| *value > 0.0) {
        return Some(maximum * percent / 100.0);
    }
    if per_core_performance.iter().any(|value| value.is_some()) {
        let values: Vec<f64> = per_core_performance.iter().flatten().copied().collect();
        if !values.is_empty() {
            let average = values.iter().sum::<f64>() / values.len() as f64;
            return Some(maximum * average / 100.0);
        }
    }
    None
}

/// Throttling is only claimed when utilization is high, the clock is measured,
/// and it sits well below the part's maximum.
fn derive_throttling(
    utilization: Option<f32>,
    effective_clock: Option<f64>,
    max_clock: Option<f64>,
) -> Option<bool> {
    let utilization = utilization?;
    let effective = effective_clock?;
    let maximum = max_clock?;
    if maximum <= 0.0 {
        return None;
    }
    if utilization < 80.0 {
        return Some(false);
    }
    Some(effective / maximum < 0.85)
}

/// Estimates CPU package power from utilization when no sensor is available.
///
/// This is a model, not a measurement. It reuses the collector's live sample so
/// it does not perturb the utilization delta, and it scales the whole estimate
/// by the measured utilisation so idle CPUs do not report near-TDP draws. The
/// result is always flagged as `estimated` in [`CpuTelemetry::power_source`].
fn estimate_cpu_power_watts(
    collector: &CpuTelemetryCollector,
    brand: &str,
    core_count: usize,
) -> Option<f64> {
    let usage = collector.system.global_cpu_usage();
    if !usage.is_finite() {
        return None;
    }
    let usage = (usage.clamp(0.0, 100.0) as f64) / 100.0;
    let tdp = estimate_cpu_tdp_watts(&brand.to_ascii_lowercase(), core_count);
    if !(tdp.is_finite() && tdp > 0.0) {
        return None;
    }

    // Full estimate is `idle + dynamic * usage^1.25`, then scaled by measured
    // utilisation so a mostly idle CPU is not reported at its full TDP.
    let idle = (tdp * 0.12).max(3.0);
    let dynamic = (tdp - idle).max(1.0) * usage.powf(1.25);
    let estimate = idle + dynamic * usage;
    Some(estimate.clamp(1.0, MAX_PLAUSIBLE_POWER_W))
}

/// Rough TDP from the brand string and core count. Used only when the platform
/// exposes no power sensor; the value is always labelled as an estimate.
///
/// Mobile parts are recognised by their trailing model suffix (U, H, HQ, HS,
/// G7...) rather than by substring guessing, which previously misclassified
/// e.g. "i7-1165G7" as a desktop chip.
pub fn estimate_cpu_tdp_watts(brand: &str, core_count: usize) -> f64 {
    let is_mobile = brand.contains("mobile")
        || brand.contains("laptop")
        || brand.contains("notebook")
        || has_mobile_model_suffix(brand);

    if is_mobile {
        return if core_count >= 16 {
            45.0
        } else if core_count >= 8 {
            28.0
        } else {
            15.0
        };
    }

    if brand.contains("threadripper") || brand.contains("xeon") || brand.contains("epyc") {
        return 180.0;
    }

    if brand.contains("ryzen 9") || brand.contains("core(tm) i9") || brand.contains("core i9") {
        return 125.0;
    }

    if brand.contains("ryzen 7") || brand.contains("core(tm) i7") || brand.contains("core i7") {
        return 105.0;
    }

    if core_count >= 16 {
        125.0
    } else if core_count >= 8 {
        65.0
    } else {
        45.0
    }
}

/// Trailing model suffix of a CPU brand string, e.g. `u` for "Ryzen 5 4600U"
/// or `h` for "Core i7-9750H".
/// Detects a mobile CPU from its model suffix.
///
/// The suffix ends the model token ("i7-9750H", "4600U", "1165G7") but that
/// token is not necessarily the last whitespace-separated one, so each token
/// that looks like a model number is checked against the known mobile suffixes.
/// Only numeric-suffix matches count, which keeps desktop parts such as
/// "Ryzen 7 5700G" or "Ryzen 5 2400G" classified as desktop.
fn has_mobile_model_suffix(brand: &str) -> bool {
    const MOBILE_SUFFIXES: [&str; 12] = [
        "u", "h", "hq", "hk", "hs", "y", "g7", "g4", "g1", "um", "mq", "hx",
    ];

    brand.split_whitespace().any(|token| {
        let candidate = token.rsplit('-').next().unwrap_or(token);
        let has_digit = candidate.chars().any(|character| character.is_ascii_digit());
        let has_alpha = candidate.chars().any(|character| character.is_ascii_alphabetic());
        // Model tokens mix letters and digits ("9750H", "4600U", "1165G7"); this
        // skips brand words ("Intel(R)", "Ryzen") and unit tokens ("GHz").
        if !has_digit || !has_alpha || candidate.len() > 6 {
            return false;
        }

        // The suffix is the trailing letter run after the model digits:
        // "9750H" -> "h", "1165G7" -> "g7", "5700G" -> "g".
        let suffix: String = candidate
            .trim_start_matches(|character: char| character.is_ascii_digit() || character == '_')
            .to_ascii_lowercase();
        !suffix.is_empty() && MOBILE_SUFFIXES.contains(&suffix.as_str())
    })
}

/// Parses provider numbers without assuming the invariant culture.
pub fn parse_provider_number(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut cleaned: String = trimmed
        .chars()
        .filter(|character| character.is_ascii_digit() || matches!(character, '.' | ',' | '-' | '+'))
        .collect();

    if cleaned.is_empty() {
        return None;
    }

    // "1,420" / "4,35" - a lone comma is a decimal separator for providers that
    // format with a comma decimal mark, and a group separator otherwise.
    if cleaned.contains(',') && !cleaned.contains('.') {
        let segments: Vec<&str> = cleaned.split(',').collect();
        cleaned = if segments.len() == 2 && segments[1].len() != 3 {
            format!("{}.{}", segments[0], segments[1])
        } else {
            cleaned.replace(',', "")
        };
    } else {
        cleaned = cleaned.replace(',', "");
    }

    cleaned.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// Maximum clock, base clock, physical cores and PDH performance counters.
struct ClockSource {
    #[cfg(target_os = "windows")]
    pdh: Option<WindowsPdh>,
}

/// Device-level clock information, refreshed on a slow cadence.
#[derive(Debug, Clone, Default)]
struct ClockInfo {
    physical_cores: Option<usize>,
    max_mhz: Option<f64>,
    base_mhz: Option<f64>,
    performance_percent: Option<f64>,
    per_core_performance: Vec<Option<f64>>,
    per_core_clock_mhz: Vec<Option<f64>>,
}

impl ClockSource {
    fn new() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self {
                pdh: WindowsPdh::new(),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self {}
        }
    }

    /// Device information is static per process; PDH counters are queried live.
    fn read(&mut self) -> ClockInfo {
        let mut info = device_info();

        #[cfg(target_os = "windows")]
        {
            if let Some(pdh) = self.pdh.as_mut() {
                let sample = pdh.sample();
                if sample.performance_percent.is_some() {
                    info.performance_percent = sample.performance_percent;
                    info.per_core_performance = sample.per_core_performance;
                }
                if info.max_mhz.is_none() {
                    info.max_mhz = sample.max_frequency_mhz;
                }
            }
        }

        // Last resort for the part's maximum clock: the sensor provider knows it
        // even when the power-management counters are unavailable.
        if info.max_mhz.is_none() {
            info.max_mhz = broker_max_clock_mhz();
        }

        let maximum = info.max_mhz;
        info.per_core_clock_mhz = info
            .per_core_performance
            .iter()
            .map(|percent| match (maximum, percent) {
                (Some(maximum), Some(percent)) if *percent > 0.0 => Some(maximum * percent / 100.0),
                _ => None,
            })
            .collect();

        info
    }
}

/// Maximum clock reported by the bundled helper, when it is running.
#[cfg(target_os = "windows")]
/// The broker does not report a maximum clock, so this stays `None` on Windows
/// and the device query remains the source of truth.
#[cfg(target_os = "windows")]
fn broker_max_clock_mhz() -> Option<f64> {
    None
}

#[cfg(not(target_os = "windows"))]
fn broker_max_clock_mhz() -> Option<f64> {
    None
}

/// Physical core count, base and maximum clock from the CPU device node.
///
/// Registry values are static, so this is read once per process.
#[cfg(target_os = "windows")]
fn device_info() -> ClockInfo {
    use std::sync::OnceLock;
    static CACHE: OnceLock<ClockInfo> = OnceLock::new();
    CACHE.get_or_init(read_device_info_windows).clone()
}

#[cfg(not(target_os = "windows"))]
fn device_info() -> ClockInfo {
    use std::sync::OnceLock;
    static CACHE: OnceLock<ClockInfo> = OnceLock::new();
    CACHE
        .get_or_init(|| {
            let system = System::new_with_specifics(
                RefreshKind::nothing().with_cpu(CpuRefreshKind::nothing().with_frequency()),
            );
            let frequency = system
                .cpus()
                .first()
                .map(|cpu| cpu.frequency() as f64)
                .filter(|value| *value > 0.0);
            ClockInfo {
                physical_cores: None,
                max_mhz: frequency,
                base_mhz: frequency,
                ..ClockInfo::default()
            }
        })
        .clone()
}

#[cfg(target_os = "windows")]
fn read_device_info_windows() -> ClockInfo {
    let mut info = ClockInfo::default();

    // powrprof exposes per-processor MHz, including the maximum for the part.
    if let Some(power) = read_processor_power_information() {
        info.physical_cores = Some(power.len());
        let maximum = power.iter().map(|entry| entry.max_mhz).max().unwrap_or(0) as f64;
        if maximum > 0.0 {
            info.max_mhz = Some(maximum);
        }
    }

    // `~MHz` is the rated base clock; `NumberOfCores` is the physical count.
    if let Some((base_mhz, cores)) = read_processor_registry() {
        if info.max_mhz.is_none() {
            info.max_mhz = base_mhz;
        }
        info.base_mhz = base_mhz;
        if info.physical_cores.is_none() {
            info.physical_cores = cores;
        }
    }

    info
}

#[cfg(all(target_os = "windows", test))]
#[link(name = "kernel32")]
extern "system" {
    fn GetSystemTimes(
        idle_time: *mut u64,
        kernel_time: *mut u64,
        user_time: *mut u64,
    ) -> i32;
}

/// A single-call, system-wide CPU time sample.
///
/// `GetSystemTimes` returns cumulative idle/kernel/user counters for the whole
/// machine. It performs no per-processor enumeration and no performance-counter
/// registry work. Retained as the measured comparison baseline for the
/// utilization source: on a saturated 16-thread machine it takes ~32 ms versus
/// ~0.3 ms for the PDH query that is actually used.
#[cfg(all(target_os = "windows", test))]
fn system_times() -> Option<(u64, u64, u64)> {
    let mut idle = 0u64;
    let mut kernel = 0u64;
    let mut user = 0u64;
    // SAFETY: all three pointers reference valid, writable u64 values.
    let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
    (ok != 0).then_some((idle, kernel, user))
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
#[repr(C)]
struct ProcessorPowerInformation {
    number: u32,
    max_mhz: u32,
    current_mhz: u32,
    mhz_limit: u32,
    max_idle_state: u32,
    current_idle_state: u32,
}

#[cfg(target_os = "windows")]
#[link(name = "powrprof")]
extern "system" {
    fn CallNtPowerInformation(
        information_level: i32,
        input_buffer: *mut core::ffi::c_void,
        input_buffer_length: u32,
        output_buffer: *mut core::ffi::c_void,
        output_buffer_length: u32,
    ) -> i32;
}

/// `ProcessorInformation` = 11.
#[cfg(target_os = "windows")]
const PROCESSOR_INFORMATION_LEVEL: i32 = 11;

#[cfg(target_os = "windows")]
fn read_processor_power_information() -> Option<Vec<ProcessorPowerInformation>> {
    let count = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    let mut buffer: Vec<ProcessorPowerInformation> = vec![
        ProcessorPowerInformation {
            number: 0,
            max_mhz: 0,
            current_mhz: 0,
            mhz_limit: 0,
            max_idle_state: 0,
            current_idle_state: 0,
        };
        count
    ];
    let bytes = (buffer.len() * std::mem::size_of::<ProcessorPowerInformation>()) as u32;

    // SAFETY: `buffer` is a properly sized, aligned array of the C struct and
    // the length passed matches its allocation.
    let status = unsafe {
        CallNtPowerInformation(
            PROCESSOR_INFORMATION_LEVEL,
            std::ptr::null_mut(),
            0,
            buffer.as_mut_ptr() as *mut core::ffi::c_void,
            bytes,
        )
    };

    if status < 0 {
        return None;
    }
    Some(buffer)
}

#[cfg(target_os = "windows")]
fn read_processor_registry() -> Option<(Option<f64>, Option<usize>)> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        .ok()?;
    let mhz: u32 = key.get_value("~MHz").ok()?;
    let cores: Option<u32> = key.get_value("NumberOfCores").ok();
    Some((
        (mhz > 0).then_some(mhz as f64),
        cores.map(|value| value as usize).filter(|value| *value > 0),
    ))
}

// ---------------------------------------------------------------------------
// Windows PDH: effective clock
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[repr(C)]
struct PdhFmtCounterValue {
    status: u32,
    _padding: u32,
    value: f64,
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct PdhFmtCounterValueItem {
    name: *const u16,
    value: PdhFmtCounterValue,
}

#[cfg(target_os = "windows")]
#[link(name = "pdh")]
extern "system" {
    fn PdhOpenQueryW(data_source: *const u16, user_data: usize, query: *mut *mut core::ffi::c_void) -> u32;
    fn PdhAddEnglishCounterW(
        query: *mut core::ffi::c_void,
        path: *const u16,
        user_data: usize,
        counter: *mut *mut core::ffi::c_void,
    ) -> u32;
    fn PdhCollectQueryData(query: *mut core::ffi::c_void) -> u32;
    fn PdhGetFormattedCounterValue(
        counter: *mut core::ffi::c_void,
        format: u32,
        counter_type: *mut u32,
        value: *mut PdhFmtCounterValue,
    ) -> u32;
    fn PdhGetFormattedCounterArrayW(
        counter: *mut core::ffi::c_void,
        format: u32,
        buffer_size: *mut u32,
        item_count: *mut u32,
        item_buffer: *mut PdhFmtCounterValueItem,
    ) -> u32;
    fn PdhCloseQuery(query: *mut core::ffi::c_void) -> u32;
}

#[cfg(target_os = "windows")]
const PDH_FMT_DOUBLE: u32 = 0x00000200;
#[cfg(target_os = "windows")]
const PDH_FMT_NOCAP100: u32 = 0x00008000;
#[cfg(target_os = "windows")]
const PDH_MORE_DATA: u32 = 0x800007D2;

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Default)]
struct PdhSample {
    performance_percent: Option<f64>,
    per_core_performance: Vec<Option<f64>>,
    max_frequency_mhz: Option<f64>,
}

/// Reusable PDH query handles.
///
/// `\Processor Information(_Total)\% Processor Performance` reports the actual
/// core clock as a percentage of the nominal frequency. On AMD parts the value
/// exceeds 100 when boosting, which is precisely how the effective clock is
/// derived. The counter set is absent on some virtualised hosts; that only
/// disables clocks, never the rest of telemetry.
#[cfg(target_os = "windows")]
struct WindowsPdh {
    query: *mut core::ffi::c_void,
    performance: *mut core::ffi::c_void,
    frequency: *mut core::ffi::c_void,
    available: bool,
}

#[cfg(target_os = "windows")]
unsafe impl Send for WindowsPdh {}

#[cfg(target_os = "windows")]
impl WindowsPdh {
    fn new() -> Option<Self> {
        let mut query: *mut core::ffi::c_void = std::ptr::null_mut();
        // SAFETY: null data source means a local, live query; the out pointer is valid.
        if unsafe { PdhOpenQueryW(std::ptr::null(), 0, &mut query) } != 0 {
            return None;
        }

        let mut instance = Self {
            query,
            performance: std::ptr::null_mut(),
            frequency: std::ptr::null_mut(),
            available: false,
        };

        let total_performance =
            wide(r"\Processor Information(_Total)\% Processor Performance");
        let total_frequency = wide(r"\Processor Information(_Total)\Processor Frequency");
        let mut counter: *mut core::ffi::c_void = std::ptr::null_mut();

        // SAFETY: `query` is a live query handle and the paths are NUL-terminated.
        let performance_ok =
            unsafe { PdhAddEnglishCounterW(query, total_performance.as_ptr(), 0, &mut counter) } == 0;
        instance.performance = counter;
        counter = std::ptr::null_mut();
        let frequency_ok = unsafe {
            PdhAddEnglishCounterW(query, total_frequency.as_ptr(), 0, &mut counter)
        } == 0;
        instance.frequency = counter;

        // PDH requires one collection before values are meaningful.
        // SAFETY: `query` is live.
        unsafe { PdhCollectQueryData(query) };

        instance.available = performance_ok;
        if !instance.available && !frequency_ok {
            // Keep the object; it will report nothing but stays cheap.
        }
        Some(instance)
    }

    fn sample(&mut self) -> PdhSample {
        let mut sample = PdhSample::default();

        // SAFETY: `query` is live for the lifetime of this struct.
        if unsafe { PdhCollectQueryData(self.query) } != 0 {
            return sample;
        }

        if !self.performance.is_null() {
            sample.performance_percent = read_double(self.performance, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100);
            sample.per_core_performance = read_double_array(self.performance);
        }
        if !self.frequency.is_null() {
            sample.max_frequency_mhz = read_double(self.frequency, PDH_FMT_DOUBLE);
        }

        sample
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsPdh {
    fn drop(&mut self) {
        if !self.query.is_null() {
            // SAFETY: closing the query that this struct owns exactly once.
            unsafe { PdhCloseQuery(self.query) };
            self.query = std::ptr::null_mut();
        }
    }
}

#[cfg(target_os = "windows")]
fn read_double(counter: *mut core::ffi::c_void, format: u32) -> Option<f64> {
    let mut value = PdhFmtCounterValue {
        status: 0,
        _padding: 0,
        value: 0.0,
    };
    // SAFETY: `counter` belongs to a live query and `value` is a valid out pointer.
    let status = unsafe {
        PdhGetFormattedCounterValue(counter, format, std::ptr::null_mut(), &mut value)
    };
    if status != 0 {
        return None;
    }
    value.value.is_finite().then_some(value.value)
}

/// Per-core performance percentages, in logical-CPU order. Returns an empty
/// vector when the instance set is unavailable.
#[cfg(target_os = "windows")]
fn read_double_array(counter: *mut core::ffi::c_void) -> Vec<Option<f64>> {
    let mut buffer_size: u32 = 0;
    let mut item_count: u32 = 0;
    // SAFETY: sizes are requested first, which is the documented two-call pattern.
    let status = unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE | PDH_FMT_NOCAP100,
            &mut buffer_size,
            &mut item_count,
            std::ptr::null_mut(),
        )
    };
    if status != PDH_MORE_DATA || buffer_size == 0 {
        return Vec::new();
    }

    let item_size = std::mem::size_of::<PdhFmtCounterValueItem>();
    let capacity = (buffer_size as usize / item_size) + 1;
    let mut items: Vec<PdhFmtCounterValueItem> = Vec::with_capacity(capacity);
    // SAFETY: the buffer is allocated with the size PDH requested and PDH only
    // writes up to `buffer_size` bytes.
    let status = unsafe {
        PdhGetFormattedCounterArrayW(
            counter,
            PDH_FMT_DOUBLE | PDH_FMT_NOCAP100,
            &mut buffer_size,
            &mut item_count,
            items.as_mut_ptr(),
        )
    };
    if status != 0 {
        return Vec::new();
    }
    // SAFETY: PDH initialized `item_count` entries in the allocated buffer.
    unsafe { items.set_len(item_count as usize) };

    let mut values: Vec<Option<f64>> = Vec::with_capacity(items.len());
    for item in items.iter() {
        // Instance names look like "0,0" / "0" depending on the machine; the
        // first number is the logical processor.
        let index = unsafe { read_pcwstr(item.name) }
            .and_then(|name| name.split(',').next().map(|value| value.trim().to_string()))
            .and_then(|value| value.parse::<usize>().ok());
        let value = if item.value.status == 0 && item.value.value.is_finite() {
            Some(item.value.value)
        } else {
            None
        };
        match index {
            Some(index) => {
                if values.len() <= index {
                    values.resize(index + 1, None);
                }
                values[index] = value;
            }
            None => values.push(value),
        }
    }
    values
}

/// Converts a fixed Windows path literal to a NUL-terminated UTF-16 buffer.
#[cfg(target_os = "windows")]
fn wide(path: &str) -> Vec<u16> {
    path.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
unsafe fn read_pcwstr(pointer: *const u16) -> Option<String> {
    if pointer.is_null() {
        return None;
    }
    let mut length = 0usize;
    // SAFETY: PDH-owned NUL-terminated string.
    while *pointer.add(length) != 0 && length < 512 {
        length += 1;
    }
    let slice = std::slice::from_raw_parts(pointer, length);
    Some(String::from_utf16_lossy(slice))
}

// ---------------------------------------------------------------------------
// Windows provider probe
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct ProviderScriptResult {
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    sensors: Vec<RawSensor>,
}

/// Reads the bundled helper's snapshot and converts it to the provider chain's
/// sensor vocabulary, so the same ranking and plausibility rules apply to it.
///
/// The broker already normalizes its readings, but they are re-expressed as raw
/// sensors on purpose: a value that fails the shared checks (implausible
/// temperature, zero power) is then rejected identically no matter which
/// provider produced it.
///
/// The broker is a small native binary started by a highest-privileges scheduled
/// task; there is no PowerShell, no .NET and no third-party monitoring app in
/// this path.
#[cfg(target_os = "windows")]
fn snapshot_from_broker() -> Option<SensorSnapshot> {
    // Ask the scheduled task for a fresh reading. When the task is not
    // registered (a machine where the user did not opt in, or a policy blocked
    // it) this is a no-op and the fallback providers answer instead.
    let broker = crate::sensor_broker_client::request_reading()?;
    if !broker.has_readings() {
        return None;
    }

    let hardware = broker
        .module
        .clone()
        .unwrap_or_else(|| "CPU".to_string());
    let mut sensors: Vec<RawSensor> = Vec::new();

    let mut push_as = |name: &str,
                       sensor_type: &str,
                       value: Option<f64>,
                       unit: Option<&str>,
                       identifier: &str| {
        if let Some(value) = value.filter(|value| value.is_finite()) {
            sensors.push(RawSensor {
                name: name.to_string(),
                sensor_type: sensor_type.to_string(),
                value: Some(value.to_string()),
                min: None,
                max: None,
                unit: unit.map(|unit| unit.to_string()),
                hardware: Some(hardware.clone()),
                identifier: Some(identifier.to_string()),
            });
        }
    };
    let mut push = |name: &str, sensor_type: &str, value: Option<f64>, unit: Option<&str>| {
        push_as(name, sensor_type, value, unit, "sensor-broker");
    };

    // Keep the reading under its real register name (`Tctl` on AMD, `Package` or
    // `Core` on Intel) so the shared ranking recognises it.
    let source = broker
        .temperature_source
        .clone()
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "CPU Package".to_string());
    push(&source, "Temperature", broker.temperature_c, Some("C"));
    push("CPU Package", "Power", broker.package_power_w, Some("W"));

    // The broker already decided which channel is the CPU fan, using the
    // motherboard fan controller's own Smart-Fan assignment. It is named for
    // what it is so the shared ranking accepts it as the CPU fan, and its
    // identifier carries the channel and temperature source it was derived
    // from, so the UI can show how the attribution was made.
    push_as(
        "CPU Fan",
        "Fan",
        broker.fan_rpm,
        Some("RPM"),
        broker.fan_source.as_deref().unwrap_or("sensor-broker"),
    );

    Some(SensorSnapshot {
        provider: ProviderKind::BundledHelper,
        detail: format!(
            "sensor broker · {} · {} sensor(s)",
            broker.module.as_deref().unwrap_or("unknown module"),
            sensors.len()
        ),
        sensors,
    })
}

#[cfg(target_os = "windows")]
fn probe_windows_sensors() -> Result<SensorSnapshot, String> {
    // 1. Native broker: the only source that reaches AMD Tctl/Tdie and Intel
    //    package temperature, through the WHQL-signed PawnIO driver. Skipped
    //    while it reports nothing so a fallback provider can still answer.
    if let Some(snapshot) = snapshot_from_broker() {
        return Ok(snapshot);
    }

    // 2. HWiNFO's registry interface needs no WMI query, so it is checked next
    //    when present. Both providers are cheap to query once.
    if let Some(sensors) = read_hwinfo_sensors() {
        if !sensors.is_empty() {
            return Ok(SensorSnapshot {
                provider: ProviderKind::HwinfoRegistry,
                sensors,
                detail: "HWiNFO shared memory registry".to_string(),
            });
        }
    }

    let output = run_provider_script()?;
    let parsed: ProviderScriptResult = serde_json::from_str(&output)
        .map_err(|error| format!("CPU sensor provider returned malformed data: {error}"))?;

    let provider = match parsed.provider.as_deref() {
        Some("libre-hardware-monitor") => ProviderKind::LibreHardwareMonitor,
        Some("acpi-thermal-zone") => ProviderKind::AcpiThermalZone,
        _ => ProviderKind::None,
    };

    let detail = match (provider, parsed.error.as_deref()) {
        (ProviderKind::None, Some(error)) => format!("No provider available ({error})"),
        (ProviderKind::None, None) => {
            "Neither LibreHardwareMonitor/OpenHardwareMonitor nor an ACPI thermal zone is available"
                .to_string()
        }
        (_, Some(error)) => format!("{} ({} sensors, {error})", provider.as_str(), parsed.sensors.len()),
        (_, None) => format!("{} ({} sensors)", provider.as_str(), parsed.sensors.len()),
    };

    if provider == ProviderKind::None && parsed.sensors.is_empty() {
        return Ok(SensorSnapshot {
            provider: ProviderKind::None,
            sensors: Vec::new(),
            detail,
        });
    }

    Ok(SensorSnapshot {
        provider,
        sensors: parsed.sensors,
        detail,
    })
}

/// Reads HWiNFO's "Shared Memory Viewer" registry interface when enabled.
#[cfg(target_os = "windows")]
fn read_hwinfo_sensors() -> Option<Vec<RawSensor>> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    for path in [
        r"SOFTWARE\HWiNFO64\VSB",
        r"SOFTWARE\HWiNFO32\VSB",
    ] {
        let Ok(key) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) else {
            continue;
        };

        let mut sensors = Vec::new();
        for index in 0..512u32 {
            let Ok(label) = key.get_value::<String, _>(format!("Label{index}")) else {
                continue;
            };
            let Ok(value) = key.get_value::<String, _>(format!("Value{index}")) else {
                continue;
            };
            let sensor_type = key
                .get_value::<String, _>(format!("ValueType{index}"))
                .unwrap_or_default();
            let unit = key.get_value::<String, _>(format!("Unit{index}")).ok();
            sensors.push(RawSensor {
                name: label,
                sensor_type: normalize_hwinfo_type(&sensor_type, unit.as_deref()),
                value: Some(value),
                min: None,
                max: None,
                unit,
                hardware: Some("HWiNFO".to_string()),
                identifier: Some(format!("vsb:{index}")),
            });
        }
        if !sensors.is_empty() {
            return Some(sensors);
        }
    }
    None
}

/// HWiNFO reports a numeric `ValueType`; map the interesting ones to the
/// LibreHardwareMonitor sensor-type vocabulary used by the selectors.
#[cfg(target_os = "windows")]
fn normalize_hwinfo_type(value_type: &str, unit: Option<&str>) -> String {
    match value_type.trim() {
        "1" => "Temperature".to_string(),
        "2" => "Voltage".to_string(),
        "3" => "Fan".to_string(),
        "4" => "Current".to_string(),
        "5" => "Power".to_string(),
        "6" => "Clock".to_string(),
        "7" => "Usage".to_string(),
        _ => match unit.unwrap_or_default().to_ascii_lowercase().as_str() {
            unit if unit.contains("rpm") => "Fan".to_string(),
            unit if unit.contains('c') => "Temperature".to_string(),
            unit if unit.contains('w') => "Power".to_string(),
            _ => "Other".to_string(),
        },
    }
}

/// One PowerShell invocation returns every hardware sensor, so the expensive
/// provider is queried once per cache window instead of once per metric.
#[cfg(target_os = "windows")]
fn run_provider_script() -> Result<String, String> {
    // ACPI zones are only reported when no driver-backed provider exists; a
    // mainboard zone must never shadow a real CPU sensor.
    let script = r#"
$ErrorActionPreference = 'SilentlyContinue'
$result = @{ provider = $null; sensors = @(); error = $null }

function Read-Sensors([string]$ns, [string]$provider) {
  try {
    $items = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop
    if ($items) {
      $sensors = @()
      foreach ($item in $items) {
        $sensors += [pscustomobject]@{
          name       = [string]$item.Name
          type       = [string]$item.SensorType
          value      = if ($null -eq $item.Value) { $null } else { [string]([double]$item.Value) }
          min        = if ($null -eq $item.Min) { $null } else { [string]([double]$item.Min) }
          max        = if ($null -eq $item.Max) { $null } else { [string]([double]$item.Max) }
          unit       = $null
          hardware   = [string]$item.Parent
          identifier = [string]$item.Identifier
        }
      }
      if ($sensors.Count -gt 0) {
        $result.provider = $provider
        $result.sensors = $sensors
        return $true
      }
    }
  } catch { }
  return $false
}

if (-not (Read-Sensors 'root\LibreHardwareMonitor' 'libre-hardware-monitor')) {
  if (-not (Read-Sensors 'root\OpenHardwareMonitor' 'libre-hardware-monitor')) {
    try {
      $zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop
      $sensors = @()
      foreach ($zone in $zones) {
        $celsius = [double](($zone.CurrentTemperature / 10.0) - 273.15)
        if ($celsius -gt 0 -and $celsius -lt 125) {
          $sensors += [pscustomobject]@{
            name       = [string]$zone.InstanceName
            type       = 'Temperature'
            value      = [string]$celsius
            min        = $null
            max        = $null
            unit       = 'C'
            hardware   = 'ACPI thermal zone'
            identifier = 'acpi'
          }
        }
      }
      if ($sensors.Count -gt 0) {
        $result.provider = 'acpi-thermal-zone'
        $result.sensors = $sensors
      }
    } catch { }
  }
}

if (-not $result.provider) {
  $result.error = 'no-sensor-provider'
}

[Console]::Out.Write((ConvertTo-Json -InputObject $result -Depth 4 -Compress))
"#;

    run_hidden_powershell(script, PROVIDER_TIMEOUT)
}

/// Runs PowerShell with a watchdog so a wedged provider cannot stall telemetry.
#[cfg(target_os = "windows")]
fn run_hidden_powershell(script: &str, timeout: Duration) -> Result<String, String> {
    use std::io::Read;
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    let mut child = Command::new("powershell")
        .args([            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-Command",
            script,
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Failed to start sensor provider: {error}"))?;

    // Drain stdout concurrently; a full pipe buffer would otherwise deadlock a
    // provider that prints more than the pipe capacity.
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sensor provider output".to_string())?;

    let reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let mut raw = Vec::new();
        if stdout.read_to_end(&mut raw).is_ok() {
            buffer = String::from_utf8_lossy(&raw).to_string();
        }
        buffer
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err(format!(
                        "Sensor provider timed out after {}s",
                        timeout.as_secs()
                    ));
                }
                std::thread::sleep(Duration::from_millis(25));
            }
            Err(error) => {
                let _ = reader.join();
                return Err(format!("Sensor provider failed: {error}"));
            }
        }
    }

    let output = reader
        .join()
        .map_err(|_| "Sensor provider output task failed".to_string())?;

    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Err("Sensor provider returned no data".to_string());
    }
    Ok(trimmed.to_string())
}

// ---------------------------------------------------------------------------
// Non-Windows providers
// ---------------------------------------------------------------------------
//
// Windows needs elevation plus a kernel driver for CPU die temperature. The
// Unix platforms do not: Linux exposes hwmon (`k10temp`, `coretemp`) and RAPL
// through sysfs, and macOS reaches the SMC through IOKit, both readable from an
// unprivileged process. So there is no helper and no elevation prompt here.

#[cfg(not(target_os = "windows"))]
fn probe_hardware_sensors_impl() -> Result<SensorSnapshot, String> {
    let mut sensors = read_sysinfo_components();

    #[cfg(target_os = "linux")]
    {
        sensors.extend(read_linux_hwmon_fans(Path::new("/sys/class/hwmon")));
        sensors.extend(read_linux_hwmon_voltage(Path::new("/sys/class/hwmon")));
        // RAPL exposes a genuine package power reading on Intel and on recent
        // AMD kernels, and has no equivalent on Windows.
        if let Some(watts) = read_linux_rapl_power_watts(Path::new("/sys/class/powercap")) {
            sensors.push(RawSensor {
                name: "CPU Package".to_string(),
                sensor_type: "Power".to_string(),
                value: Some(watts.to_string()),
                min: None,
                max: None,
                unit: Some("W".to_string()),
                hardware: Some("RAPL".to_string()),
                identifier: Some("linux-rapl".to_string()),
            });
        }
    }

    let provider = if sensors.is_empty() {
        ProviderKind::None
    } else {
        ProviderKind::SysinfoComponents
    };

    let detail = if cfg!(target_os = "linux") {
        format!("hwmon/sysfs ({} sensors)", sensors.len())
    } else if cfg!(target_os = "macos") {
        format!("SMC components ({} sensors)", sensors.len())
    } else {
        format!("system components ({} sensors)", sensors.len())
    };

    Ok(SensorSnapshot {
        provider,
        detail,
        sensors,
    })
}

/// Temperature sensors reported by sysinfo: hwmon on Linux (k10temp/coretemp),
/// the SMC on macOS.
#[cfg(not(target_os = "windows"))]
fn read_sysinfo_components() -> Vec<RawSensor> {
    sysinfo::Components::new_with_refreshed_list()
        .iter()
        .filter_map(|component| {
            map_sysinfo_component(
                component.label(),
                component.temperature(),
                component.max(),
            )
        })
        .collect()
}

/// Maps one sysinfo component to a raw sensor, or `None` when it has no reading.
///
/// `Component::temperature()` returns `Option<f32>` on every platform, and a
/// component with no reading must be skipped rather than pushed as a sensor
/// whose value can never satisfy the selectors. This is a separate function so
/// the Unix branch is unit-testable on a Windows host, where it is otherwise
/// never compiled.
#[cfg(any(not(target_os = "windows"), test))]
fn map_sysinfo_component(
    label: &str,
    temperature: Option<f32>,
    max: Option<f32>,
) -> Option<RawSensor> {
    let temperature = temperature?;
    Some(RawSensor {
        name: label.to_string(),
        sensor_type: "Temperature".to_string(),
        value: Some(format!("{temperature:.2}")),
        min: None,
        max: max.map(|value| format!("{value:.2}")),
        unit: Some("C".to_string()),
        hardware: label
            .split_whitespace()
            .next()
            .map(|vendor| vendor.to_string()),
        identifier: None,
    })
}

/// Reads `fan*_input` from hwmon, keeping only fans whose label identifies them
/// as the CPU fan.
///
/// hwmon labels are mainboard-defined (`cpu_fan`, `CPU Fan`, `fan1`), so an
/// unlabelled fan is deliberately discarded: reporting a chassis fan as the CPU
/// fan would be worse than reporting nothing.
#[cfg(any(target_os = "linux", test))]
fn read_linux_hwmon_fans(root: &Path) -> Vec<RawSensor> {
    let mut sensors = Vec::new();

    for device in read_subdirectories(root) {
        let mut fan_inputs: Vec<(String, f64)> = Vec::new();
        let mut fan_labels: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        let device_name = read_trimmed(&device.join("name")).unwrap_or_default();

        for entry in read_entries(&device) {
            let file_name = entry
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            if let Some(index) = file_name
                .strip_prefix("fan")
                .and_then(|rest| rest.strip_suffix("_input"))
            {
                if let Some(value) = read_trimmed(&entry).and_then(|raw| raw.parse::<f64>().ok()) {
                    fan_inputs.push((index.to_string(), value));
                }
            } else if let Some(index) = file_name
                .strip_prefix("fan")
                .and_then(|rest| rest.strip_suffix("_label"))
            {
                if let Some(label) = read_trimmed(&entry) {
                    fan_labels.insert(index.to_string(), label);
                }
            }
        }

        for (index, value) in fan_inputs {
            let label = fan_labels.get(&index).cloned();
            if !is_cpu_fan_label(label.as_deref()) {
                continue;
            }
            sensors.push(RawSensor {
                name: label.unwrap_or_else(|| format!("fan{index}")),
                sensor_type: "Fan".to_string(),
                value: Some(value.to_string()),
                min: None,
                max: None,
                unit: Some("RPM".to_string()),
                hardware: Some(device_name.clone()),
                identifier: Some(format!("hwmon:{device_name}:fan{index}")),
            });
        }
    }

    sensors
}

/// A fan counts as the CPU fan only when its own label or its device says so.
#[cfg(any(target_os = "linux", test))]
fn is_cpu_fan_label(label: Option<&str>) -> bool {
    let Some(label) = label else { return false };
    let normalized = label.trim().to_ascii_lowercase().replace('-', "_");
    normalized.contains("cpu_fan")
        || normalized.contains("cpu fan")
        || normalized.contains("processor fan")
        || (normalized.contains("cpu") && normalized.contains("fan"))
}

/// CPU core voltage from hwmon, when the chip exposes one.
#[cfg(any(target_os = "linux", test))]
fn read_linux_hwmon_voltage(root: &Path) -> Vec<RawSensor> {
    let mut sensors = Vec::new();

    for device in read_subdirectories(root) {
        let device_name = read_trimmed(&device.join("name")).unwrap_or_default();
        // Restrict to CPU devices so an SVI/board sensor is not mistaken for
        // CPU core voltage.
        if !matches!(
            device_name.as_str(),
            "k10temp" | "coretemp" | "zenpower" | "k8temp" | "cpu_thermal"
        ) {
            continue;
        }

        for entry in read_entries(&device) {
            let file_name = entry
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
            if !file_name.starts_with("in") || !file_name.ends_with("_input") {
                continue;
            }
            let Some(value) = read_trimmed(&entry).and_then(|raw| raw.parse::<f64>().ok()) else {
                continue;
            };
            // hwmon reports millivolts.
            let volts = value / 1000.0;
            if !(0.2..2.0).contains(&volts) {
                continue;
            }
            let index = file_name
                .trim_start_matches("in")
                .trim_end_matches("_input")
                .to_string();
            let label = read_trimmed(&device.join(format!("in{index}_label")))
                .unwrap_or_else(|| format!("in{index}"));
            sensors.push(RawSensor {
                name: label,
                sensor_type: "Voltage".to_string(),
                value: Some(volts.to_string()),
                min: None,
                max: None,
                unit: Some("V".to_string()),
                hardware: Some(device_name.clone()),
                identifier: Some(format!("hwmon:{device_name}:in{index}")),
            });
        }
    }

    sensors
}

/// Package power from the RAPL energy counters.
///
/// Energy is cumulative micro-joules, so power is the delta over a known
/// interval. The fixed wait is short and this only runs on the provider refresh
/// cadence, never per telemetry request.
#[cfg(any(target_os = "linux", test))]
fn read_linux_rapl_power_watts(root: &Path) -> Option<f64> {
    const SAMPLE_WINDOW: Duration = Duration::from_millis(120);

    let mut candidates: Vec<(PathBuf, f64)> = Vec::new();
    for device in read_subdirectories(root) {
        let name = read_trimmed(&device.join("name")).unwrap_or_default();
        // Prefer whole-package domains over sub-domains.
        if !(name.contains("package") || name.contains("psys")) {
            continue;
        }
        let energy_path = device.join("energy_uj");
        // Kernels restrict RAPL to root by default; a failure here is expected
        // on hardened systems and must not disable the other sensors.
        if let Some(first) = read_trimmed(&energy_path).and_then(|raw| raw.parse::<f64>().ok()) {
            candidates.push((energy_path, first));
        }
    }

    if candidates.is_empty() {
        return None;
    }

    std::thread::sleep(SAMPLE_WINDOW);

    for (path, first) in candidates {
        let Some(second) = read_trimmed(&path).and_then(|raw| raw.parse::<f64>().ok()) else {
            continue;
        };
        if second <= first {
            // Counter wrapped or did not advance; try the next domain.
            continue;
        }
        let watts = ((second - first) / 1_000_000.0) / SAMPLE_WINDOW.as_secs_f64();
        if watts.is_finite() && watts > 0.0 && watts < MAX_PLAUSIBLE_POWER_W {
            return Some(watts);
        }
    }

    None
}

#[cfg(any(target_os = "linux", test))]
#[allow(dead_code)] // On a non-Linux test host these are exercised by linux_tests.
fn read_subdirectories(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut directories: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    directories.sort();
    directories
}

#[cfg(any(target_os = "linux", test))]
#[allow(dead_code)] // On a non-Linux test host these are exercised by linux_tests.
fn read_entries(directory: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(directory) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    paths
}

#[cfg(any(target_os = "linux", test))]
#[allow(dead_code)] // On a non-Linux test host these are exercised by linux_tests.
fn read_trimmed(path: &Path) -> Option<String> {
    let contents = std::fs::read_to_string(path).ok()?;
    let trimmed = contents.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sensor(name: &str, sensor_type: &str, value: Option<&str>) -> RawSensor {
        RawSensor {
            name: name.to_string(),
            sensor_type: sensor_type.to_string(),
            value: value.map(|value| value.to_string()),
            min: None,
            max: None,
            unit: None,
            hardware: None,
            identifier: None,
        }
    }

    fn cpu_sensor(name: &str, sensor_type: &str, value: f64) -> RawSensor {
        RawSensor {
            hardware: Some("AMD Ryzen 7 5700G".to_string()),
            ..sensor(name, sensor_type, Some(&value.to_string()))
        }
    }

    /// A sensor that lives on a specific non-CPU device.
    fn device_sensor(name: &str, sensor_type: &str, value: f64, hardware: &str) -> RawSensor {
        RawSensor {
            hardware: Some(hardware.to_string()),
            ..sensor(name, sensor_type, Some(&value.to_string()))
        }
    }

    // -- temperature ------------------------------------------------------

    #[test]
    fn reads_valid_cpu_temperature() {
        let sensors = vec![cpu_sensor("CPU Package", "Temperature", 72.0)];
        assert_eq!(select_cpu_temperature(&sensors), Some(72.0));
    }

    #[test]
    fn missing_temperature_is_none_not_zero() {
        let sensors = vec![cpu_sensor("CPU Package", "Temperature", 0.0)];
        assert_eq!(select_cpu_temperature(&sensors), None);

        let no_sensors: Vec<RawSensor> = Vec::new();
        assert_eq!(select_cpu_temperature(&no_sensors), None);
    }

    #[test]
    fn malformed_temperature_is_rejected() {
        for raw in ["", "N/A", "--", "abc", "NaN"] {
            let sensors = vec![sensor("CPU Package", "Temperature", Some(raw))];
            assert_eq!(
                select_cpu_temperature(&sensors),
                None,
                "expected {raw:?} to be rejected"
            );
        }
    }

    #[test]
    fn detects_amd_tctl_and_tdie() {
        let sensors = vec![
            device_sensor("System", "Temperature", 41.0, "Nuvoton NCT6798D"),
            cpu_sensor("Tctl/Tdie", "Temperature", 68.5),
        ];
        assert_eq!(select_cpu_temperature(&sensors), Some(68.5));

        let die_only = vec![cpu_sensor("Tdie", "Temperature", 55.25)];
        assert_eq!(select_cpu_temperature(&die_only), Some(55.25));
    }

    #[test]
    fn detects_intel_package_temperature() {
        let sensors = vec![
            cpu_sensor("CPU Core #1", "Temperature", 61.0),
            cpu_sensor("CPU Package", "Temperature", 66.0),
        ];
        assert_eq!(select_cpu_temperature(&sensors), Some(66.0));
        assert_eq!(select_package_temperature(&sensors), Some(66.0));
    }

    #[test]
    fn prefers_package_over_individual_cores() {
        let sensors = vec![
            cpu_sensor("CPU Core #1", "Temperature", 70.0),
            cpu_sensor("CPU Core #2", "Temperature", 74.0),
            cpu_sensor("CPU Package", "Temperature", 65.0),
        ];
        assert_eq!(select_cpu_temperature(&sensors), Some(65.0));
    }

    #[test]
    fn ignores_unrelated_temperature_sensors() {
        let unrelated = vec![
            device_sensor("SSD 970 EVO Temperature", "Temperature", 48.0, "Samsung 970 EVO"),
            device_sensor("Chipset", "Temperature", 55.0, "AMD Chipset"),
            device_sensor("VRM", "Temperature", 62.0, "Motherboard"),
            device_sensor("Motherboard", "Temperature", 35.0, "Nuvoton NCT6798D"),
            device_sensor("GPU Core", "Temperature", 44.0, "NVIDIA GeForce RTX 4070"),
        ];
        assert_eq!(select_cpu_temperature(&unrelated), None);
    }

    #[test]
    fn unrelated_sensors_do_not_shadow_a_real_cpu_sensor() {
        let sensors = vec![
            device_sensor("GPU Hot Spot", "Temperature", 80.0, "NVIDIA GeForce RTX 4070"),
            device_sensor("SSD Temperature", "Temperature", 51.0, "Samsung 970 EVO"),
            cpu_sensor("CPU Package", "Temperature", 59.0),
        ];
        assert_eq!(select_cpu_temperature(&sensors), Some(59.0));
    }

    #[test]
    fn a_gpu_sensor_on_a_cpu_box_is_still_not_a_cpu_sensor() {
        // Some providers report the GPU under a device name that also mentions
        // the CPU; the sensor label must win so GPU values never leak into CPU
        // telemetry.
        let sensors = vec![device_sensor("GPU Package", "Power", 180.0, "AMD Ryzen 7 5700G")];
        assert_eq!(select_cpu_power(&sensors), None);
    }

    #[test]
    fn unnamed_temperature_only_used_as_last_resort() {
        let ambiguous = vec![cpu_sensor("Sensor 1", "Temperature", 45.0)];
        assert_eq!(select_cpu_temperature(&ambiguous), None);
    }

    #[test]
    fn rejects_implausible_temperatures() {
        let sensors = vec![cpu_sensor("CPU Package", "Temperature", 250.0)];
        assert_eq!(select_cpu_temperature(&sensors), None);
    }

    // -- power ------------------------------------------------------------

    #[test]
    fn reads_package_power_in_watts() {
        let sensors = vec![
            cpu_sensor("CPU Cores", "Power", 42.0),
            cpu_sensor("CPU Package", "Power", 84.5),
        ];
        let (value, source) = select_cpu_power(&sensors).expect("power");
        assert!((value - 84.5).abs() < f64::EPSILON);
        assert!(source.contains("package"));
    }

    #[test]
    fn unavailable_power_is_none() {
        assert_eq!(select_cpu_power(&[]), None);
        let zero = vec![cpu_sensor("CPU Package", "Power", 0.0)];
        assert_eq!(select_cpu_power(&zero), None);
    }

    #[test]
    fn ignores_gpu_power_sensors() {
        let sensors = vec![cpu_sensor("GPU Package", "Power", 180.0)];
        assert_eq!(select_cpu_power(&sensors), None);
    }

    // -- fan --------------------------------------------------------------

    #[test]
    fn reads_cpu_fan_rpm() {
        let sensors = vec![
            sensor("SYS_FAN1", "Fan", Some("900")),
            sensor("CPU_FAN", "Fan", Some("1420")),
        ];
        let (value, source) = select_cpu_fan(&sensors).expect("a fan");
        assert_eq!(value, 1420.0);
        assert!(source.contains("cpu_fan"), "{source}");
    }

    #[test]
    fn a_broker_fan_reports_the_channel_it_was_derived_from() {
        // The broker decides which channel is the CPU fan and says how, so the
        // attribution can be checked instead of trusted.
        let sensors = vec![RawSensor {
            identifier: Some("NCT6798D (0xD42B) at 0x0290 channel 2 via PECI Agent 0".to_string()),
            ..sensor("CPU Fan", "Fan", Some("3600"))
        }];
        let (value, source) = select_cpu_fan(&sensors).expect("a fan");
        assert_eq!(value, 3600.0);
        assert!(source.contains("channel 2"), "{source}");
        assert!(source.contains("PECI Agent 0"), "{source}");
    }

    #[test]
    fn a_generic_identifier_falls_back_to_the_sensor_name() {
        let sensors = vec![RawSensor {
            identifier: Some("sensor-broker".to_string()),
            ..sensor("CPU_FAN", "Fan", Some("1420"))
        }];
        let (_, source) = select_cpu_fan(&sensors).expect("a fan");
        assert_eq!(source, "sensor:cpu_fan");
    }

    #[test]
    fn unavailable_fan_is_none() {
        assert_eq!(select_cpu_fan(&[]), None);
        let system_only = vec![sensor("SYS_FAN1", "Fan", Some("900"))];
        assert_eq!(select_cpu_fan(&system_only), None);
    }

    #[test]
    fn fan_pwm_percentage_is_not_rpm() {
        let sensors = vec![RawSensor {
            unit: Some("%".to_string()),
            ..sensor("CPU_FAN", "Control", Some("60"))
        }];
        assert_eq!(select_cpu_fan(&sensors), None);
    }

    #[test]
    fn implausible_fan_values_are_rejected() {
        let stalled = vec![sensor("CPU_FAN", "Fan", Some("0"))];
        assert_eq!(select_cpu_fan(&stalled), None);

        let absurd = vec![sensor("CPU_FAN", "Fan", Some("99000"))];
        assert_eq!(select_cpu_fan(&absurd), None);
    }

    #[test]
    fn an_unlabelled_superio_fan_is_not_reported_as_the_cpu_fan() {
        // Real ASUS B550M-A output: the SuperIO exposes seven fans with no CPU
        // label, so none of them can be claimed. Guessing by speed or index
        // would attribute a chassis fan to the CPU.
        let sensors: Vec<RawSensor> = (1..=7)
            .map(|index| RawSensor {
                hardware: Some("Nuvoton NCT6798D".to_string()),
                ..sensor(&format!("Fan #{index}"), "Fan", Some("1200"))
            })
            .collect();
        assert_eq!(select_cpu_fan(&sensors), None);
    }

    // -- voltage ----------------------------------------------------------

    #[test]
    fn prefers_the_cpu_voltage_rail_over_a_board_reading() {
        // Real ASUS B550M-A output: the CPU device reports SVI2 TFN while the
        // SuperIO reports Vcore. Both match "core" by name; only the CPU's own
        // reading is the processor voltage.
        let sensors = vec![
            RawSensor {
                hardware: Some("Nuvoton NCT6798D".to_string()),
                ..sensor("Vcore", "Voltage", Some("0.712"))
            },
            RawSensor {
                hardware: Some("AMD Ryzen 7 5700G with Radeon Graphics".to_string()),
                ..sensor("Core (SVI2 TFN)", "Voltage", Some("1.55"))
            },
        ];
        assert_eq!(select_cpu_voltage(&sensors), Some(1.55));
    }

    #[test]
    fn a_board_voltage_is_used_when_the_cpu_reports_none() {
        let sensors = vec![RawSensor {
            hardware: Some("Nuvoton NCT6798D".to_string()),
            ..sensor("Vcore", "Voltage", Some("1.1"))
        }];
        assert_eq!(select_cpu_voltage(&sensors), Some(1.1));
    }

    #[test]
    fn non_cpu_rails_are_never_reported_as_cpu_voltage() {
        let sensors = vec![
            RawSensor {
                hardware: Some("Nuvoton NCT6798D".to_string()),
                ..sensor("+3.3V", "Voltage", Some("3.28"))
            },
            RawSensor {
                hardware: Some("Nuvoton NCT6798D".to_string()),
                ..sensor("AVCC", "Voltage", Some("3.392"))
            },
        ];
        assert_eq!(select_cpu_voltage(&sensors), None);
    }

    // -- sysinfo component mapping (the Linux/macOS provider) ---------------

    #[test]
    fn maps_a_sysinfo_component_with_a_reading() {
        let mapped = map_sysinfo_component("k10temp Tctl", Some(52.25), Some(90.0))
            .expect("component with a reading must map");
        assert_eq!(mapped.name, "k10temp Tctl");
        assert_eq!(mapped.sensor_type, "Temperature");
        assert_eq!(mapped.value.as_deref(), Some("52.25"));
        assert_eq!(mapped.max.as_deref(), Some("90.00"));
        assert_eq!(mapped.hardware.as_deref(), Some("k10temp"));

        // The shared selector must accept it, so Linux labels rank correctly.
        assert_eq!(select_cpu_temperature(&[mapped]), Some(52.25));
    }

    #[test]
    fn a_sysinfo_component_without_a_reading_is_skipped() {
        // `Component::temperature()` is an Option on every platform; a missing
        // reading must not become a sensor holding "0" or "None".
        assert!(map_sysinfo_component("k10temp Tctl", None, Some(90.0)).is_none());
        assert!(map_sysinfo_component("coretemp Package", None, None).is_none());
    }

    #[test]
    fn a_sysinfo_component_without_a_max_still_maps() {
        let mapped = map_sysinfo_component("coretemp Package id 0", Some(45.0), None)
            .expect("max is optional");
        assert_eq!(mapped.value.as_deref(), Some("45.00"));
        assert!(mapped.max.is_none());
    }

    #[test]
    fn intel_coretemp_labels_are_ranked_as_the_package_sensor() {
        let package = map_sysinfo_component("coretemp Package id 0", Some(61.0), None).unwrap();
        let core = map_sysinfo_component("coretemp Core 0", Some(58.0), None).unwrap();
        assert_eq!(select_cpu_temperature(&[core, package]), Some(61.0));
    }

    // -- parsing ----------------------------------------------------------

    #[test]
    fn parses_provider_numbers_in_any_culture() {
        assert_eq!(parse_provider_number("72"), Some(72.0));
        assert_eq!(parse_provider_number("72.5"), Some(72.5));
        assert_eq!(parse_provider_number("72,5"), Some(72.5));
        assert_eq!(parse_provider_number("1,420"), Some(1420.0));
        assert_eq!(parse_provider_number(" 84.25 W "), Some(84.25));
        assert_eq!(parse_provider_number(""), None);
        assert_eq!(parse_provider_number("N/A"), None);
        assert_eq!(parse_provider_number("--"), None);
    }

    #[test]
    fn clock_conversion_uses_measured_performance() {
        let effective = resolve_effective_clock(Some(3801.0), Some(110.95), &[]);
        let value = effective.expect("effective clock");
        assert!((value - 4217.4).abs() < 1.0, "unexpected clock {value}");

        // Falls back to per-core measurements when no total is reported.
        let per_core = resolve_effective_clock(Some(4000.0), None, &[Some(100.0), Some(50.0)]);
        let value = per_core.expect("effective clock");
        assert!((value - 3000.0).abs() < 0.1, "unexpected clock {value}");

        // No measurement means no clock, never zero.
        assert_eq!(resolve_effective_clock(Some(4000.0), None, &[]), None);
        assert_eq!(resolve_effective_clock(None, Some(110.0), &[]), None);
    }

    #[test]
    fn power_estimate_is_flagged_and_bounded() {
        // Realistic brand strings, as the OS reports them.
        let desktop = estimate_cpu_tdp_watts("AMD Ryzen 7 5700G with Radeon Graphics", 16);
        assert!(desktop > 0.0 && desktop <= 200.0, "unexpected tdp {desktop}");
        // Mobile parts are detected by their model suffix (U/H/HQ/HS/G7...).
        let mobile = estimate_cpu_tdp_watts("Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz", 12);
        let ultrabook = estimate_cpu_tdp_watts("AMD Ryzen 5 4600U with Radeon Graphics", 12);
        let desktop_apu = estimate_cpu_tdp_watts("AMD Ryzen 5 2400G with Radeon Vega Graphics", 8);

        assert!(
            mobile < desktop,
            "mobile TDP ({mobile}) should be below desktop TDP ({desktop})"
        );
        assert!(
            ultrabook <= mobile,
            "ultrabook TDP ({ultrabook}) should not exceed mobile TDP ({mobile})"
        );
        assert!(
            ultrabook < desktop_apu,
            "a mobile part must not share a TDP class with a desktop APU"
        );
    }

    #[test]
    fn mobile_cpu_suffixes_are_recognized() {
        for brand in [
            "Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz",
            "AMD Ryzen 5 4600U with Radeon Graphics",
            "Intel(R) Core(TM) i7-1165G7 @ 2.80GHz",
        ] {
            assert!(
                has_mobile_model_suffix(brand),
                "{brand} should be recognized as a mobile model"
            );
            let value = estimate_cpu_tdp_watts(brand, 12);
            assert!(
                value <= 45.0,
                "{brand} should be treated as mobile, got {value}"
            );
        }

        // Desktop parts must not be misread as mobile.
        for brand in [
            "AMD Ryzen 7 5700G with Radeon Graphics",
            "AMD Ryzen 5 2400G with Radeon Vega Graphics",
            "Intel(R) Core(TM) i9-13900K CPU @ 3.00GHz",
        ] {
            assert!(
                !has_mobile_model_suffix(brand),
                "{brand} must stay classified as a desktop part"
            );
        }
    }

    #[test]
    fn throttle_detection_requires_high_utilization() {
        assert_eq!(derive_throttling(Some(20.0), Some(3800.0), Some(4400.0)), Some(false));
        assert_eq!(derive_throttling(Some(100.0), Some(2500.0), Some(4400.0)), Some(true));
        assert_eq!(derive_throttling(Some(100.0), Some(4300.0), Some(4400.0)), Some(false));
        assert_eq!(derive_throttling(Some(100.0), None, Some(4400.0)), None);
        assert_eq!(derive_throttling(None, Some(4300.0), Some(4400.0)), None);
    }

    // -- per-core ---------------------------------------------------------

    #[test]
    fn maps_per_core_temperatures_to_logical_cores() {
        let sensors = vec![
            cpu_sensor("CPU Core #1", "Temperature", 50.0),
            cpu_sensor("CPU Core #3", "Temperature", 54.0),
        ];
        let cores = select_per_core_temperatures(&sensors, 4);
        assert_eq!(cores, vec![Some(50.0), None, Some(54.0), None]);
    }

    #[test]
    fn expands_ccd_sensors_across_cores() {
        let sensors = vec![
            cpu_sensor("CCD1 (Tdie)", "Temperature", 60.0),
            cpu_sensor("CCD2 (Tdie)", "Temperature", 64.0),
        ];
        let cores = select_per_core_temperatures(&sensors, 4);
        assert_eq!(cores, vec![Some(62.0); 4]);
    }

    #[test]
    fn core_temperature_ignores_distance_to_tjmax() {
        let sensors = vec![cpu_sensor("CPU Core #1 Distance to TjMax", "Temperature", 30.0)];
        let cores = select_per_core_temperatures(&sensors, 2);
        assert_eq!(cores, vec![None, None]);
    }

    // -- provider route ---------------------------------------------------

    #[test]
    fn provider_labels_and_reliability() {
        assert!(ProviderKind::LibreHardwareMonitor.is_reliable_temperature());
        assert!(ProviderKind::HwinfoRegistry.is_reliable_temperature());
        assert!(!ProviderKind::AcpiThermalZone.is_reliable_temperature());
        assert!(!ProviderKind::None.is_reliable_temperature());
        assert_eq!(ProviderKind::None.as_str(), "none");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn hwinfo_value_types_map_to_sensor_types() {
        assert_eq!(normalize_hwinfo_type("1", None), "Temperature");
        assert_eq!(normalize_hwinfo_type("3", None), "Fan");
        assert_eq!(normalize_hwinfo_type("5", Some("W")), "Power");
        assert_eq!(normalize_hwinfo_type("", Some("RPM")), "Fan");
        assert_eq!(normalize_hwinfo_type("", Some("°C")), "Temperature");
    }

    #[test]
    fn provider_cache_serves_cached_snapshot() {
        let probe = Arc::new(ProviderProbe::new());
        store_probe_result(
            &probe,
            Ok(SensorSnapshot {
                provider: ProviderKind::LibreHardwareMonitor,
                sensors: vec![cpu_sensor("CPU Package", "Temperature", 60.0)],
                detail: "cached".to_string(),
            }),
        );

        let mut cache = CachedProvider {
            probe: Some(probe.clone()),
        };

        // Within the TTL the cached probe is returned without re-querying.
        let snapshot = cache.get().expect("cached snapshot");
        assert_eq!(snapshot.provider, ProviderKind::LibreHardwareMonitor);
        assert_eq!(snapshot.sensors.len(), 1);

        // A fresh probe result replaces the cached one.
        store_probe_result(
            &probe,
            Ok(SensorSnapshot {
                provider: ProviderKind::LibreHardwareMonitor,
                sensors: vec![cpu_sensor("CPU Package", "Temperature", 65.0)],
                detail: "refreshed".to_string(),
            }),
        );
        let refreshed = cache.get().expect("refreshed snapshot");
        assert_eq!(refreshed.sensors.len(), 1);
    }

    #[test]
    fn temporary_provider_failure_recovers() {
        let probe = Arc::new(ProviderProbe::new());
        store_probe_result(&probe, Err("provider timed out".to_string()));
        let cache = CachedProvider {
            probe: Some(probe.clone()),
        };

        // The failure is preserved for diagnostics instead of being retried on
        // every poll, and a later successful probe clears it.
        assert!(cache.last_error().is_some());
        store_probe_result(
            &probe,
            Ok(SensorSnapshot {
                provider: ProviderKind::LibreHardwareMonitor,
                sensors: vec![cpu_sensor("CPU Package", "Temperature", 71.0)],
                detail: "recovered".to_string(),
            }),
        );
        assert!(cache.last_error().is_none());
        assert!(cache
            .probe
            .as_ref()
            .expect("probe")
            .inner
            .lock()
            .expect("lock")
            .snapshot
            .is_some());
    }

    #[test]
    fn provider_read_never_blocks_on_a_probe() {
        // `get` must return immediately even on the very first call: probing
        // happens on a detached thread so a slow WMI provider cannot stall a
        // telemetry request or the sampler.
        let mut cache = CachedProvider::new();
        let started = Instant::now();
        let first = cache.get();
        let elapsed = started.elapsed();

        assert!(
            elapsed < Duration::from_millis(50),
            "first provider read blocked for {elapsed:?}"
        );
        // On a machine with no provider the first read legitimately has nothing
        // to report yet; what matters is that it did not wait for the probe.
        let _ = first;

        let started = Instant::now();
        let _ = cache.get();
        assert!(
            started.elapsed() < Duration::from_millis(50),
            "cached read must be immediate"
        );
    }

    #[test]
    fn collector_reports_unavailable_without_provider() {
        let mut collector = CpuTelemetryCollector::new();
        // On CI there is no hardware provider; essentials must still be valid.
        let telemetry = collect(&mut collector);
        assert!(telemetry.logical_cores >= 1);
        assert!(!telemetry.model.is_empty());
        assert!(telemetry.utilization_percent.unwrap_or(0.0) >= 0.0);
        assert!(telemetry.timestamp.contains('T'));
        if telemetry.temperature_c.is_none() {
            assert!(telemetry.missing.iter().any(|entry| entry == "temperature"));
        }
    }

    #[test]
    fn missing_metrics_are_null_in_serialized_payload() {
        // A missing sensor must serialize as null so the UI can render N/A,
        // and a real 0 must stay distinguishable from it.
        let telemetry = CpuTelemetry {
            model: "Test CPU".to_string(),
            utilization_percent: Some(0.0),
            temperature_c: None,
            package_temperature_c: None,
            clock_mhz: None,
            max_clock_mhz: None,
            base_clock_mhz: None,
            package_power_w: None,
            fan_rpm: None,
            physical_cores: Some(4),
            logical_cores: 8,
            voltage_v: None,
            per_core: Vec::new(),
            throttling: None,
            temperature_source: None,
            power_source: None,
            fan_source: None,
            power_is_estimated: false,
            provider: "none".to_string(),
            provider_label: "unavailable".to_string(),
            status: "unavailable".to_string(),
            temperature_reliable: false,
            platform: "windows".to_string(),
            timestamp: "2024-01-01T00:00:00.000Z".to_string(),
            missing: vec!["temperature".to_string()],
            collection_ms: 0.5,
        };

        let json = serde_json::to_value(&telemetry).expect("serialize");
        assert!(json["temperature_c"].is_null());
        assert_eq!(json["utilization_percent"], serde_json::json!(0.0));
        assert!(!json["temperature_c"].is_number());
    }

    #[test]
    fn sensor_returning_after_temporary_failure_is_used() {        // A provider that recovers must surface values again.
        let recovered = vec![cpu_sensor("CPU Package", "Temperature", 71.0)];
        assert_eq!(select_cpu_temperature(&recovered), Some(71.0));
    }

    /// Manual verification of telemetry cost on real hardware, including under
    /// full CPU load:
    ///
    /// `cargo test --release -- --ignored --nocapture telemetry_overhead`
    ///
    /// Asserts only a very loose upper bound so it stays meaningful on slow
    /// machines; the printed numbers are the measurement.
    #[test]
    #[ignore = "measures real collection cost and CPU load on this machine"]
    fn telemetry_overhead_under_full_load() {
        let mut collector = CpuTelemetryCollector::new();

        // Warm up the provider and establish a utilization baseline the same way
        // the app does: the sampler refreshes, the request path reads the cache.
        for _ in 0..3 {
            collector.refresh_utilization();
            let _ = collect(&mut collector);
            std::thread::sleep(SAMPLE_INTERVAL);
        }

        let idle = average_collection_ms(&mut collector, 8);
        let idle_sample = average_sample_ms(&mut collector, 8);

        // Saturate every logical CPU the way Stress Test does.
        let threads = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1);
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut workers = Vec::new();
        for _ in 0..threads {
            let stop = stop.clone();
            workers.push(std::thread::spawn(move || {
                let mut accumulator = 0u64;
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    accumulator = accumulator.wrapping_add(1).wrapping_mul(2654435761);
                    std::hint::black_box(accumulator);
                }
            }));
        }

        let loaded = average_collection_ms(&mut collector, 12);
        let loaded_sample = average_sample_ms(&mut collector, 12);
        let telemetry = collect(&mut collector);

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        for worker in workers {
            let _ = worker.join();
        }

        println!("collector: idle {idle:.2} ms/call, loaded {loaded:.2} ms/call");
        println!(
            "sampler: idle {idle_sample:.2} ms/sample, loaded {loaded_sample:.2} ms/sample"
        );
        println!(
            "under load: utilization {:?}%, clock {:?} MHz, temp {:?} C, provider {}, missing {:?}",
            telemetry.utilization_percent,
            telemetry.clock_mhz,
            telemetry.temperature_c,
            telemetry.provider,
            telemetry.missing
        );
        // Telemetry must remain cheap even with every core busy, otherwise the
        // stress test measures its own monitor.
        assert!(idle < 50.0, "idle collection too slow: {idle:.2} ms");
        assert!(loaded < 80.0, "collection under load too slow: {loaded:.2} ms");
        assert!(
            loaded_sample < 20.0,
            "background utilization sample too slow under load: {loaded_sample:.2} ms"
        );
        // Telemetry must keep working at 100% CPU.
        assert!(telemetry.logical_cores >= 1);
        assert!(
            telemetry.utilization_percent.unwrap_or(0.0) >= 0.0,
            "utilization must stay valid under load"
        );
    }

    /// Exercises the exact production topology while a real IPC thread requests
    /// telemetry at 1 Hz: one background sampler thread, one request thread, all
    /// logical CPUs saturated. Prints every value so the payload the UI receives
    /// can be inspected.
    ///
    /// `cargo test --release -- --ignored --nocapture telemetry_live_run`
    #[test]
    #[ignore = "runs the live sampler plus request loop under full CPU load"]
    fn telemetry_live_run_under_load() {
        let state = Arc::new(Mutex::new(CpuTelemetryCollector::new()));
        let running = Arc::new(std::sync::atomic::AtomicBool::new(true));

        // Background sampler: identical loop to `start_sampler`, minus the Tauri
        // event handle.
        let sampler_state = state.clone();
        let sampler_running = running.clone();
        let sampler = std::thread::spawn(move || {
            while sampler_running.load(std::sync::atomic::Ordering::Relaxed) {
                std::thread::sleep(SAMPLE_INTERVAL);
                let mut guard = sampler_state.lock().unwrap_or_else(|error| error.into_inner());
                guard.refresh_utilization();
            }
        });

        // Saturate every logical CPU the way Stress Test does.
        let threads = std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(1);
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let mut workers = Vec::new();
        for _ in 0..threads {
            let stop = stop.clone();
            workers.push(std::thread::spawn(move || {
                let mut accumulator = 0u64;
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    accumulator = accumulator.wrapping_add(1).wrapping_mul(2654435761);
                    std::hint::black_box(accumulator);
                }
            }));
        }

        let mut idle_utilization = None;
        let mut loaded_samples = Vec::new();
        let mut clock_samples = Vec::new();
        let mut max_collection_ms: f64 = 0.0;

        for second in 0..14 {
            let telemetry = {
                let mut guard = state.lock().unwrap_or_else(|error| error.into_inner());
                collect(&mut guard)
            };
            max_collection_ms = max_collection_ms.max(telemetry.collection_ms);

            if second == 2 {
                idle_utilization = telemetry.utilization_percent;
            }
            if second >= 4 {
                if let Some(value) = telemetry.utilization_percent {
                    loaded_samples.push(value);
                }
                if let Some(value) = telemetry.clock_mhz {
                    clock_samples.push(value);
                }
            }

            println!(
                "t={second:2}s util={:?} temp={:?} clock={:?} power={:?} fan={:?} throttling={:?} provider={} missing={:?} collect={:.2}ms",
                telemetry.utilization_percent,
                telemetry.temperature_c,
                telemetry.clock_mhz.map(|value| value.round()),
                telemetry.package_power_w.map(|value| value.round()),
                telemetry.fan_rpm,
                telemetry.throttling,
                telemetry.provider,
                telemetry.missing,
                telemetry.collection_ms
            );
            std::thread::sleep(SAMPLE_INTERVAL);
        }

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        for worker in workers {
            let _ = worker.join();
        }
        running.store(false, std::sync::atomic::Ordering::Relaxed);
        let _ = sampler.join();

        // The whole point: telemetry stays live and cheap while the CPU is
        // pinned, so the stress test measures the CPU and not the monitor.
        let average_utilization =
            loaded_samples.iter().sum::<f32>() / loaded_samples.len().max(1) as f32;
        println!(
            "summary: idle util {idle_utilization:?}%, loaded avg {average_utilization:.1}%, clock samples {}, max collection {max_collection_ms:.2} ms",
            clock_samples.len()
        );

        assert!(!loaded_samples.is_empty(), "utilization must be reported under load");
        assert!(
            average_utilization > 60.0,
            "expected the CPU to be saturated, saw {average_utilization:.1}%"
        );
        assert!(
            !clock_samples.is_empty(),
            "effective clock must be available while under load"
        );
        assert!(
            clock_samples.iter().all(|value| *value > 500.0 && *value < 8000.0),
            "effective clock out of plausible range: {clock_samples:?}"
        );
        // Every request must complete quickly even with all cores busy.
        assert!(
            max_collection_ms < 50.0,
            "a telemetry request blocked for {max_collection_ms:.2} ms"
        );
    }

    fn average_collection_ms(collector: &mut CpuTelemetryCollector, samples: usize) -> f64 {
        let mut total = 0.0;
        for _ in 0..samples {
            // Mirror the production cadence: one background sample, one request.
            collector.refresh_utilization();
            let telemetry = collect(collector);
            total += telemetry.collection_ms;
            std::thread::sleep(SAMPLE_INTERVAL);
        }
        total / samples as f64
    }

    fn average_sample_ms(collector: &mut CpuTelemetryCollector, samples: usize) -> f64 {
        let mut total = 0.0;
        for _ in 0..samples {
            // Exactly what the background sampler does once per interval.
            let started = Instant::now();
            collector.refresh_utilization();
            total += started.elapsed().as_secs_f64() * 1000.0;
            std::thread::sleep(SAMPLE_INTERVAL);
        }
        total / samples as f64
    }

    /// Compares the candidate system-wide sampling APIs so the utilization
    /// source can be chosen on measurement rather than assumption.
    #[test]
    #[ignore = "measures Windows CPU sampling API cost under full load"]
    fn utilization_source_cost() {
        #[cfg(target_os = "windows")]
        {
            let mut source = UtilizationSource::new();
            let mut system = System::new();
            let mut sample = |name: &str, iterations: usize| {
                let started = Instant::now();
                for _ in 0..iterations {
                    let _ = system_times();
                }
                let get_system_times = started.elapsed().as_secs_f64() * 1000.0 / iterations as f64;

                let started = Instant::now();
                for _ in 0..iterations {
                    let _ = source.sample(&mut system);
                }
                let pdh_ms = started.elapsed().as_secs_f64() * 1000.0 / iterations as f64;

                println!("{name}: GetSystemTimes {get_system_times:.3} ms, PDH sample {pdh_ms:.3} ms");
            };

            sample("idle", 20);

            let threads = std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1);
            let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let mut workers = Vec::new();
            for _ in 0..threads {
                let stop = stop.clone();
                workers.push(std::thread::spawn(move || {
                    let mut accumulator = 0u64;
                    while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                        accumulator = accumulator.wrapping_add(1).wrapping_mul(2654435761);
                        std::hint::black_box(accumulator);
                    }
                }));
            }
            std::thread::sleep(Duration::from_millis(500));

            sample("loaded", 20);

            stop.store(true, std::sync::atomic::Ordering::Relaxed);
            for worker in workers {
                let _ = worker.join();
            }
        }
    }
}

/// The Linux sysfs parsers are exercised against a fixture tree, so sensor
/// matching and unit conversion are verified without the actual hardware.
#[cfg(test)]
mod linux_tests {
    use super::*;
    use std::fs;

    fn fixture(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("minebench-hwmon-{tag}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create fixture root");
        root
    }

    fn write(path: &Path, contents: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .unwrap_or_else(|error| panic!("create {}: {error}", parent.display()));
        }
        fs::write(path, contents).unwrap_or_else(|error| panic!("write {}: {error}", path.display()));
    }

    #[test]
    fn reads_a_labelled_cpu_fan_only() {
        let root = fixture("fans");
        let cpu = root.join("hwmon0");
        write(&cpu.join("name"), "nct6798\n");
        write(&cpu.join("fan1_input"), "1420\n");
        write(&cpu.join("fan1_label"), "CPU Fan\n");
        write(&cpu.join("fan2_input"), "900\n");
        write(&cpu.join("fan2_label"), "System Fan #2\n");

        let sensors = read_linux_hwmon_fans(&root);
        assert_eq!(
            sensors.len(),
            1,
            "only the CPU fan may be reported: {sensors:?}"
        );
        assert_eq!(sensors[0].name, "CPU Fan");
        assert_eq!(sensors[0].value.as_deref(), Some("1420"));
        assert_eq!(sensors[0].unit.as_deref(), Some("RPM"));
    }

    #[test]
    fn an_unlabelled_fan_is_not_assumed_to_be_the_cpu_fan() {
        let root = fixture("unlabelled");
        let device = root.join("hwmon0");
        write(&device.join("name"), "nct6798\n");
        write(&device.join("fan1_input"), "1100\n");

        // Guessing here would display a chassis fan as the CPU fan.
        assert!(read_linux_hwmon_fans(&root).is_empty());
    }

    #[test]
    fn cpu_fan_label_matching_handles_the_usual_spellings() {
        for label in ["CPU_FAN", "cpu_fan1", "CPU Fan", "Processor Fan", "cpu0_fan"] {
            assert!(is_cpu_fan_label(Some(label)), "{label} should match");
        }
        for label in ["SYS_FAN1", "System Fan", "AIO Pump", "fan1", "GPU Fan"] {
            assert!(!is_cpu_fan_label(Some(label)), "{label} must not match");
        }
        assert!(!is_cpu_fan_label(None));
    }

    #[test]
    fn hwmon_voltage_is_converted_from_millivolts() {
        let root = fixture("volts");
        let cpu = root.join("hwmon0");
        write(&cpu.join("name"), "k10temp\n");
        write(&cpu.join("in0_input"), "1250\n");
        write(&cpu.join("in0_label"), "Vcore\n");
        // A board sensor on a non-CPU device must be ignored.
        let board = root.join("hwmon1");
        write(&board.join("name"), "nct6798\n");
        write(&board.join("in1_input"), "12000\n");

        let sensors = read_linux_hwmon_voltage(&root);
        assert_eq!(sensors.len(), 1, "only CPU devices qualify: {sensors:?}");
        let value: f64 = sensors[0].value.as_deref().unwrap().parse().unwrap();
        assert!((value - 1.25).abs() < 1e-9, "expected 1.25 V, got {value}");
    }

    #[test]
    fn implausible_voltages_are_rejected() {
        let root = fixture("badvolts");
        let cpu = root.join("hwmon0");
        write(&cpu.join("name"), "coretemp\n");
        write(&cpu.join("in0_input"), "12000\n"); // a 12 V rail, not core voltage
        assert!(read_linux_hwmon_voltage(&root).is_empty());
    }

    #[test]
    fn missing_rapl_returns_none_rather_than_zero() {
        let root = fixture("norapl");
        assert!(read_linux_rapl_power_watts(&root).is_none());
    }

    #[test]
    fn a_non_advancing_energy_counter_is_not_reported_as_power() {
        let root = fixture("frozen");
        let package = root.join("intel-rapl-0");
        write(&package.join("name"), "package-0\n");
        write(&package.join("energy_uj"), "5000000\n");
        // Energy that never advances has no usable delta; reporting it as 0 W
        // would be a fabricated reading.
        assert!(read_linux_rapl_power_watts(&root).is_none());
    }
}
