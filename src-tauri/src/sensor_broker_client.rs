//! Client side of the privileged CPU sensor broker.
//!
//! The broker (`minebench-sensor-broker.exe`) is the only component that runs
//! elevated, because the PawnIO device security descriptor grants access solely
//! to LocalSystem and administrators. It is started through a highest-privileges
//! scheduled task registered once by the installer, so the GUI itself never
//! elevates and the user is never asked for approval.
//!
//! The broker publishes one JSON snapshot per run and exits. This module starts
//! it on demand and reads that snapshot:
//!
//! * `request_reading` asks the scheduler to run the task and waits briefly.
//! * `read_snapshot` parses the latest snapshot if it is fresh and matches the
//!   schema this build understands.
//!
//! A missing, stale or unparsable snapshot is reported as "unavailable" so the
//! caller falls back to whatever else it can measure. Nothing is invented.

use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// Must match the broker's `SCHEMA`. A mismatch means an older or newer broker
/// was left behind by an installation, and its numbers cannot be trusted.
const SCHEMA: u32 = 1;

/// Scheduled task name registered by the installer.
pub const TASK_NAME: &str = "MineBenchSensorBroker";

/// Snapshot older than this is not live.
pub const SNAPSHOT_STALE_AFTER: Duration = Duration::from_secs(5);

/// How long a freshly requested reading may take before giving up.
///
/// The broker needs ~150 ms on an idle machine but was measured at 1.4 s while
/// every core ran at 100%, which is the state the stress test exists to create.
/// The budget therefore has to survive a starved sampler, and it stays below
/// [`SNAPSHOT_STALE_AFTER`], so the fallback reading is never stale either.
const REQUEST_TIMEOUT: Duration = Duration::from_millis(4000);

/// One broker reading, already normalized by the broker.
#[derive(Debug, Clone, Deserialize)]
pub struct BrokerSnapshot {
    #[serde(default)]
    pub schema: u32,
    #[serde(default)]
    /// Provider id the broker used, surfaced in the diagnostics report.
    #[allow(dead_code)]
    pub provider: Option<String>,
    #[serde(default)]
    pub provider_detail: Option<String>,
    #[serde(default)]
    pub module: Option<String>,
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub temperature_c: Option<f64>,
    #[serde(default)]
    pub temperature_source: Option<String>,
    #[serde(default)]
    pub package_power_w: Option<f64>,
    /// The fan the broker identified as the CPU's, and how it decided.
    #[serde(default)]
    pub fan_rpm: Option<f64>,
    #[serde(default)]
    pub fan_source: Option<String>,
    /// Every fan channel the motherboard's Super-I/O reported, so the
    /// attribution above can be checked rather than trusted.
    #[serde(default)]
    pub fans: Vec<BrokerFan>,
    #[serde(default)]
    pub raw_smn: Option<String>,
}

/// One channel of the motherboard's fan controller.
#[derive(Debug, Clone, Deserialize)]
pub struct BrokerFan {
    #[serde(default)]
    pub channel: usize,
    #[serde(default)]
    pub rpm: Option<f64>,
    #[serde(default)]
    pub temperature_source: Option<u8>,
    #[serde(default)]
    pub temperature_source_name: Option<String>,
    #[serde(default)]
    pub is_cpu: bool,
}

impl BrokerSnapshot {
    pub fn is_usable(&self) -> bool {
        self.schema == SCHEMA
    }

    /// True when the broker actually measured something.
    pub fn has_readings(&self) -> bool {
        self.temperature_c.is_some() || self.package_power_w.is_some()
    }
}

/// Where the broker publishes its snapshots.
#[derive(Debug, Clone)]
pub struct BrokerPaths {
    pub snapshot: PathBuf,
}

impl BrokerPaths {
    /// `%LOCALAPPDATA%\MineBench\sensors\broker.json`, matching the broker's
    /// own default so both sides agree without configuration.
    pub fn resolve() -> Self {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("MineBench")
            .join("sensors");
        Self::in_directory(base)
    }

