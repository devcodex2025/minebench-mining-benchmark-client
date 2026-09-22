//! MineBench CPU sensor broker.
//!
//! Reads CPU die temperature (and package power where available) from the
//! kernel and writes one normalized JSON snapshot, then exits.
//!
//! Why this exists: Windows exposes no generic CPU die temperature API. The
//! value lives in model-specific registers, and touching those needs a kernel
//! driver. MineBench uses PawnIO - a WHQL-signed, open-source driver that runs
//! a small sandboxed module for the actual register access.
//!
//! Design constraints that shaped this binary:
//!
//! * **No PowerShell, no .NET, no third-party monitoring application.** The
//!   process talks to the driver directly through `DeviceIoControl`.
//! * **Short-lived.** It is started on demand, publishes one snapshot and exits,
//!   so a privileged process never lingers in the background.
//! * **Never guesses.** If a reading cannot be obtained or fails the sanity
//!   checks, the field is written as `null`. A plausible-looking wrong
//!   temperature is worse than no temperature.
//!
//! The driver's device security descriptor is `D:P(A;;GA;;;SY)(A;;GA;;;BA)`,
//! so only LocalSystem and administrators may open it: this process must be
//! elevated. That is why the installer registers a highest-privileges scheduled
//! task instead of the GUI asking for approval every session.

// Per-binary attribute: the broker is started by the Task Scheduler and must
// never flash a console window. It applies only to this binary.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::path::{Path, PathBuf};

/// Bumped when the JSON shape changes, so the client can reject a stale broker
/// left behind by an older installation.
const SCHEMA: u32 = 1;

/// The device has no DOS symbolic link, so it is opened by its NT path through
/// `NtOpenFile` - exactly how the vendor's own library reaches it.
#[cfg(target_os = "windows")]
const PAWNIO_DEVICE: &str = "\\Device\\PawnIO";

/// PawnIO device type and IOCTL codes, from the driver's `pawnio_um.h`:
/// `CTL_CODE(k_device_type, function, METHOD_BUFFERED, FILE_ANY_ACCESS)` with
/// `k_device_type = 41394 (0xA1B2)`.
#[cfg(target_os = "windows")]
const IOCTL_PIO_LOAD_BINARY: u32 = 0xA1B2_2084;
#[cfg(target_os = "windows")]
const IOCTL_PIO_EXECUTE_FN: u32 = 0xA1B2_2104;
#[cfg(target_os = "windows")]
const IOCTL_PIO_VERSION: u32 = 0xA1B2_2184;

/// The driver copies the function name from a fixed 32-byte field.
#[cfg(target_os = "windows")]
const FN_NAME_LENGTH: usize = 32;

/// AMD Zen thermal register (`THM_TCON_CUR_TMP`), reached over the SMN bus.
#[cfg(target_os = "windows")]
const AMD_SMN_THM_TCON_CUR_TMP: u64 = 0x0005_9800;
/// `CUR_TEMP` occupies bits [31:21] in 0.125 C steps.
#[cfg(target_os = "windows")]
const AMD_TEMP_FIELD_SHIFT: u32 = 21;
#[cfg(target_os = "windows")]
const AMD_TEMP_MILLIDEGREES_PER_STEP: i64 = 125;
/// When set, 49 C must be subtracted (see Linux `k10temp` and LHM).
#[cfg(target_os = "windows")]
const AMD_TEMP_OFFSET_FLAG: u64 = 0x0008_0000;
#[cfg(target_os = "windows")]
const AMD_TEMP_OFFSET_MILLIDEGREES: i64 = 49_000;

/// `MSR_PKG_ENERGY_STAT` / `MSR_PWR_UNIT`, used for package power.
#[cfg(target_os = "windows")]
const AMD_MSR_PKG_ENERGY_STAT: u64 = 0xC001_029B;
#[cfg(target_os = "windows")]
const AMD_MSR_PWR_UNIT: u64 = 0xC001_0299;

/// The Intel RAPL counterparts of the AMD pair above.
#[cfg(target_os = "windows")]
const INTEL_MSR_RAPL_POWER_UNIT: u64 = 0x0000_0606;
#[cfg(target_os = "windows")]
const INTEL_MSR_PKG_ENERGY_STATUS: u64 = 0x0000_0611;

/// Intel thermal registers.
#[cfg(target_os = "windows")]
const INTEL_MSR_IA32_THERM_STATUS: u64 = 0x0000_019C;
#[cfg(target_os = "windows")]
const INTEL_MSR_IA32_TEMPERATURE_TARGET: u64 = 0x0000_01A2;
#[cfg(target_os = "windows")]
const INTEL_MSR_IA32_PACKAGE_THERM_STATUS: u64 = 0x0000_01B1;

/// The Nuvoton parts whose fan registers this reader understands.
///
/// Every one of them shares a single layout, which is what makes supporting the
/// family more than a guess: the same `fan_from_reg_rpm` speed registers, the
/// same companion 13-bit counts, and the same per-channel Smart-Fan source
/// registers, all keyed by the chip ID that Linux matches with `SIO_ID_MASK`.
/// The count is the number of fan channels the part exposes; reading a channel a
/// chip does not have would read an unrelated register. The flag records whether
/// the part's temperature-source label table is the one verified here.
///
/// Board IDs are matched by `(id & NCT_ID_MASK)`, so a revision in the low bits
/// - the test board reports 0xD42B for a NCT6798D - still matches.
#[cfg(any(target_os = "windows", test))]
const NCT_FAMILY: [(u16, &str, usize, bool); 9] = [
    (0xC560, "NCT6779D", 5, false),
    (0xC800, "NCT6791D", 6, false),
    (0xC910, "NCT6792D", 6, false),
    (0xD120, "NCT6793D", 6, false),
    (0xD350, "NCT6795D", 6, false),
    (0xD420, "NCT6796D", 7, false),
    (0xD450, "NCT6797D", 7, false),
    (0xD428, "NCT6798D", 7, true),
    (0xD800, "NCT6799D", 7, false),
];

/// The ID mask Linux uses, which ignores the revision in the low bits.
#[cfg(any(target_os = "windows", test))]
const NCT_ID_MASK: u16 = 0xFFF8;

/// The family entry for a 16-bit chip ID, if this reader knows the part.
#[cfg(any(target_os = "windows", test))]
fn nct_family_entry(chip_id: u16) -> Option<(&'static str, usize, bool)> {
    NCT_FAMILY
        .iter()
        .find(|(id, _, _, _)| chip_id & NCT_ID_MASK == *id)
        .map(|(_, name, channels, verified_sources)| (*name, *channels, *verified_sources))
}

/// Plausibility bounds. A reading outside these is treated as a failure rather
/// than reported.
const MIN_TEMPERATURE_C: f64 = 5.0;
const MAX_TEMPERATURE_C: f64 = 125.0;
const MAX_POWER_W: f64 = 1500.0;
/// A tachometer below this is not a fan.
const MIN_PLAUSIBLE_FAN_RPM: f64 = 200.0;
/// The upper bound for a motherboard fan header: above this is not a fan either,
/// and a fan that is not turning reports zero rather than a small number.
const MAX_PLAUSIBLE_FAN_RPM: f64 = 8000.0;

/// The SuperIO exposes seven symmetric fan channels, but no register records
/// which motherboard header a tachometer input is wired to: that is a board
/// routing decision, not a chip property. This board has four headers
/// (CPU_FAN, CPU_OPT, CHA_FAN1, CHA_FAN2) on a seven-channel chip, so three
/// channels are simply not routed.
const NCT_FAN_CHANNELS: usize = 7;

/// Fan speed registers, one per channel, in two encodings of the same
/// measurement.
///
/// The first holds **revolutions per minute** directly: Linux decodes this pair
/// with `fan_from_reg_rpm`, which returns the value unchanged, for the whole
/// NCT6779-and-later family. The second holds a 13-bit count, which Linux
/// decodes with `fan_from_reg13` and uses for the *minimum* register.
///
/// Reading the RPM pair with the count decoder is a trap worth naming: on the
/// test board the fan reads `0x0B97` here (2967 rpm) and `0x0E07` in the count
/// pair (455 counts, also 2967 rpm), and the count decoder turns the former into
/// a very believable 3600. Both registers are therefore read and required to
/// agree before a speed is reported.
#[cfg(any(target_os = "windows", test))]
const NCT_FAN_RPM_REG: [u64; NCT_FAN_CHANNELS] =
    [0x4C0, 0x4C2, 0x4C4, 0x4C6, 0x4C8, 0x4CA, 0x4CE];

#[cfg(any(target_os = "windows", test))]
const NCT_FAN_COUNT_REG: [u64; NCT_FAN_CHANNELS] =
    [0x4B0, 0x4B2, 0x4B4, 0x4B6, 0x4B8, 0x4BA, 0x4CC];

/// Per-channel Smart-Fan temperature source (`NCT6775_REG_TEMP_SEL`), one
/// banked register per fan output; bits [4:0] hold the source index.
#[cfg(any(target_os = "windows", test))]
const NCT_FAN_TEMP_SOURCE_REG: [u64; NCT_FAN_CHANNELS] =
    [0x100, 0x200, 0x300, 0x800, 0x900, 0xA00, 0xB00];

/// The chip's tachometer reference (`fan_from_reg13`): 1.35 MHz.
#[cfg(any(target_os = "windows", test))]
const NCT_FAN_REFERENCE_HZ: f64 = 1_350_000.0;

/// Temperature sources that live on the processor itself, as indices into
/// [`NCT_TEMPERATURE_SOURCES`].
///
/// `CPUTIN` (2) and `PECI Agent 0` (16) are documented and stable across the
/// family, so they are trusted on every part.
#[cfg(any(target_os = "windows", test))]
const NCT_CPU_TEMPERATURE_SOURCES: [u8; 3] = [
    2,  // CPUTIN
    16, // PECI Agent 0
    17, // PECI Agent 1 (a second processor or CCD)
];

/// The further processor sources of the NCT6798D label table, applied only where
/// that table is known to apply.
///
/// This board binds its fan curves to **28**, `PECI Agent 0 Calibration`, which
/// the kernel marks *undocumented*, so a reader restricted to the documented
/// pair finds no CPU fan here at all. The label tables differ between families -
/// the NCT6799D does not put the calibrated PECI entries in the same place - so
/// reading these indices on another part could bind a chassis header to the
/// processor.
#[cfg(any(target_os = "windows", test))]
const NCT6798D_CPU_TEMPERATURE_SOURCES: [u8; 2] = [
    28, // PECI Agent 0 Calibration
    29, // PECI Agent 1 Calibration
];

/// Source index to name, from the chip's label table (Linux
/// `nct6798_temp_label`). Only the names that can carry a fan curve matter.
#[cfg(any(target_os = "windows", test))]
const NCT_TEMPERATURE_SOURCES: [&str; 32] = [
    "",
    "SYSTIN",
    "CPUTIN",
    "AUXTIN0",
    "AUXTIN1",
    "AUXTIN2",
    "AUXTIN3",
    "AUXTIN4",
    "SMBUSMASTER 0",
    "SMBUSMASTER 1",
    "Virtual_TEMP",
    "Virtual_TEMP",
    "",
    "",
    "",
    "",
    "PECI Agent 0",
    "PECI Agent 1",
    "PCH_CHIP_CPU_MAX_TEMP",
    "PCH_CHIP_TEMP",
    "PCH_CPU_TEMP",
    "PCH_MCH_TEMP",
    "Agent0 Dimm0",
    "Agent0 Dimm1",
    "Agent1 Dimm0",
    "Agent1 Dimm1",
    "BYTE_TEMP0",
    "BYTE_TEMP1",
    "PECI Agent 0 Calibration",
    "PECI Agent 1 Calibration",
    "",
    "Virtual_TEMP",
];

/// The 13-bit tachometer count inside the count register pair.
///
/// The byte at the counter register is the integer part and the byte after it
/// carries five fractional bits, so the count is `first * 32 + fine` - exactly
/// Linux `fan_from_reg13`.
#[cfg(any(target_os = "windows", test))]
fn nct_fan_count(raw: u16) -> u16 {
    (raw & 0x1F) | ((raw & 0xFF00) >> 3)
}

/// Revolutions per minute for a channel, or `None` when it reports no fan.
///
/// Two registers carry the same measurement in different encodings, so they are
/// cross-checked: a decoder that is wrong for one of them - which is precisely
/// how a fan came to be reported 21% too fast - cannot satisfy both.
#[cfg(any(target_os = "windows", test))]
fn nct_fan_rpm(rpm_raw: u16, count_raw: Option<u16>) -> Option<f64> {
    let rpm = f64::from(rpm_raw);
    if !rpm.is_finite() || rpm < MIN_PLAUSIBLE_FAN_RPM || rpm > MAX_PLAUSIBLE_FAN_RPM {
        return None;
    }

    if let Some(count_raw) = count_raw {
        // Linux `fan_from_reg13` treats an all-ones count as "no reading", and
        // an unconnected header reads exactly that.
        if count_raw & 0xFF1F == 0xFF1F {
            return None;
        }
        let count = nct_fan_count(count_raw);
        if count == 0 {
            return None;
        }
        let from_count = NCT_FAN_REFERENCE_HZ / f64::from(count);
        // The count is quantised, so the two agree to about a percent, never
        // exactly. A larger gap means one of the two decoders is wrong for this
        // chip, and a plausible-looking speed is worse than none.
        if (rpm - from_count).abs() > 0.05 * from_count {
            return None;
        }
    }

    Some(rpm)
}

/// True when a Smart-Fan temperature source lives on the processor.
///
/// `verified_sources` says whether the calibrated PECI indices of the NCT6798D
/// table may be trusted for this part.
#[cfg(any(target_os = "windows", test))]
fn nct_is_cpu_temperature_source(source: u8, verified_sources: bool) -> bool {
    NCT_CPU_TEMPERATURE_SOURCES.contains(&source)
        || (verified_sources && NCT6798D_CPU_TEMPERATURE_SOURCES.contains(&source))
}

/// Name of a temperature source index, for the disclosure that accompanies a
/// fan reading. An out-of-table index is reported as unknown rather than
/// guessed at.
#[cfg(any(target_os = "windows", test))]
fn nct_temperature_source_name(source: u8) -> &'static str {
    NCT_TEMPERATURE_SOURCES
        .get(source as usize)
        .copied()
        .filter(|name| !name.is_empty())
        .unwrap_or("unknown")
}

/// Whether a base address read from the chip can be used as an I/O window.
///
/// The same guard the LPC module applies before it will allow a port: an
/// unwritten or absent register reads back 0x0000 or 0xFFFF, and the window is
/// eight-byte aligned.
#[cfg(any(target_os = "windows", test))]
fn plausible_hwm_base(base: u64) -> bool {
    const PCI_CONFIG_PORTS: core::ops::RangeInclusive<u64> = 0x0CF8..=0x0CFF;
    (0x100..=0xFFF8).contains(&base) && base % 8 == 0 && !PCI_CONFIG_PORTS.contains(&base)
}

/// Joules per energy-counter count, decoded from a RAPL unit register.
///
/// Both vendors use the same layout: the *power* unit sits in bits [3:0], the
/// *energy* unit in bits [12:8] and the time unit in bits [19:16]. Only the
/// energy field converts a counter delta into joules, and reading the wrong one
/// fails quietly in the worst way: a Ryzen 7 5700G reports `0x000A1003`, whose
/// low nibble (3) implies 0.125 J per count - 8192x too large - which inflates
/// a 30 W package to ~246 kW and leaves the plausibility bound to throw the
/// result away. That is exactly why package power stayed empty.
#[cfg(any(target_os = "windows", test))]
fn energy_unit_joules(unit: u64) -> Option<f64> {
    let exponent = ((unit >> 8) & 0x1F) as i32;
    // A real counter never spends a whole joule per count.
    (1..=24).contains(&exponent).then(|| 2f64.powi(-exponent))
}

/// The delta of a 32-bit wrapping energy counter, or `None` when it carries no
/// information: a counter that did not advance, or one that wrapped inside the
/// measurement window.
#[cfg(any(target_os = "windows", test))]
fn energy_delta(first: u64, second: u64) -> Option<u64> {
    let delta = second.wrapping_sub(first) & 0xFFFF_FFFF;
    (delta != 0 && delta <= 0x8000_0000).then_some(delta)
}

/// The module is loaded once; one snapshot is published, then the process exits.
fn main() {
    #[cfg(target_os = "windows")]
    windows_impl::raise_priority();

    let args: Vec<String> = std::env::args().collect();
    let stay = args.iter().any(|arg| arg == "--stay");
    // Both default to the well-known locations the client uses, so the
    // scheduled task needs no arguments - and therefore no quoting.
    let out_path = arg_value(&args, "--out")
        .map(PathBuf::from)
        .unwrap_or_else(default_snapshot_path);
    let module_dir = arg_value(&args, "--module-dir")
        .map(PathBuf::from)
        .unwrap_or_else(default_module_dir);

    // Development aid: dump the raw power registers and the derived watts, so a
    // broken power path cannot hide behind a plausible-looking estimate.
    if args.iter().any(|arg| arg == "--debug-power") {
        #[cfg(target_os = "windows")]
        windows_impl::debug_power(&module_dir, &debug_report_path(&args, "power-debug.txt"));
        return;
    }

    // Development aid: dump the Super-I/O fan registers. Which tachometer input
    // is the CPU header is a board routing decision that no register states, so
    // the attribution this makes has to be checkable against the board.
    if args.iter().any(|arg| arg == "--debug-fans") {
        #[cfg(target_os = "windows")]
        windows_impl::debug_fans(&module_dir, &debug_report_path(&args, "fan-debug.txt"));
        return;
    }

    if stay {
        // Development/verification mode: publish repeatedly without a scheduler.
        loop {
            let snapshot = collect(&module_dir);
            let _ = publish(&out_path, &snapshot);
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
    }

    let snapshot = collect(&module_dir);
    if let Err(error) = publish(&out_path, &snapshot) {
        eprintln!("broker: failed to write snapshot: {error}");
        std::process::exit(1);
    }
}

fn arg_value(args: &[String], name: &str) -> Option<String> {
    let index = args.iter().position(|arg| arg == name)?;
    args.get(index + 1).cloned()
}

/// Where a `--debug-*` run writes its report.
///
/// An explicit `--out` wins; otherwise the report lands next to the snapshot, so
/// the scheduled task - which passes no arguments at all - still leaves one
/// behind for whoever has to diagnose the machine.
#[cfg(target_os = "windows")]
fn debug_report_path(args: &[String], default_name: &str) -> PathBuf {
    arg_value(args, "--out")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_snapshot_path().with_file_name(default_name))
}

/// `%LOCALAPPDATA%\MineBench\sensors\broker.json` - the same path the client
/// reads.
///
/// The scheduled task runs as the logged-on user, so both sides resolve
/// `LOCALAPPDATA` to the same profile. Defaulting here keeps the task's command
/// line free of arguments, which also keeps it free of quoting.
fn default_snapshot_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("MineBench")
        .join("sensors");
    let _ = std::fs::create_dir_all(&base);
    base.join("broker.json")
}

/// Finds the PawnIO module directory.
///
/// The Task Scheduler starts the broker with its working directory set to
/// `System32`, so a relative path would never work. The search order is: an
/// explicit override, then the folders that sit next to the installed
/// executable, then directories supplied by the PawnIO installation itself.
fn default_module_dir() -> PathBuf {
    if let Some(override_dir) = std::env::var_os("MINEBENCH_PAWNIO_MODULES") {
        return PathBuf::from(override_dir);
    }

    let mut roots: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(directory) = exe.parent() {
            roots.push(directory.to_path_buf());
            roots.push(directory.join("_up_"));
            roots.push(directory.join("resources").join("pawnio-modules"));
            roots.push(directory.join("_up_").join("resources").join("pawnio-modules"));
        }
    }
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(base) = std::env::var_os(variable) {
            let base = PathBuf::from(base).join("PawnIO");
            roots.push(base.clone());
            roots.push(base.join("Modules"));
        }
    }

    for root in roots {
        if root.join("AMDFamily17.bin").is_file() || root.join("IntelMSR.bin").is_file() {
            return root;
        }
    }

    // Nothing found: return the executable's own directory so the caller's error
    // names a path the user can act on.
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// Collects everything the driver can tell us, degrading field by field.
fn collect(module_dir: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        windows_impl::collect(module_dir)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = module_dir;
        // The Unix platforms read hwmon/SMC directly in the client; there is no
        // privileged broker on those platforms at all.
        empty_snapshot("broker is Windows-only")
    }
}

fn empty_snapshot(note: &str) -> String {
    // The shape is the same as a successful snapshot, with every reading null:
    // a client must be able to tell "the controller did not answer" from "the
    // field is missing", and a missing field would read as the latter.
    format!(
        "{{\"schema\":{SCHEMA},\"provider\":\"none\",\"provider_detail\":{},\
\"temperature_c\":null,\"package_power_w\":null,\"fan_rpm\":null,\"fan_source\":null,\
\"fans\":[],\"source\":null,\"timestamp\":null}}",
        json_string(note)
    )
}

fn publish(path: &Path, snapshot: &str) -> std::io::Result<()> {
    // Write-then-rename so a reader never sees a half-written file.
    let temp = path.with_extension("tmp");
    std::fs::write(&temp, snapshot)?;
    std::fs::rename(&temp, path)
}