    fn in_directory(directory: PathBuf) -> Self {
        Self {
            snapshot: directory.join("broker.json"),
        }
    }
}

/// Candidate names of the broker executable.
#[cfg(target_os = "windows")]
const BROKER_EXE: &str = "minebench-sensor-broker.exe";

/// Locates the broker executable shipped inside the application bundle.
///
/// It is installed as a resource, so the exact folder depends on how the bundle
/// was produced. The paths are searched rather than assumed, and the client
/// also tells the installer where to find it so both agree.
#[cfg(target_os = "windows")]
pub fn resolve_broker_path() -> Option<PathBuf> {
    use std::sync::OnceLock;
    static CACHED: OnceLock<Option<PathBuf>> = OnceLock::new();

    CACHED
        .get_or_init(|| {
            // An explicit override keeps development builds workable.
            if let Some(explicit) = std::env::var_os("MINEBENCH_SENSOR_BROKER") {
                let path = PathBuf::from(explicit);
                if path.is_file() {
                    return Some(path);
                }
            }

            let mut roots: Vec<PathBuf> = Vec::new();
            if let Ok(exe) = std::env::current_exe() {
                if let Some(directory) = exe.parent() {
                    roots.push(directory.to_path_buf());
                    // Tauri keeps resources under `_up_` next to the binary.
                    roots.push(directory.join("_up_"));
                }
            }
            if let Some(resources) = std::env::var_os("MINEBENCH_RESOURCE_DIR") {
                roots.push(PathBuf::from(resources));
            }

            const RELATIVE: [&str; 3] = [
                "minebench-sensor-broker.exe",
                "resources/sensor-broker/minebench-sensor-broker.exe",
                "_up_/resources/sensor-broker/minebench-sensor-broker.exe",
            ];

            for root in &roots {
                for relative in RELATIVE {
                    let candidate = root.join(relative);
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
                // Fall back to a shallow search: the bundler may nest the
                // sidecar differently between installers.
                if let Some(found) = search_shallow(root, BROKER_EXE, 3) {
                    return Some(found);
                }
            }
            None
        })
        .clone()
}

#[cfg(target_os = "windows")]
fn search_shallow(root: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    if depth == 0 {
        return None;
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if path.file_name().map(|file| file == name).unwrap_or(false) {
                return Some(path);
            }
        } else if path.is_dir() {
            if let Some(found) = search_shallow(&path, name, depth - 1) {
                return Some(found);
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
pub fn resolve_broker_path() -> Option<PathBuf> {
    None
}

/// Reads the newest snapshot without starting anything.
pub fn read_snapshot() -> Option<BrokerSnapshot> {
    read_from(&BrokerPaths::resolve().snapshot)
}

fn read_from(path: &Path) -> Option<BrokerSnapshot> {
    let age = SystemTime::now()
        .duration_since(std::fs::metadata(path).ok()?.modified().ok()?)
        .ok()?;
    if age > SNAPSHOT_STALE_AFTER {
        return None;
    }
    let contents = std::fs::read_to_string(path).ok()?;
    let snapshot: BrokerSnapshot = serde_json::from_str(&contents).ok()?;
    snapshot.is_usable().then_some(snapshot)
}

/// Asks the scheduler to run the broker and waits for a fresh snapshot.
///
/// Returns `None` when the task is not registered, was blocked by policy, or
/// simply did not produce a reading in time. Callers treat that as "no sensor"
/// rather than an error, because a machine without the task is expected to work
/// with temperature unavailable.
pub fn request_reading() -> Option<BrokerSnapshot> {
    let paths = BrokerPaths::resolve();
    let before = std::fs::metadata(&paths.snapshot)
        .ok()
        .and_then(|meta| meta.modified().ok());

    if !start_task() {
        return None;
    }

    let deadline = std::time::Instant::now() + REQUEST_TIMEOUT;
    while std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(120));
        let modified = std::fs::metadata(&paths.snapshot)
            .ok()
            .and_then(|meta| meta.modified().ok());
        if modified.is_some() && modified != before {
            return read_snapshot();
        }
    }

    // The task may have run but produced nothing new; report whatever is fresh.
    read_snapshot()
}

/// Starts the registered task. Returns false when it is absent or refused.
#[cfg(target_os = "windows")]
fn start_task() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let status = std::process::Command::new("schtasks")
        .args(["/Run", "/TN", TASK_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    matches!(status, Ok(status) if status.success())
}

#[cfg(not(target_os = "windows"))]
fn start_task() -> bool {
    // The Unix platforms read hwmon/SMC directly; there is no broker at all.
    false
}

/// True when the task exists, so diagnostics can explain its absence.
#[cfg(target_os = "windows")]
pub fn task_registered() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    std::process::Command::new("schtasks")
        .args(["/Query", "/TN", TASK_NAME])
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn task_registered() -> bool {
    false
}

/// One step of the broker diagnostic, so a failure can be pinned to a link in
/// the chain instead of guessed at.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiagnosticStep {
    pub step: String,
    pub ok: bool,
    pub detail: String,
}

/// Walks the whole chain and reports each link.
///
/// Support value: when temperature is missing on a user's machine, this says
/// whether the binary is missing, the task is unregistered, the task refused to
/// run, the snapshot is stale, the schema mismatched, or the register read
/// failed — five very different problems that otherwise all look like "N/A".
pub fn diagnose() -> Vec<DiagnosticStep> {
    let mut steps = Vec::new();

    if !cfg!(target_os = "windows") {
        steps.push(DiagnosticStep {
            step: "platform".into(),
            ok: true,
            detail: "not used on this platform; hwmon/SMC is read directly".into(),
        });
        return steps;
    }

    // 1. Is the broker executable present where the bundle puts it?
    let broker_path = resolve_broker_path();
    steps.push(DiagnosticStep {
        step: "broker-binary".into(),
        ok: broker_path.is_some(),
        detail: broker_path
            .as_ref()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "minebench-sensor-broker.exe not found next to the installation".into()),
    });

    // 2. Is the highest-privileges task the installer registers present?
    let registered = task_registered();
    steps.push(DiagnosticStep {
        step: "scheduled-task".into(),
        ok: registered,
        detail: if registered {
            format!("task '{TASK_NAME}' is registered")
        } else {
            format!(
                "task '{TASK_NAME}' is missing; this is expected in a development build, and the installer registers it"
            )
        },
    });

    if !registered {
        // Starting a task that does not exist would only add noise.
        return steps;
    }

    // 3. Did asking the scheduler for a reading produce a fresh snapshot?
    let before = std::fs::metadata(BrokerPaths::resolve().snapshot)
        .ok()
        .and_then(|meta| meta.modified().ok());
    let started = std::time::Instant::now();
    let snapshot = request_reading();
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let after = std::fs::metadata(BrokerPaths::resolve().snapshot)
        .ok()
        .and_then(|meta| meta.modified().ok());

    steps.push(DiagnosticStep {
        step: "task-run".into(),
        ok: snapshot.is_some(),
        detail: match (after.is_some(), after != before) {
            (_, true) => format!("a fresh snapshot arrived in {elapsed_ms:.0} ms"),
            (true, false) => format!(
                "no new snapshot after {elapsed_ms:.0} ms; the task may be blocked by policy or the broker exited early"
            ),
            (false, _) => format!(
                "no snapshot at all after {elapsed_ms:.0} ms; the broker may be failing to start"
            ),
        },
    });

    let Some(snapshot) = snapshot else {
        return steps;
    };

    // 4. Schema of the snapshot this build understands.
    steps.push(DiagnosticStep {
        step: "snapshot-schema".into(),
        ok: true,
        detail: format!(
            "schema {} accepted (module {})",
            snapshot.schema,
            snapshot.module.as_deref().unwrap_or("unknown")
        ),
    });

    // 5. Did the driver actually return a temperature?
    let has_temperature = snapshot.temperature_c.is_some();
    steps.push(DiagnosticStep {
        step: "temperature".into(),
        ok: has_temperature,
        detail: match snapshot.temperature_c {
            Some(value) => format!(
                "{value:.3} C from {}{}",
                snapshot.temperature_source.as_deref().unwrap_or("unknown register"),
                snapshot
                    .raw_smn
                    .as_deref()
                    .map(|raw| format!(" (raw {raw})"))
                    .unwrap_or_default()
            ),
            None => snapshot
                .provider_detail
                .unwrap_or_else(|| "the broker ran but reported no temperature".into()),
        },
    });

    // 6. Package power is optional, so it is reported without failing the chain.
    steps.push(DiagnosticStep {
        step: "package-power".into(),
        ok: true,
        detail: match snapshot.package_power_w {
            Some(value) => format!("{value:.2} W"),
            None => "not reported by this CPU or blocked by policy (optional)".into(),
        },
    });

    // 7. The CPU fan. The motherboard's fan controller is read over the LPC
    //    bus, which is a different module and a different bus from the CPU
    //    registers above, so it fails independently.
    let channels = fan_channels_summary(&snapshot.fans);
    steps.push(DiagnosticStep {
        step: "cpu-fan".into(),
        ok: true,
        detail: match snapshot.fan_rpm {
            Some(rpm) => format!(
                "{rpm:.0} rpm - {} | {channels}",
                snapshot.fan_source.as_deref().unwrap_or("source unknown"),
            ),
            None if snapshot.fans.is_empty() => {
                "the motherboard fan controller did not answer (optional on boards \
                 without one, or without the LPC module installed)"
                    .into()
            }
            None => format!(
                "no channel is bound to a processor temperature source, so no fan \
                 is attributed to the CPU | {channels}"
            ),
        },
    });

    steps
}

/// Every fan channel the board reported, in one line.
///
/// The app attributes a fan to the CPU without a vendor header map, so the
/// channel table is what makes that attribution checkable on a machine nobody
/// can inspect directly.
fn fan_channels_summary(fans: &[BrokerFan]) -> String {
    if fans.is_empty() {
        return "no fan channels".to_string();
    }
    fans.iter()
        .map(|fan| {
            let rpm = match fan.rpm {
                Some(rpm) => format!("{rpm:.0} rpm"),
                // Either nothing is turning, or the two speed registers
                // disagreed: both mean there is no speed to report here.
                None => "no reading".to_string(),
            };
            format!(
                "#{}: {rpm}, follows {} [{}] ({})",
                fan.channel + 1,
                fan.temperature_source_name.as_deref().unwrap_or("an unknown source"),
                fan.temperature_source
                    .map(|source| source.to_string())
                    .unwrap_or_else(|| "?".to_string()),
                if fan.is_cpu { "processor" } else { "board sensor" }
            )
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Human-readable state for the diagnostics report.
///
/// Includes whether the broker executable was actually found, because a
/// registered task pointing at a missing binary is the most likely failure on a
/// machine we cannot inspect directly.
pub fn diagnostic_detail() -> String {
    if !cfg!(target_os = "windows") {
        return "not used on this platform (hwmon/SMC read directly)".to_string();
    }
    let broker = match resolve_broker_path() {
        Some(path) => path.display().to_string(),
        None => {
            return "the sensor broker executable was not found next to the installation".to_string()
        }
    };
    if !task_registered() {
        return format!(
            "scheduled task '{TASK_NAME}' is not registered; CPU temperature stays unavailable (broker at {broker})"
        );
    }
    match read_snapshot() {
        Some(snapshot) if snapshot.has_readings() => format!(
            "broker reporting via {}",
            snapshot.module.unwrap_or_else(|| "unknown module".to_string())
        ),
        Some(snapshot) => snapshot
            .provider_detail
            .unwrap_or_else(|| "broker ran but produced no reading".to_string()),
        None => "task registered but no fresh snapshot".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(tag: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!("minebench-broker-{tag}"));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("create temp dir");
        directory.join("broker.json")
    }

    const VALID: &str = r#"{
        "schema": 1,
        "provider": "pawnio",
        "module": "AMDFamily17.bin",
        "vendor": "AuthenticAMD",
        "temperature_c": 46.125,
        "temperature_source": "Tctl",
        "package_power_w": 27.5,
        "raw_smn": "0x000000005F2B0000"
    }"#;

    #[test]
    fn reads_a_fresh_snapshot() {
        let path = temp_path("fresh");
        std::fs::write(&path, VALID).expect("write");
        let snapshot = read_from(&path).expect("snapshot");
        assert_eq!(snapshot.temperature_c, Some(46.125));
        assert_eq!(snapshot.package_power_w, Some(27.5));
        assert!(snapshot.has_readings());
    }

    #[test]
    fn a_missing_snapshot_is_unavailable_not_a_zero() {
        let path = temp_path("missing");
        assert!(read_from(&path).is_none());
    }

    #[test]
    fn a_snapshot_from_another_schema_is_rejected() {
        let path = temp_path("schema");
        std::fs::write(&path, r#"{"schema":2,"temperature_c":50.0}"#).expect("write");
        // A broker from a different build must never be trusted.
        assert!(read_from(&path).is_none());
    }

    #[test]
    fn a_broker_that_measured_nothing_has_no_readings() {
        let snapshot: BrokerSnapshot = serde_json::from_str(
            r#"{"schema":1,"provider":"none","provider_detail":"no access","temperature_c":null,"package_power_w":null}"#,
        )
        .expect("parse");
        assert!(snapshot.is_usable());
        assert!(!snapshot.has_readings());
    }

    #[test]
    fn malformed_output_is_ignored() {
        let path = temp_path("malformed");
        std::fs::write(&path, "{ not json").expect("write");
        assert!(read_from(&path).is_none());
    }

    #[test]
    fn a_stale_snapshot_is_not_live() {
        let path = temp_path("stale");
        std::fs::write(&path, VALID).expect("write");
        // Backdate past the staleness window.
        let old = SystemTime::now() - (SNAPSHOT_STALE_AFTER + Duration::from_secs(5));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .expect("open");
        let _ = file.set_modified(old);
        assert!(read_from(&path).is_none());
    }

    #[test]
    fn task_name_is_the_one_the_installer_registers() {
        // Diagnostics, the installer and the client must agree on this string.
        assert_eq!(TASK_NAME, "MineBenchSensorBroker");
    }

    #[test]
    fn diagnostic_reports_every_link_it_reaches() {
        let steps = diagnose();

        // The first two links are always reported, so a failure there is
        // distinguishable from a failure further down the chain.
        assert!(steps.len() >= 2, "expected at least two steps: {steps:?}");
        assert_eq!(steps[0].step, "broker-binary");
        assert_eq!(steps[1].step, "scheduled-task");

        if cfg!(target_os = "windows") {
            // The chain walks a fixed order and never skips a link, so whatever
            // this machine's state happens to be, the steps must be a prefix of
            // it. A development build, a machine without the task and a machine
            // under load all land somewhere different in this list.
            const ORDER: [&str; 7] = [
                "broker-binary",
                "scheduled-task",
                "task-run",
                "snapshot-schema",
                "temperature",
                "package-power",
                "cpu-fan",
            ];
            assert!(steps.len() <= ORDER.len(), "{steps:?}");
            for (index, step) in steps.iter().enumerate() {
                assert_eq!(
                    step.step, ORDER[index],
                    "step {index} is out of order: {steps:?}"
                );
            }

            // The chain must never claim a reading it did not make: stopping
            // early is only allowed on a link that failed.
            if let Some(last) = steps.last() {
                if steps.len() < ORDER.len() {
                    assert!(
                        !last.ok,
                        "the chain stopped at a successful link: {steps:?}"
                    );
                }
            }
        } else {
            // Unix reads hwmon/SMC directly and has no broker at all.
            assert_eq!(steps.len(), 1);
            assert_eq!(steps[0].step, "platform");
            assert!(steps[0].ok);
        }
    }
}