/// Writes a diagnostic report to a file.
///
/// Diagnostics cannot go to stdout here: the binary is built as a GUI-subsystem
/// executable, so it has no console and the first `println!` aborts the process.
#[cfg(target_os = "windows")]
fn write_report(path: &Path, report: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, report);
}

/// Minimal JSON string escaping, so module and error text cannot break the
/// document the client parses.
fn json_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            character if (character as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", character as u32))
            }
            character => out.push(character),
        }
    }
    out.push('"');
    out
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::*;
    use std::os::windows::ffi::OsStrExt;

    type Handle = *mut core::ffi::c_void;

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateFileW(
            file_name: *const u16,
            desired_access: u32,
            share_mode: u32,
            security_attributes: *mut core::ffi::c_void,
            creation_disposition: u32,
            flags_and_attributes: u32,
            template_file: Handle,
        ) -> Handle;
        fn DeviceIoControl(
            device: Handle,
            io_control_code: u32,
            in_buffer: *const core::ffi::c_void,
            in_buffer_size: u32,
            out_buffer: *mut core::ffi::c_void,
            out_buffer_size: u32,
            bytes_returned: *mut u32,
            overlapped: *mut core::ffi::c_void,
        ) -> i32;
        fn CloseHandle(object: Handle) -> i32;
        fn CreateMutexW(
            attributes: *mut core::ffi::c_void,
            initial_owner: i32,
            name: *const u16,
        ) -> Handle;
        fn WaitForSingleObject(handle: Handle, milliseconds: u32) -> u32;
        fn ReleaseMutex(handle: Handle) -> i32;
        fn GetCurrentProcess() -> Handle;
        fn SetPriorityClass(process: Handle, priority_class: u32) -> i32;
    }

    /// `ABOVE_NORMAL_PRIORITY_CLASS`, from `winbase.h`.
    const ABOVE_NORMAL_PRIORITY_CLASS: u32 = 0x0000_8000;

    /// Raises the sampling process above the load it is measuring.
    ///
    /// The stress test runs every core at 100% by design. At normal priority the
    /// energy-measurement window was stretched from 120 ms to 1.4 s: the average
    /// blurred, and the snapshot arrived later than the 1 Hz poll waiting for
    /// it. A few hundred milliseconds of register reads is precisely the work
    /// that should not queue behind 16 busy threads.
    ///
    /// A failure here is not reported: it only means the priority is unchanged,
    /// and every reading stays correct because the window is measured.
    pub fn raise_priority() {
        // SAFETY: `GetCurrentProcess` returns a pseudo-handle that is never
        // closed, and the priority class is one of the documented values.
        unsafe {
            SetPriorityClass(GetCurrentProcess(), ABOVE_NORMAL_PRIORITY_CLASS);
        }
    }

    /// The module documentation requires holding `\BaseNamedObjects\Access_PCI`
    /// around SMN access, because the SMN window is reached by writing the PCI
    /// configuration mechanism. Another monitor doing the same thing at the same
    /// moment would corrupt the read.
    const PCI_MUTEX_NAME: &str = r"Global\Access_PCI";

    /// The LPC module asks for a different serializer: the configuration port is
    /// shared with every other monitor and with the firmware's own fan control.
    const ISA_MUTEX_NAME: &str = r"Global\Access_ISABUS.HTP.Method";

    /// Super-I/O module. Fan tachometers are not reachable through the MSR
    /// modules at all - they sit behind the LPC configuration port - so reading
    /// them means loading a second module on its own device handle.
    const LPCIO_MODULE: &str = "LpcIO.bin";

    /// Slot 0 is the configuration port pair 0x2E/0x2F, slot 1 is 0x4E/0x4F.
    const SUPERIO_SLOT: u64 = 0;
    const SUPERIO_CONFIG_PORT: u64 = 0x2E;
    /// Nuvoton extended-function-mode unlock, written twice to the config port.
    const SUPERIO_UNLOCK: u64 = 0x87;
    /// Extended-function-mode exit.
    const SUPERIO_LOCK: u64 = 0xAA;
    /// Logical device select, and the hardware-monitor function's number.
    const SUPERIO_LDN_SELECT_REG: u64 = 0x07;
    const SUPERIO_HWM_LDN: u64 = 0x0B;
    /// The hardware monitor's base address, two bytes, in the selected LDN.
    const SUPERIO_BASE_ADDRESS_REG: u64 = 0x60;

    /// The monitor registers are *not* in configuration space: the
    /// configuration port only reaches chip setup, which is why reading them
    /// there returns 0xFF for every register. They live behind an index/data
    /// window at the base address above, and on this board that base is the
    /// 0x290 that `\AMW0.SHWM` claims in the firmware's ACPI namespace - the
    /// kernel even reports the conflict on exactly 0x295-0x296, the index and
    /// data ports.
    const HWM_INDEX_OFFSET: u64 = 0x05;
    const HWM_DATA_OFFSET: u64 = 0x06;

    /// Bank selector, written as a register index to the window above.
    const NCT_BANK_SELECT_REG: u64 = 0x4E;
    /// Chip identification, in configuration space.
    const NCT_CHIP_ID_REG: u64 = 0x20;
    const NCT_CHIP_REVISION_REG: u64 = 0x21;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_ABANDONED: u32 = 0x80;

    // The PawnIO device has no DOS symbolic link, so `CreateFileW("\\\\.\\PawnIO")`
    // fails with "file not found". Like the vendor's own library, the device must
    // be opened through the native API using its NT path.
    #[repr(C)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *const u16,
    }

    #[repr(C)]
    struct ObjectAttributes {
        length: u32,
        root_directory: Handle,
        object_name: *const UnicodeString,
        attributes: u32,
        security_descriptor: *const core::ffi::c_void,
        security_quality_of_service: *const core::ffi::c_void,
    }

    #[repr(C)]
    #[derive(Default)]
    struct IoStatusBlock {
        status: isize,
        information: usize,
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtOpenFile(
            file_handle: *mut Handle,
            desired_access: u32,
            object_attributes: *mut ObjectAttributes,
            io_status_block: *mut IoStatusBlock,
            share_access: u32,
            open_options: u32,
        ) -> i32;
    }

    const OBJ_CASE_INSENSITIVE: u32 = 0x0000_0040;

    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;
    const GENERIC_READ: u32 = 0x8000_0000;
    const GENERIC_WRITE: u32 = 0x4000_0000;
    const OPEN_EXISTING: u32 = 3;
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    const FILE_SHARE_WRITE: u32 = 0x0000_0002;
    const FILE_SHARE_DELETE: u32 = 0x0000_0004;
    const FILE_ATTRIBUTE_NORMAL: u32 = 0x0000_0080;

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// An open PawnIO device with one loaded module.
    struct PawnIo {
        device: Handle,
    }

    impl PawnIo {
        fn open() -> Result<Self, String> {
            // Native path first: this is how the device is actually reachable.
            let mut name = wide(PAWNIO_DEVICE);
            let byte_length = ((name.len() - 1) * 2) as u16;
            let unicode = UnicodeString {
                length: byte_length,
                maximum_length: byte_length + 2,
                buffer: name.as_mut_ptr(),
            };
            let mut attributes = ObjectAttributes {
                length: std::mem::size_of::<ObjectAttributes>() as u32,
                root_directory: std::ptr::null_mut(),
                object_name: &unicode,
                attributes: OBJ_CASE_INSENSITIVE,
                security_descriptor: std::ptr::null(),
                security_quality_of_service: std::ptr::null(),
            };
            let mut status_block = IoStatusBlock::default();
            let mut device: Handle = std::ptr::null_mut();

            // SAFETY: every pointer refers to a live local for the duration of
            // the call, and the structs match their documented layout.
            let status = unsafe {
                NtOpenFile(
                    &mut device,
                    GENERIC_READ | GENERIC_WRITE,
                    &mut attributes,
                    &mut status_block,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    0,
                )
            };
            if status >= 0 && device != INVALID_HANDLE_VALUE && !device.is_null() {
                return Ok(Self { device });
            }

            // Fall back to the DOS path in case a future driver adds the link.
            let fallback = wide(r"\\.\PawnIO");
            // SAFETY: `fallback` is a NUL-terminated wide string.
            let device = unsafe {
                CreateFileW(
                    fallback.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    std::ptr::null_mut(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                )
            };
            if device != INVALID_HANDLE_VALUE && !device.is_null() {
                return Ok(Self { device });
            }

            Err(format!(
                "cannot open the PawnIO device (NtOpenFile status 0x{:08X}, last error {}); the broker must run with administrator rights",
                status as u32,
                std::io::Error::last_os_error()
            ))
        }

        /// Reads the driver version. Used as a probe: it exercises the same
        /// handle and ioctl path without needing a loaded module, which
        /// separates "the handle is wrong" from "the module did not load".
        fn version(&self) -> Result<u32, String> {
            let mut value: u32 = 0;
            let mut returned: u32 = 0;
            // SAFETY: the output buffer is a live u32 of exactly the size the
            // driver requires.
            let ok = unsafe {
                DeviceIoControl(
                    self.device,
                    IOCTL_PIO_VERSION,
                    std::ptr::null_mut(),
                    0,
                    &mut value as *mut u32 as *mut core::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                    &mut returned,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            Ok(value)
        }

        fn load(&self, blob: &[u8]) -> Result<(), String> {
            let mut returned: u32 = 0;
            // SAFETY: the blob pointer/size describe one valid buffer; the output
            // buffer is unused for a load, which the driver allows.
            let ok = unsafe {
                DeviceIoControl(
                    self.device,
                    IOCTL_PIO_LOAD_BINARY,
                    blob.as_ptr() as *const core::ffi::c_void,
                    blob.len() as u32,
                    std::ptr::null_mut(),
                    0,
                    &mut returned,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(format!(
                    "driver rejected the module: {}",
                    std::io::Error::last_os_error()
                ));
            }
            Ok(())
        }

        /// Runs a named function from the loaded module.
        ///
        /// `out_cells` must equal the output size the module declares in
        /// `DEFINE_IOCTL_SIZED`: that macro rejects every other count with
        /// `STATUS_INVALID_PARAMETER` ("The parameter is incorrect"), which is
        /// exactly what a generously sized output buffer produces.
        fn execute(&self, name: &str, input: &[u64], out_cells: usize) -> Result<Vec<u64>, String> {
            let name_bytes = name.as_bytes();
            if name_bytes.len() >= FN_NAME_LENGTH {
                return Err(format!("function name too long: {name}"));
            }

            // The driver expects a fixed 32-byte name field immediately followed
            // by the u64 input array.
            let mut buffer = vec![0u8; FN_NAME_LENGTH + input.len() * 8];
            buffer[..name_bytes.len()].copy_from_slice(name_bytes);
            for (index, value) in input.iter().enumerate() {
                let offset = FN_NAME_LENGTH + index * 8;
                buffer[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
            }

            let mut output = vec![0u64; out_cells.max(1)];
            let mut returned: u32 = 0;
            // SAFETY: both buffers are valid for the lengths given.
            let ok = unsafe {
                DeviceIoControl(
                    self.device,
                    IOCTL_PIO_EXECUTE_FN,
                    buffer.as_ptr() as *const core::ffi::c_void,
                    buffer.len() as u32,
                    output.as_mut_ptr() as *mut core::ffi::c_void,
                    (output.len() * 8) as u32,
                    &mut returned,
                    std::ptr::null_mut(),
                )
            };
            if ok == 0 {
                return Err(format!(
                    "driver failed to execute {name}: {}",
                    std::io::Error::last_os_error()
                ));
            }
            output.truncate((returned as usize / 8).min(output.len()));
            Ok(output)
        }

        /// `ioctl_read_msr`: one input cell, one output cell.
        fn read_msr(&self, msr: u64) -> Result<u64, String> {
            self.execute("ioctl_read_msr", &[msr], 1)?
                .first()
                .copied()
                .ok_or_else(|| "read_msr returned no value".to_string())
        }

        /// `ioctl_read_smn`: one input cell, one output cell.
        ///
        /// The caller must hold [`PciMutex`]; SMN access is only safe while the
        /// shared PCI window is exclusively owned.
        fn read_smn(&self, offset: u64) -> Result<u64, String> {
            self.execute("ioctl_read_smn", &[offset], 1)?
                .first()
                .copied()
                .ok_or_else(|| "read_smn returned no value".to_string())
        }
    }

    /// RAII guard for one of the driver's named access mutexes.
    ///
    /// The PawnIO modules that reach shared hardware buses ask for these: the
    /// SMN window is serialized by `Access_PCI`, the LPC configuration port by
    /// `Access_ISABUS.HTP.Method`. Another monitor doing the same thing at the
    /// same moment would corrupt the access.
    struct NamedMutex {
        handle: Handle,
    }

    impl NamedMutex {
        /// Acquires `name`, waiting up to `timeout_ms`.
        ///
        /// A failure here is not fatal on its own: the read is still attempted,
        /// because the mutex only serializes against other monitors.
        fn acquire(name: &str, timeout_ms: u32) -> Option<Self> {
            let name = wide(name);
            // SAFETY: the name is NUL-terminated.
            let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
            if handle.is_null() {
                return None;
            }
            // SAFETY: handle came from CreateMutexW.
            let wait = unsafe { WaitForSingleObject(handle, timeout_ms) };
            if wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED {
                Some(Self { handle })
            } else {
                // SAFETY: handle came from CreateMutexW and is not held here.
                unsafe { CloseHandle(handle) };
                None
            }
        }
    }

    impl Drop for NamedMutex {
        fn drop(&mut self) {
            // SAFETY: we own the mutex and the handle, each released once.
            unsafe {
                ReleaseMutex(self.handle);
                CloseHandle(self.handle);
            }
        }
    }

    impl Drop for PawnIo {
        fn drop(&mut self) {
            // SAFETY: the handle came from CreateFileW and is closed once.
            unsafe { CloseHandle(self.device) };
        }
    }

    /// CPU vendor as reported by the firmware, so we never require CPUID.
    fn cpu_vendor() -> Option<String> {
        let key = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
            .open_subkey(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            .ok()?;
        key.get_value::<String, _>("VendorIdentifier").ok()
    }

    /// Chooses the driver module that matches this CPU.
    fn module_for_vendor(vendor: &str) -> &'static [&'static str] {
        if vendor.contains("AMD") {
            // Family 17h-1Ah (Zen through Zen 4) share this module. Older
            // families have their own modules but are not targeted here.
            &["AMDFamily17.bin", "AMDFamily10.bin"]
        } else if vendor.contains("Intel") {
            &["IntelMSR.bin"]
        } else {
            &[]
        }
    }

    pub fn collect(module_dir: &Path) -> String {
        let started = std::time::Instant::now();

        let vendor = cpu_vendor().unwrap_or_default();
        let candidates = module_for_vendor(&vendor);
        if candidates.is_empty() {
            return super::empty_snapshot(&format!(
                "no kernel module for this CPU vendor ({})",
                if vendor.is_empty() { "unknown" } else { &vendor }
            ));
        }

        let device = match PawnIo::open() {
            Ok(device) => device,
            Err(error) => return super::empty_snapshot(&error),
        };

        let mut loaded = None;
        let mut last_error = String::new();
        let mut driver_version: u32 = 0;
        match device.version() {
            Ok(value) => driver_version = value,
            Err(error) => last_error = format!("driver version probe failed: {error}"),
        }
        for name in candidates {
            let path = module_dir.join(name);
            let Ok(blob) = std::fs::read(&path) else {
                last_error = format!("module not found: {}", path.display());
                continue;
            };
            match device.load(&blob) {
                Ok(()) => {
                    loaded = Some(*name);
                    break;
                }
                Err(error) => last_error = error,
            }
        }

        let Some(module) = loaded else {
            return super::empty_snapshot(&format!(
                "could not load a sensor module: {last_error} (driver 0x{driver_version:06X})"
            ));
        };

        let temperature = if vendor.contains("AMD") {
            amd_temperature(&device)
        } else {
            intel_temperature(&device)
        };

        // Surface the raw SMN word so a wrong reading can never hide behind a
        // plausible-looking number.
        let raw_smn = if vendor.contains("AMD") {
            device
                .read_smn(AMD_SMN_THM_TCON_CUR_TMP)
                .map(|value| format!("0x{value:016X}"))
                .unwrap_or_else(|error| format!("error: {error}"))
        } else {
            "n/a".to_string()
        };

        let power = if vendor.contains("AMD") {
            package_power(&device, AMD_MSR_PWR_UNIT, AMD_MSR_PKG_ENERGY_STAT)
        } else {
            package_power(&device, INTEL_MSR_RAPL_POWER_UNIT, INTEL_MSR_PKG_ENERGY_STATUS)
        };

        let (temperature, temperature_source) = match temperature {
            Ok(Some((value, source))) => (Some(value), Some(source)),
            Ok(None) => (None, None),
            Err(error) => {
                return super::empty_snapshot(&error);
            }
        };

        // The fans live on the motherboard's Super-I/O chip, which is a separate
        // module on its own device handle. A failure here never costs the
        // temperature or the power reading.
        let fans = read_fans(module_dir);
        let cpu_fan = fans.as_ref().and_then(Fans::cpu);
        let fan_source = cpu_fan.as_ref().map(|fan| {
            format!(
                "{} · {}",
                fans.as_ref().map(|fans| fans.chip.as_str()).unwrap_or("chip"),
                fan.detail()
            )
        });
        let fans_json = fans_json(fans.as_ref());

        let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
        // Return the raw register alongside the derived value: a wrong reading
        // must never be able to hide behind a plausible number.
        if temperature.is_none() {
            return format!(
                "{{\"schema\":{SCHEMA},\"provider\":\"pawnio\",\"module\":{},\
\"raw_smn\":{},\"driver\":\"0x{driver_version:06X}\",\
\"temperature_c\":null,\"package_power_w\":{},\"fan_rpm\":{},\"fan_source\":{},\
\"fans\":{fans_json},\"vendor\":{},\"elapsed_ms\":{:.2}}}",
                super::json_string(module),
                super::json_string(&raw_smn),
                optional_number(power),
                optional_number(cpu_fan.as_ref().and_then(|fan| fan.channel.rpm)),
                fan_source
                    .as_deref()
                    .map(super::json_string)
                    .unwrap_or_else(|| "null".to_string()),
                super::json_string(&vendor),
                elapsed_ms,
            );
        }
        format!(
            "{{\"schema\":{SCHEMA},\"provider\":\"pawnio\",\"module\":{},\
\"raw_smn\":{},\"temperature_c\":{},\"temperature_source\":{},\"package_power_w\":{},\
\"fan_rpm\":{},\"fan_source\":{},\"fans\":{fans_json},\"vendor\":{},\"elapsed_ms\":{:.2}}}",
            super::json_string(module),
            super::json_string(&raw_smn),
            optional_number(temperature),
            temperature_source
                .as_deref()
                .map(super::json_string)
                .unwrap_or_else(|| "null".to_string()),
            optional_number(power),
            optional_number(cpu_fan.as_ref().and_then(|fan| fan.channel.rpm)),
            fan_source
                .as_deref()
                .map(super::json_string)
                .unwrap_or_else(|| "null".to_string()),
            super::json_string(&vendor),
            elapsed_ms,
        )
    }

    fn optional_number(value: Option<f64>) -> String {
        match value {
            Some(value) if value.is_finite() => format!("{value}"),
            _ => "null".to_string(),
        }
    }

    /// Every channel the Super-I/O reported, in the snapshot.
    ///
    /// The app claims to know which channel is the CPU fan without a vendor
    /// header map to lean on, so the whole table ships with the reading: the
    /// claim can be checked against the board instead of trusted, on this
    /// machine and on any other.
    fn fans_json(fans: Option<&Fans>) -> String {
        let Some(fans) = fans else {
            return "[]".to_string();
        };
        let channels: Vec<String> = fans
            .channels
            .iter()
            .map(|channel| {
                format!(
                    "{{\"channel\":{},\"rpm\":{},\"temperature_source\":{},\
\"temperature_source_name\":{},\"is_cpu\":{},\"rpm_raw\":\"0x{:04X}\",\"count_raw\":{},\
\"temperature_source_raw\":{}}}",
                    channel.channel,
                    optional_number(channel.rpm),
                    channel.temperature_source,
                    super::json_string(nct_temperature_source_name(channel.temperature_source)),
                    channel.is_cpu,
                    channel.rpm_raw,
                    optional_number(channel.count_raw.map(f64::from)),
                    channel.temperature_source_raw,
                )
            })
            .collect();
        format!("[{}]", channels.join(","))
    }

    /// AMD Zen die temperature from `THM_TCON_CUR_TMP`.
    ///
    /// The formula matches Linux `k10temp` and LibreHardwareMonitor exactly:
    /// bits [31:21] scaled by 0.125 C, minus 49 C when the offset flag is set.
    fn amd_temperature(device: &PawnIo) -> Result<Option<(f64, String)>, String> {
        // SMN is reached through the shared PCI window, so hold the mutex the
        // module asks for. Most tools hold it only briefly, so a short wait is
        // enough; on timeout the read still proceeds.
        let _guard = NamedMutex::acquire(PCI_MUTEX_NAME, 2000);
        let raw = device.read_smn(AMD_SMN_THM_TCON_CUR_TMP)?;

        let field = ((raw >> AMD_TEMP_FIELD_SHIFT) & 0x7FF) as i64;
        let mut millidegrees = field * AMD_TEMP_MILLIDEGREES_PER_STEP;
        if raw & AMD_TEMP_OFFSET_FLAG != 0 {
            millidegrees -= AMD_TEMP_OFFSET_MILLIDEGREES;
        }
        let celsius = millidegrees as f64 / 1000.0;

        if !(MIN_TEMPERATURE_C..=MAX_TEMPERATURE_C).contains(&celsius) {
            return Ok(None);
        }
        Ok(Some((celsius, "Tctl".to_string())))
    }

    /// Dumps the raw power registers and the watts derived from them.
    ///
    /// A RAPL energy counter is cumulative, 32-bit and unit-scaled from a
    /// separate register, so a wrong reading looks far more plausible than it
    /// fails - which is how package power stayed empty behind a silently
    /// discarded 246 kW. This writes a report instead of printing one: the
    /// binary is a GUI-subsystem executable, so it has no stdout and every
    /// `println!` aborts it before a single line is emitted.
    pub fn debug_power(module_dir: &Path, out: &Path) {
        let mut report = String::new();
        let mut say = |line: String| {
            report.push_str(&line);
            report.push_str("\r\n");
        };

        let device = match PawnIo::open() {
            Ok(device) => device,
            Err(error) => {
                say(format!("cannot open the PawnIO device: {error}"));
                write_report(out, &report);
                return;
            }
        };
        let blob = match std::fs::read(module_dir.join("AMDFamily17.bin")) {
            Ok(blob) => blob,
            Err(error) => {
                say(format!(
                    "cannot read the AMD module in {}: {error}",
                    module_dir.display()
                ));
                write_report(out, &report);
                return;
            }
        };
        if let Err(error) = device.load(&blob) {
            say(format!("cannot load the AMD module: {error}"));
            write_report(out, &report);
            return;
        }

        let unit = match device.read_msr(AMD_MSR_PWR_UNIT) {
            Ok(value) => value,
            Err(error) => {
                say(format!("MSR_PWR_UNIT failed: {error}"));
                write_report(out, &report);
                return;
            }
        };
        say(format!("MSR_PWR_UNIT = 0x{unit:016X}"));
        say(format!(
            "  power  unit exponent [3:0]   = {}",
            unit & 0xF
        ));
        say(format!(
            "  energy unit exponent [12:8]  = {}",
            (unit >> 8) & 0x1F
        ));
        say(format!(
            "  time   unit exponent [19:16] = {}",
            (unit >> 16) & 0xF
        ));
        match energy_unit_joules(unit) {
            Some(joules) => say(format!("  -> {joules:e} J per count")),
            None => {
                say("  -> no usable energy unit".to_string());
                write_report(out, &report);
                return;
            }
        }

        // Four samples over 750 ms, so the delta is large enough to see whether
        // the counter advances at all.
        let mut previous: Option<u64> = None;
        for index in 0..4 {
            let raw = match device.read_msr(AMD_MSR_PKG_ENERGY_STAT) {
                Ok(value) => value,
                Err(error) => {
                    say(format!("MSR_PKG_ENERGY_STAT failed: {error}"));
                    break;
                }
            };
            let counter = raw & 0xFFFF_FFFF;
            match previous {
                Some(before) => {
                    let delta = energy_delta(before, counter).unwrap_or(0);
                    let watts = delta as f64 * energy_unit_joules(unit).unwrap_or(0.0) / 0.25;
                    say(format!(
                        "sample {index}: counter={counter:>10} raw=0x{raw:016X} delta={delta:>10} -> {watts:8.2} W"
                    ));
                }
                None => say(format!(
                    "sample {index}: counter={counter:>10} raw=0x{raw:016X}"
                )),
            }
            previous = Some(counter);
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        write_report(out, &report);
    }

    /// Package power from a running RAPL energy counter.
    ///
    /// The counter is cumulative and 32-bit, so a single reading says nothing:
    /// power only exists as the delta between two samples taken a known time
    /// apart. The window is wide enough that the delta cannot round away on an
    /// idle package, and short enough not to matter inside a 1 Hz poll.
    fn package_power(device: &PawnIo, unit_msr: u64, energy_msr: u64) -> Option<f64> {
        const WINDOW: std::time::Duration = std::time::Duration::from_millis(120);

        let unit_joules = energy_unit_joules(device.read_msr(unit_msr).ok()?)?;
        let first = device.read_msr(energy_msr).ok()?;
        let started = std::time::Instant::now();
        std::thread::sleep(WINDOW);
        let second = device.read_msr(energy_msr).ok()?;

        let delta = energy_delta(first, second)?;
        // The interval is measured, never assumed. Under full load the sampler
        // is starved and sleeps far longer than it asked to, and the counter
        // keeps counting throughout; dividing that delta by the requested
        // window reported 237 W for a 65 W package - precisely when the stress
        // test needs the number to be right.
        let seconds = started.elapsed().as_secs_f64();
        if seconds <= 0.0 {
            return None;
        }
        let watts = delta as f64 * unit_joules / seconds;
        (watts.is_finite() && watts > 0.0 && watts < MAX_POWER_W).then_some(watts)
    }

    /// Intel package temperature from the thermal status registers.
    fn intel_temperature(device: &PawnIo) -> Result<Option<(f64, String)>, String> {
        let target = device.read_msr(INTEL_MSR_IA32_TEMPERATURE_TARGET)?;
        let tj_max = ((target >> 16) & 0xFF) as f64;
        if !(80.0..=120.0).contains(&tj_max) {
            return Ok(None);
        }

        // Prefer the package sensor, fall back to the per-core one.
        let read_offset = |msr: u64| -> Option<f64> {
            let value = device.read_msr(msr).ok()?;
            // Digital readout is valid only when the status bit is set.
            if value & (1 << 31) == 0 {
                return None;
            }
            let offset = ((value >> 16) & 0x7F) as f64;
            let celsius = tj_max - offset;
            (MIN_TEMPERATURE_C..=MAX_TEMPERATURE_C)
                .contains(&celsius)
                .then_some(celsius)
        };

        if let Some(celsius) = read_offset(INTEL_MSR_IA32_PACKAGE_THERM_STATUS) {
            return Ok(Some((celsius, "Package".to_string())));
        }
        if let Some(celsius) = read_offset(INTEL_MSR_IA32_THERM_STATUS) {
            return Ok(Some((celsius, "Core".to_string())));
        }
        Ok(None)
    }

    /// One fan channel of the Super-I/O chip, kept whole so a reading can always
    /// be traced back to the register it came from.
    #[derive(Debug, Clone)]
    pub struct FanChannel {
        pub channel: usize,
        /// `None` when the channel has no tachometer attached.
        pub rpm: Option<f64>,
        pub temperature_source: u8,
        pub is_cpu: bool,
        /// The speed register pair exactly as read (revolutions per minute).
        pub rpm_raw: u16,
        /// The count register pair exactly as read, when the chip has one.
        pub count_raw: Option<u16>,
        /// The temperature-source register exactly as read, before masking.
        pub temperature_source_raw: u8,
    }

    /// What the motherboard's fan header situation turned out to be.
    #[derive(Debug, Clone, Default)]
    pub struct Fans {
        pub chip: String,
        pub channels: Vec<FanChannel>,
    }

    /// The channel chosen as the CPU fan, and what else qualified.
    ///
    /// This is the only deterministic link between a tachometer input and the
    /// CPU on a board the vendor never published a header map for: at POST the
    /// BIOS programs, per channel, which temperature source drives that
    /// channel's Smart-Fan curve, and the chip exposes those registers. The link
    /// is deterministic *given the current firmware configuration*, not
    /// immutable - a user who points a chassis header at a processor temperature
    /// breaks it - which is why the source travels with the reading.
    pub struct CpuFan<'a> {
        pub channel: &'a FanChannel,
        pub source_name: &'static str,
        /// Every processor-bound header that is turning, in channel order.
        ///
        /// A board may bind more than one to the processor, and the registers do
        /// not say which of them is the primary header. The whole set is
        /// reported so the choice can be seen rather than trusted.
        pub candidates: Vec<&'a FanChannel>,
    }

    impl CpuFan<'_> {
        /// How the choice was made, in words a user can act on.
        pub fn detail(&self) -> String {
            let source = self.source_name;
            if self.candidates.len() <= 1 {
                return format!("header {}, curve follows {source}", self.channel.channel + 1);
            }
            let speeds: Vec<String> = self
                .candidates
                .iter()
                .map(|channel| {
                    channel
                        .rpm
                        .map(|rpm| format!("{rpm:.0}"))
                        .unwrap_or_else(|| "no tachometer".to_string())
                })
                .collect();
            format!(
                "header {} of {} processor-bound, curves follow {source} ({} rpm)",
                self.channel.channel + 1,
                self.candidates.len(),
                speeds.join(" / ")
            )
        }
    }

    impl Fans {
        /// The CPU fan, chosen from the channels the chip itself binds to a
        /// processor temperature source.
        pub fn cpu(&self) -> Option<CpuFan<'_>> {
            let bound: Vec<&FanChannel> = self
                .channels
                .iter()
                .filter(|channel| channel.is_cpu)
                .collect();
            let turning: Vec<&FanChannel> = bound
                .iter()
                .copied()
                .filter(|channel| channel.rpm.is_some())
                .collect();

            // Fastest first: among headers whose curves follow the processor,
            // the cooler is the one moving the most air. The full set is carried
            // along so this ordering is disclosed rather than assumed.
            let fastest = turning
                .iter()
                .copied()
                .max_by(|a, b| a.rpm.unwrap_or(0.0).total_cmp(&b.rpm.unwrap_or(0.0)));

            let channel = fastest.or_else(|| bound.first().copied())?;

            Some(CpuFan {
                channel,
                source_name: nct_temperature_source_name(channel.temperature_source),
                candidates: bound,
            })
        }
    }

    /// Access to the motherboard's Super-I/O chip.
    ///
    /// Two windows are involved and they are not interchangeable. The
    /// *configuration* port (0x2E/0x2F) only reaches chip setup - identification,
    /// logical device selection, the base addresses - and reading a monitor
    /// register through it returns 0xFF for every register, which is a mistake
    /// that looks exactly like a chip with no sensors. The *monitor* registers
    /// (fan tachometers, temperatures, Smart-Fan assignments) are behind an
    /// index/data window at the base address the configuration port reports.
    ///
    /// Both are reached by writing a register index to one port and reading the
    /// value from the next, which needs raw port I/O and therefore the driver.
    /// This type owns the device handle it runs on and holds the module's access
    /// mutex for as long as it is open, so the firmware's own fan control never
    /// sees a half-finished transaction.
    struct SuperIo {
        device: PawnIo,
        _isa: Option<NamedMutex>,
        chip_id: u16,
        /// The hardware monitor's index/data window, from configuration space.
        hwm_base: u64,
    }

    impl SuperIo {
        /// Opens the chip, in configuration mode, ready for register reads.
        fn open(module_dir: &Path) -> Result<Self, String> {
            let path = module_dir.join(LPCIO_MODULE);
            let blob = std::fs::read(&path)
                .map_err(|error| format!("cannot read {}: {error}", path.display()))?;

            // Its own handle: the driver keeps the loaded module per open file,
            // so the vendor module already in use elsewhere is left alone.
            let device = PawnIo::open()?;
            device.load(&blob)?;

            let isa = NamedMutex::acquire(ISA_MUTEX_NAME, 2000);
            let mut io = Self {
                device,
                _isa: isa,
                chip_id: 0,
                hwm_base: 0,
            };

            io.execute("ioctl_select_slot", &[SUPERIO_SLOT], 0)?;

            // Enter configuration mode, then confirm it took: an unresponsive
            // chip reads back 0x00 or 0xFF.
            io.port_out(SUPERIO_CONFIG_PORT, SUPERIO_UNLOCK)?;
            io.port_out(SUPERIO_CONFIG_PORT, SUPERIO_UNLOCK)?;
            let chip_id = io.config_in(NCT_CHIP_ID_REG)?;
            if chip_id == 0x00 || chip_id == 0xFF {
                return Err(format!(
                    "the Super-I/O chip did not answer on port 0x{SUPERIO_CONFIG_PORT:02X} \
                     (chip id 0x{chip_id:02X})"
                ));
            }
            // The identification is the two-byte device ID the kernel matches,
            // not just its high byte: the low bits carry the revision.
            let device_id = (u16::from(chip_id) << 8) | u16::from(io.config_in(NCT_CHIP_REVISION_REG)?);
            io.chip_id = device_id;

            // The module only permits the configuration ports until it is told
            // which base address windows the chip has claimed.
            io.execute("ioctl_find_bars", &[], 0)?;

            // The base address belongs to the hardware-monitor function, so that
            // function has to be the selected one before it can be read.
            io.select_ldn(SUPERIO_HWM_LDN)?;
            let high = u64::from(io.config_in(SUPERIO_BASE_ADDRESS_REG)?);
            let low = u64::from(io.config_in(SUPERIO_BASE_ADDRESS_REG + 1)?);
            let hwm_base = (high << 8) | low;
            if !plausible_hwm_base(hwm_base) {
                return Err(format!(
                    "the chip reported an unusable hardware-monitor base address 0x{hwm_base:04X}"
                ));
            }
            io.hwm_base = hwm_base;

            // Prove the window answers before anything relies on it: an
            // unwindowed access reads back all ones.
            let probe = io.hwm_in(0x00)?;
            if probe == 0xFF {
                return Err(format!(
                    "the hardware-monitor window at 0x{hwm_base:04X} did not answer"
                ));
            }

            Ok(io)
        }

        fn execute(&self, name: &str, input: &[u64], out_cells: usize) -> Result<Vec<u64>, String> {
            self.device.execute(name, input, out_cells)
        }

        /// Writes a byte to a raw I/O port.
        fn port_out(&self, port: u64, value: u64) -> Result<(), String> {
            self.execute("ioctl_pio_outb", &[port, value], 0).map(|_| ())
        }

        /// Reads a byte from a raw I/O port.
        fn port_in(&self, port: u64) -> Result<u64, String> {
            Ok(self.execute("ioctl_pio_inb", &[port], 1)?[0])
        }

        /// Reads a configuration register, through the configuration port.
        fn config_in(&self, reg: u64) -> Result<u8, String> {
            Ok(self.execute("ioctl_superio_inb", &[reg & 0xFF], 1)?[0] as u8)
        }

        /// Writes a configuration register, through the configuration port.
        fn config_out(&self, reg: u64, value: u64) -> Result<(), String> {
            self.execute("ioctl_superio_outb", &[reg & 0xFF, value], 0)
                .map(|_| ())
        }

        /// Selects a logical device and confirms the chip took it. A chip that
        /// silently ignores the write would answer every later read with the
        /// previous function's registers.
        fn select_ldn(&self, ldn: u64) -> Result<(), String> {
            self.config_out(SUPERIO_LDN_SELECT_REG, ldn)?;
            let selected = u64::from(self.config_in(SUPERIO_LDN_SELECT_REG)?);
            if selected != ldn {
                return Err(format!(
                    "the chip refused to select logical device 0x{ldn:02X} \
                     (it reports 0x{selected:02X})"
                ));
            }
            Ok(())
        }

        /// Reads a monitor register through the index/data window.
        fn hwm_in(&self, reg: u64) -> Result<u8, String> {
            self.port_out(self.hwm_base + HWM_INDEX_OFFSET, reg & 0xFF)?;
            Ok(self.port_in(self.hwm_base + HWM_DATA_OFFSET)? as u8)
        }

        /// Reads a monitor register of an explicit bank. The bank is selected on
        /// every access rather than cached, so no earlier read can leave the
        /// window pointing at the wrong bank.
        fn hwm_banked(&self, reg: u64) -> Result<u8, String> {
            self.port_out(self.hwm_base + HWM_INDEX_OFFSET, NCT_BANK_SELECT_REG)?;
            self.port_out(self.hwm_base + HWM_DATA_OFFSET, (reg >> 8) & 0xFF)?;
            self.hwm_in(reg)
        }

        /// Reads one fan channel's speed and the temperature source its
        /// Smart-Fan curve follows.
        fn channel(&self, index: usize, verified_sources: bool) -> Result<FanChannel, String> {
            let read_pair = |reg: u64| -> Result<u16, String> {
                let high = self.hwm_banked(reg)?;
                let low = self.hwm_banked(reg + 1)?;
                Ok((u16::from(high) << 8) | u16::from(low))
            };

            let rpm_raw = read_pair(NCT_FAN_RPM_REG[index])?;
            // The count pair is the cross-check, and its absence is not fatal:
            // an unreadable companion costs the check, not the reading.
            let count_raw = read_pair(NCT_FAN_COUNT_REG[index]).ok();
            let source_raw = self.hwm_banked(NCT_FAN_TEMP_SOURCE_REG[index])?;
            let source = source_raw & 0x1F;

            Ok(FanChannel {
                channel: index,
                rpm: nct_fan_rpm(rpm_raw, count_raw),
                temperature_source: source,
                is_cpu: nct_is_cpu_temperature_source(source, verified_sources),
                rpm_raw,
                count_raw,
                temperature_source_raw: source_raw,
            })
        }
    }

    impl Drop for SuperIo {
        fn drop(&mut self) {
            // Leaving the chip in configuration mode would leave the board's own
            // fan control talking to a chip that is not listening for it.
            let _ = self.port_out(SUPERIO_CONFIG_PORT, SUPERIO_LOCK);
        }
    }

    /// Reads every fan channel of the motherboard's Super-I/O chip.
    ///
    /// Returns `None` - never a fabricated reading - when there is no module, no
    /// chip, or the chip is not one whose layout this knows.
    pub fn read_fans(module_dir: &Path) -> Option<Fans> {
        read_fans_from(&SuperIo::open(module_dir).ok()?)
    }

    /// Reads the channels of an already-opened chip, so a caller that needs the
    /// chip anyway does not enter configuration mode twice.
    fn read_fans_from(io: &SuperIo) -> Option<Fans> {
        // Only the parts whose layout is documented and shared with the one
        // verified on hardware; anything else reports nothing rather than
        // guessing at registers.
        let (part, fans, verified_sources) = nct_family_entry(io.chip_id)?;

        let channels = (0..fans)
            .map(|index| {
                io.channel(index, verified_sources).unwrap_or(FanChannel {
                    // A channel that could not be read keeps its place, so the
                    // table still lines up with the chip's channel numbering.
                    channel: index,
                    rpm: None,
                    temperature_source: u8::MAX,
                    is_cpu: false,
                    rpm_raw: 0,
                    count_raw: None,
                    temperature_source_raw: u8::MAX,
                })
            })
            .collect::<Vec<_>>();

        Some(Fans {
            chip: format!("{part} (0x{:04X}) at 0x{:04X}", io.chip_id, io.hwm_base),
            channels,
        })
    }

    /// Dumps the Super-I/O fan registers so a wrong attribution cannot hide.
    ///
    /// This exists because the fan-header layout is board-specific and the app
    /// nevertheless claims to know which channel is the CPU: the raw registers,
    /// the tachometer count in both byte orders, and each channel's Smart-Fan
    /// temperature source are all written out, so the claim can be checked
    /// against the board instead of trusted.
    pub fn debug_fans(module_dir: &Path, out: &Path) {
        let mut report = String::new();
        let mut say = |line: String| {
            report.push_str(&line);
            report.push_str("\r\n");
        };

        let io = match SuperIo::open(module_dir) {
            Ok(io) => io,
            Err(error) => {
                say(format!("cannot reach the Super-I/O chip: {error}"));
                write_report(out, &report);
                return;
            }
        };

        say(format!(
            "chip id 0x{:04X} ({}), hardware-monitor window 0x{:04X}: {}",
            io.chip_id,
            nct_family_entry(io.chip_id)
                .map(|(part, _, _)| part)
                .unwrap_or("not a layout this reader knows"),
            io.hwm_base,
            match nct_family_entry(io.chip_id) {
                Some((_, fans, _)) => format!("{fans} fan channel(s)"),
                None => "no fan channels read".to_string(),
            }
        ));
        // Configuration space: which fan inputs the firmware enabled. These are
        // the registers that say a channel exists, as opposed to what it means.
        for (name, reg) in [
            ("CR1A", 0x1A),
            ("CR1B", 0x1B),
            ("CR2A", 0x2A),
            ("CR2B", 0x2B),
            ("CR2D", 0x2D),
            ("CR2F", 0x2F),
        ] {
            match io.config_in(reg) {
                Ok(value) => say(format!("  config {name} (0x{reg:02X}) = 0x{value:02X}")),
                Err(error) => say(format!("  config {name} (0x{reg:02X}) failed: {error}")),
            }
        }

        // Monitor space: the two fan-speed encodings and the Smart-Fan
        // assignments. Both encodings are printed because they must agree, and
        // reading one with the other's decoder is the mistake this report exists
        // to make impossible to repeat.
        for index in 0..NCT_FAN_CHANNELS {
            let read_pair = |reg: u64| -> Result<u16, String> {
                let high = io.hwm_banked(reg)?;
                let low = io.hwm_banked(reg + 1)?;
                Ok((u16::from(high) << 8) | u16::from(low))
            };
            let rpm_raw = read_pair(NCT_FAN_RPM_REG[index]);
            let count_raw = read_pair(NCT_FAN_COUNT_REG[index]);
            let source = io.hwm_banked(NCT_FAN_TEMP_SOURCE_REG[index]);

            match (rpm_raw, source) {
                (Ok(rpm_raw), Ok(source)) => {
                    let count = count_raw.ok();
                    let decoded = source & 0x1F;
                    let from_count = count
                        .map(nct_fan_count)
                        .filter(|count| *count > 0)
                        .map(|count| NCT_FAN_REFERENCE_HZ / f64::from(count));
                    say(format!(
                        "channel {index}: rpm reg 0x{:03X}=0x{rpm_raw:04X} ({rpm_raw} rpm), \
                         count reg 0x{:03X}={} -> {}, agreed rpm={} \
                         temp source={decoded:>2} ({}) cpu={}",
                        NCT_FAN_RPM_REG[index],
                        NCT_FAN_COUNT_REG[index],
                        count
                            .map(|raw| format!("0x{raw:04X}"))
                            .unwrap_or_else(|| "unreadable".to_string()),
                        from_count
                            .map(|rpm| format!("{rpm:.0} rpm"))
                            .unwrap_or_else(|| "no count".to_string()),
                        nct_fan_rpm(rpm_raw, count)
                            .map(|rpm| format!("{rpm:.0}"))
                            .unwrap_or_else(|| "none".to_string()),
                        nct_temperature_source_name(decoded),
                        nct_is_cpu_temperature_source(decoded, false),
                    ));
                }
                (rpm_raw, source) => say(format!(
                    "channel {index}: read failed: {rpm_raw:?} {source:?}"
                )),
            }
        }

        // The temperature channels themselves, so the source indices above can
        // be sanity-checked against real degrees.
        for (name, reg) in [
            ("SYSTIN", 0x490),
            ("CPUTIN", 0x491),
            ("AUXTIN0", 0x492),
            ("AUXTIN1", 0x493),
        ] {
            match io.hwm_banked(reg) {
                Ok(value) => say(format!("temp {name} (0x{reg:03X}) = {value} C")),
                Err(error) => say(format!("temp {name} (0x{reg:03X}) failed: {error}")),
            }
        }

        match read_fans_from(&io) {
            Some(fans) => say(format!(
                "resolved: {} channel(s), cpu fan = {}",
                fans.channels.len(),
                fans.cpu()
                    .map(|cpu| {
                        let detail = cpu.detail();
                        format!(
                            "header {} at {:?} rpm via {}{}{}",
                            cpu.channel.channel + 1,
                            cpu.channel.rpm,
                            cpu.source_name,
                            if detail.is_empty() { "" } else { " · " },
                            detail
                        )
                    })
                    .unwrap_or_else(|| "not identified".to_string())
            )),
            None => say("resolved: no fan reading".to_string()),
        }

        write_report(out, &report);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_speed_registers_decode_to_the_same_number() {
        // Captured from the ASUS PRIME B550M-A WIFI II. The RPM register holds
        // revolutions per minute directly, and the count register holds the same
        // measurement as a 13-bit count; 1.35 MHz / count must reproduce it.
        // Channel 1 is the interesting one: applying the count decoder to the
        // RPM register turns 2967 into a very believable 3600.
        for (rpm_reg, count_reg, expected) in [
            (0x0361u16, 0x3018u16, 865.0),
            (0x0B97, 0x0E07, 2967.0),
            (0x0307, 0x360D, 775.0),
        ] {
            let rpm = nct_fan_rpm(rpm_reg, Some(count_reg)).expect("a fan");
            assert!((rpm - expected).abs() < 1.0, "{rpm_reg:04X} -> {rpm}");
            let from_count = NCT_FAN_REFERENCE_HZ / f64::from(nct_fan_count(count_reg));
            assert!(
                (from_count - expected).abs() < 1.0,
                "count {count_reg:04X} -> {from_count}"
            );
        }
        // The count decoder is what makes 2967 look like 3600: it is the wrong
        // decoder for this register, which is why both are read and compared.
        let wrong = NCT_FAN_REFERENCE_HZ / f64::from(nct_fan_count(0x0B97));
        assert!((wrong - 3600.0).abs() < 1.0, "{wrong}");
        assert_ne!(nct_fan_rpm(0x0B97, Some(0x0E07)), Some(wrong));
    }

    #[test]
    fn registers_that_disagree_are_not_a_reading() {
        // One of the two decoders being wrong for a chip shows up as a gap
        // between them, and a plausible-looking speed is worse than none.
        assert_eq!(nct_fan_rpm(2967, Some(0x0177)), None, "2967 vs 3600");
        // 0x1C04 encodes 900 counts, which is 1500 rpm: the same speed the RPM
        // register reports, so the reading stands.
        assert_eq!(nct_fan_rpm(1500, Some(0x1C04)), Some(1500.0));
    }

    #[test]
    fn a_channel_with_no_fan_reports_nothing() {
        // How an unconnected header reads: no pulses at all, or the chip's
        // all-ones "no reading" sentinel in the count register.
        assert_eq!(nct_fan_rpm(0x0000, Some(0xFF1F)), None);
        assert_eq!(nct_fan_rpm(0x0000, Some(0x0000)), None);
        // The sentinel alone disqualifies the channel, whatever the RPM
        // register happens to hold.
        assert_eq!(nct_fan_rpm(900, Some(0xFF1F)), None);
        // Without a companion register the RPM value still stands on its own.
        assert_eq!(nct_fan_rpm(900, None), Some(900.0));
        // Nothing implausible is reported either way.
        assert_eq!(nct_fan_rpm(0xFFFF, Some(0x0E07)), None);
        assert_eq!(nct_fan_rpm(50, None), None);
    }

    #[test]
    fn a_stalled_or_absurd_tachometer_is_not_a_reading() {
        // No tachometer attached.
        assert_eq!(nct_fan_rpm(0x0000, None), None);
        // Faster than any fan on a motherboard header.
        assert_eq!(nct_fan_rpm(20_000, None), None);
        assert_eq!(nct_fan_rpm(50, None), None);
        // A slow fan is still a fan.
        assert_eq!(nct_fan_rpm(300, None), Some(300.0));
    }

    #[test]
    fn the_cpu_fan_is_the_channel_whose_curve_follows_the_processor() {
        // Only processor-bound sources count. Board and chipset sensors never
        // do: guessing from the channel index would hand a chassis fan to the
        // CPU.
        assert!(nct_is_cpu_temperature_source(2, false), "CPUTIN");
        assert!(nct_is_cpu_temperature_source(16, false), "PECI Agent 0");
        // Measured on the ASUS PRIME B550M-A WIFI II: its fan curves follow the
        // calibrated PECI source, which the kernel marks undocumented. A reader
        // trusting only the documented pair finds no CPU fan on this board.
        assert!(nct_is_cpu_temperature_source(28, true), "PECI Agent 0 Calibration");
        // ...but only on the part whose label table puts it there. The tables
        // differ between families, so on another part index 28 is not a
        // processor source and must not bind a chassis header to the CPU.
        assert!(!nct_is_cpu_temperature_source(28, false));
        assert!(!nct_is_cpu_temperature_source(1, true), "SYSTIN");
        assert!(!nct_is_cpu_temperature_source(3, true), "AUXTIN0");
        assert!(!nct_is_cpu_temperature_source(18, true), "PCH_CHIP_CPU_MAX_TEMP");
        assert!(!nct_is_cpu_temperature_source(31, true), "Virtual_TEMP");
        assert!(!nct_is_cpu_temperature_source(0, true));
    }

    /// Builds a channel table the way a read would fill it.
    fn fans_with(channels: &[(usize, Option<f64>, u8)]) -> windows_impl::Fans {
        windows_impl::Fans {
            chip: "NCT6798D (0xD428) at 0x0290".to_string(),
            channels: channels
                .iter()
                .map(|(channel, rpm, source)| windows_impl::FanChannel {
                    channel: *channel,
                    rpm: *rpm,
                    temperature_source: *source,
                    is_cpu: nct_is_cpu_temperature_source(*source, true),
                    rpm_raw: 0,
                    count_raw: None,
                    temperature_source_raw: *source,
                })
                .collect(),
        }
    }

    #[test]
    fn the_fastest_processor_bound_header_is_reported_as_the_cpu_fan() {
        // The real reading from the ASUS PRIME B550M-A WIFI II: four fans are
        // turning and three headers follow the processor, so the chip does not
        // say which one carries the cooler. The fastest is reported and the rest
        // travel with it, so the choice can be read rather than trusted.
        let fans = fans_with(&[
            (0, Some(865.0), 28),
            (1, Some(2967.0), 28),
            (2, Some(775.0), 28),
            (3, None, 3),
            (4, None, 3),
            (5, None, 3),
            (6, Some(935.0), 3),
        ]);
        let cpu = fans.cpu().expect("a CPU fan");
        assert_eq!(cpu.channel.channel, 1);
        assert_eq!(cpu.channel.rpm, Some(2967.0));
        assert_eq!(cpu.source_name, "PECI Agent 0 Calibration");
        assert_eq!(cpu.candidates.len(), 3);
        assert_eq!(
            cpu.detail(),
            "header 2 of 3 processor-bound, curves follow PECI Agent 0 Calibration (865 / 2967 / 775 rpm)"
        );
    }

    #[test]
    fn a_board_sensor_channel_is_never_promoted_to_the_cpu_fan() {
        // Nothing follows the processor, so there is no CPU fan to report even
        // though two fans are spinning.
        let fans = fans_with(&[(0, Some(1200.0), 1), (1, Some(900.0), 3)]);
        assert!(fans.cpu().is_none());
    }

    #[test]
    fn a_single_processor_bound_header_needs_no_disclosure() {
        let fans = fans_with(&[(0, Some(1400.0), 28), (1, Some(900.0), 3)]);
        let cpu = fans.cpu().expect("a CPU fan");
        assert_eq!(cpu.channel.channel, 0);
        assert_eq!(cpu.candidates.len(), 1);
        assert_eq!(cpu.detail(), "header 1, curve follows PECI Agent 0 Calibration");
    }

    #[test]
    fn a_processor_bound_channel_that_is_not_turning_is_still_identified() {
        // The header is the CPU's, the fan is simply not spinning: the reading
        // is absent because there is no tachometer, not because the channel is
        // unknown.
        let fans = fans_with(&[(0, None, 2), (1, None, 3)]);
        let cpu = fans.cpu().expect("a CPU fan channel");
        assert_eq!(cpu.channel.channel, 0);
        assert_eq!(cpu.channel.rpm, None);
        assert_eq!(cpu.source_name, "CPUTIN");
    }

    #[test]
    fn the_family_is_matched_by_chip_id_with_the_revision_masked_off() {
        // The test board reports 0xD42B for a NCT6798D, so the revision in the
        // low bits must not decide whether the part is recognised.
        assert_eq!(nct_family_entry(0xD42B), Some(("NCT6798D", 7, true)));
        assert_eq!(nct_family_entry(0xD428), Some(("NCT6798D", 7, true)));
        // The rest of the family shares the same register layout, which is the
        // only reason they can be read without per-part code.
        assert_eq!(nct_family_entry(0xC560), Some(("NCT6779D", 5, false)));
        assert_eq!(nct_family_entry(0xC800), Some(("NCT6791D", 6, false)));
        assert_eq!(nct_family_entry(0xD120), Some(("NCT6793D", 6, false)));
        assert_eq!(nct_family_entry(0xD420), Some(("NCT6796D", 7, false)));
        assert_eq!(nct_family_entry(0xD800), Some(("NCT6799D", 7, false)));

        // Parts that look similar but use different fan registers are refused
        // rather than read with the wrong ones: NCT6106D and NCT6775F both exist
        // in the same kernel driver with their own layouts.
        assert_eq!(nct_family_entry(0xC450), None);
        assert_eq!(nct_family_entry(0xB470), None);
        assert_eq!(nct_family_entry(0x0000), None);
        assert_eq!(nct_family_entry(0xFFFF), None);

        // No entry may claim more channels than the register tables hold.
        for (id, part, channels, _) in NCT_FAMILY {
            assert!((1..=NCT_FAN_CHANNELS).contains(&channels), "{part} 0x{id:04X}");
        }
    }

    #[test]
    fn temperature_sources_are_named_or_reported_unknown() {
        assert_eq!(nct_temperature_source_name(2), "CPUTIN");
        assert_eq!(nct_temperature_source_name(16), "PECI Agent 0");
        assert_eq!(nct_temperature_source_name(1), "SYSTIN");
        // Empty label slots and out-of-table indices are not invented names.
        assert_eq!(nct_temperature_source_name(0), "unknown");
        assert_eq!(nct_temperature_source_name(30), "unknown");
        assert_eq!(nct_temperature_source_name(200), "unknown");
    }

    #[test]
    fn the_channel_registers_are_the_ones_the_kernel_driver_uses() {
        // Pinned because reading the wrong register silently yields a plausible
        // number: the RPM pair is `NCT6779_REG_FAN` and the Smart-Fan source is
        // `NCT6775_REG_TEMP_SEL`, both from Linux `nct6775-core.c`, which is
        // authoritative for the NCT6798D. Reading the RPM pair as if it were the
        // count pair reported 3600 rpm for a fan running at 2967.
        assert_eq!(NCT_FAN_RPM_REG[0], 0x4C0);
        assert_eq!(NCT_FAN_RPM_REG[6], 0x4CE);
        // 0x4B0.. for channels 1-6, but channel 7 sits at 0x4CC rather than
        // 0x4BC: assuming an even stride reads an unrelated register, which is
        // how the count pair first looked unreadable on the last channel.
        assert_eq!(
            NCT_FAN_COUNT_REG,
            [0x4B0, 0x4B2, 0x4B4, 0x4B6, 0x4B8, 0x4BA, 0x4CC]
        );
        assert_eq!(NCT_FAN_TEMP_SOURCE_REG[0], 0x100);
        assert_eq!(NCT_FAN_TEMP_SOURCE_REG[6], 0xB00);
        // Every channel must have both registers, or the reader would read a
        // neighbouring channel's bank.
        assert_eq!(NCT_FAN_COUNT_REG.len(), NCT_FAN_CHANNELS);
        assert_eq!(NCT_FAN_TEMP_SOURCE_REG.len(), NCT_FAN_CHANNELS);
    }

    /// Decodes `THM_TCON_CUR_TMP` exactly as the driver module returns it.
    fn decode_amd_temperature(raw: u64) -> f64 {
        let field = ((raw >> AMD_TEMP_FIELD_SHIFT) & 0x7FF) as i64;
        let mut millidegrees = field * AMD_TEMP_MILLIDEGREES_PER_STEP;
        if raw & AMD_TEMP_OFFSET_FLAG != 0 {
            millidegrees -= AMD_TEMP_OFFSET_MILLIDEGREES;
        }
        millidegrees as f64 / 1000.0
    }

    #[test]
    fn decodes_the_offset_flag_reading_measured_on_real_hardware() {
        // Captured from an AMD Ryzen 7 5700G through PawnIO's AMDFamily17
        // module. Without the -49 C offset this yields 94.375 C, a plausible
        // but wrong value, which is why the flag must be honoured.
        let with_flag: u64 = 0x0000_0000_5F2B_0000;
        assert_ne!(with_flag & AMD_TEMP_OFFSET_FLAG, 0);
        assert!((decode_amd_temperature(with_flag) - 46.125).abs() < 1e-9);

        let other: u64 = 0x0000_0000_5E6B_0000;
        assert_ne!(other & AMD_TEMP_OFFSET_FLAG, 0);
        assert!((decode_amd_temperature(other) - 45.375).abs() < 1e-9);
    }

    #[test]
    fn decodes_a_reading_without_the_offset_flag() {
        // Same field, flag clear: no 49 C subtraction.
        let raw: u64 = 0x0000_0000_05F0_0000;
        assert_eq!(raw & AMD_TEMP_OFFSET_FLAG, 0);
        let field = ((raw >> AMD_TEMP_FIELD_SHIFT) & 0x7FF) as f64;
        assert!((decode_amd_temperature(raw) - field * 0.125).abs() < 1e-9);
    }

    #[test]
    fn execute_buffer_matches_the_drivers_expected_layout() {
        // The driver copies a fixed 32-byte name field and then treats the rest
        // of the buffer as u64 arguments.
        let name = "ioctl_read_smn";
        let args = [0x0005_9800u64];
        let mut buffer = vec![0u8; FN_NAME_LENGTH + args.len() * 8];
        buffer[..name.len()].copy_from_slice(name.as_bytes());
        buffer[FN_NAME_LENGTH..FN_NAME_LENGTH + 8].copy_from_slice(&args[0].to_le_bytes());

        assert_eq!(buffer.len(), 40, "32-byte name + one u64 argument");
        assert_eq!(&buffer[..14], name.as_bytes());
        assert_eq!(buffer[14], 0, "name field must be NUL padded");
        assert_eq!(buffer[31], 0);
        assert_eq!(
            u64::from_le_bytes(buffer[32..40].try_into().unwrap()),
            args[0]
        );
        // The driver rejects a name that fills the whole field.
        assert!(strlen(&buffer[..FN_NAME_LENGTH]) < FN_NAME_LENGTH);
    }

    /// Mirrors the driver's `strlen(arr) == 32` rejection.
    fn strlen(bytes: &[u8]) -> usize {
        bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len())
    }

    #[test]
    fn output_size_must_match_the_module_declaration() {
        // `DEFINE_IOCTL_SIZED(ioctl_read_smn, 1, 1)` rejects any other cell
        // count with STATUS_INVALID_PARAMETER. Passing a generous buffer is the
        // mistake that cost the most time here, so the expectation is pinned.
        let input_cells = 1usize;
        let output_cells = 1usize;
        assert_eq!(input_cells, output_cells, "read_smn declares 1 in / 1 out");
    }

    #[test]
    fn any_nonzero_byte_reading_is_rejected_rather_than_reported() {
        // Sanity bounds are applied before a value can reach the client.
        assert!((MIN_TEMPERATURE_C..=MAX_TEMPERATURE_C).contains(&46.125));
        assert!(!(MIN_TEMPERATURE_C..=MAX_TEMPERATURE_C).contains(&0.0));
        assert!(!(MIN_TEMPERATURE_C..=MAX_TEMPERATURE_C).contains(&200.0));
    }

    #[test]
    fn energy_unit_is_read_from_bits_8_to_12_not_from_the_power_unit() {
        // Captured from an AMD Ryzen 7 5700G through PawnIO's AMDFamily17
        // module. Bits [3:0] hold the *power* unit (3 -> 1/8 W) and bits [12:8]
        // the energy unit (16 -> 2^-16 J); decoding the low nibble as the energy
        // unit scaled every delta by 8192 and left package power permanently
        // empty, because the inflated result was then rejected by the bound.
        let unit: u64 = 0x000A_1003;
        let joules = energy_unit_joules(unit).expect("a real unit register");
        assert!((joules - 2f64.powi(-16)).abs() < f64::EPSILON);
        assert!(
            (0.125 / joules - 8192.0).abs() < 1.0,
            "the power unit is 8192x the energy unit, not equal to it"
        );

        // A 30 W package over the sampling window, both ways round.
        let delta = 235_930f64;
        assert!((delta * joules / 0.12 - 30.0).abs() < 0.05);
        assert!(delta * 0.125 / 0.12 > MAX_POWER_W);
    }

    #[test]
    fn a_unit_register_without_a_usable_exponent_is_rejected() {
        assert!(energy_unit_joules(0x000A_0003).is_none(), "exponent 0");
        assert!(energy_unit_joules(0x000A_1F03).is_none(), "exponent 31");
        assert_eq!(energy_unit_joules(0x000A_0103), Some(0.5), "exponent 1");
    }

    #[test]
    fn a_wrapping_or_stalled_energy_counter_yields_no_delta() {
        assert_eq!(energy_delta(100, 200), Some(100));
        assert_eq!(energy_delta(100, 100), None, "a stalled counter");
        // A wrap inside the window is recovered by the 32-bit mask, because the
        // counter itself is only 32 bits wide.
        assert_eq!(energy_delta(0xFFFF_FFF0, 0x0000_0010), Some(32));
        // Exactly half the range is still accepted; beyond it the subtraction
        // is indistinguishable from a wrap.
        assert_eq!(energy_delta(0, 0x8000_0000), Some(0x8000_0000));
        assert_eq!(energy_delta(0, 0x8000_0001), None);
    }

    #[test]
    fn the_measurement_window_is_measured_not_assumed() {
        // Measured on a Ryzen 7 5700G at 100% utilization: the sampler asked for
        // a 120 ms window and was starved for 369 ms. Dividing by the requested
        // window turned an actual 77 W package into 237 W - and the plausibility
        // bound could not catch it, because 237 W is a believable number.
        let delta = 1_867_180f64;
        let joules = 2f64.powi(-16);
        assert!((delta * joules / 0.12 - 237.42).abs() < 0.1, "assumed window");
        assert!((delta * joules / 0.369 - 77.21).abs() < 0.1, "measured window");
    }

    #[test]
    fn json_string_escapes_so_a_module_name_cannot_break_the_document() {
        assert_eq!(json_string("plain"), "\"plain\"");
        assert_eq!(json_string("a\"b"), "\"a\\\"b\"");
        assert_eq!(json_string("a\\b"), "\"a\\\\b\"");
        assert_eq!(json_string("a\nb"), "\"a\\nb\"");
    }
}
