//! One-time migration of the profile written under the legacy bundle
//! identifier `cloud.minebench.client`.
//!
//! Stable inherited that identifier from releases before 0.9 and now uses
//! `minebench.client`. Everything derived from the identifier moves with it: the
//! application data directory (`miner-settings.json`, benchmark history), the
//! log directory, and the webview store that holds the sign-in session.
//!
//! Windows is migrated by the NSIS hook (`migrate-legacy-profile.ps1`), which
//! runs before the new build ever starts. That ordering matters: Tauri creates
//! the windows from `tauri.conf.json` before the `setup` hook, so by the time
//! this code runs the webview store is already open. On other platforms there
//! is no installer hook to run first, so the application data directories are
//! copied here.
//!
//! The migration runs only for the stable identifier (canary and nightly are
//! separate application identities and must stay isolated), only once, and it
//! never overwrites an existing file or deletes the legacy directory.

#[cfg(not(target_os = "windows"))]
use std::path::{Path, PathBuf};

#[cfg(not(target_os = "windows"))]
const LEGACY_ID: &str = "cloud.minebench.client";
#[cfg(not(target_os = "windows"))]
const STABLE_ID: &str = "minebench.client";
#[cfg(not(target_os = "windows"))]
const MARKER: &str = ".migrated-from-cloud-minebench-client";

#[cfg(target_os = "windows")]
pub fn migrate_legacy_profile(_identifier: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn migrate_legacy_profile(identifier: &str) {
    if identifier != STABLE_ID {
        return;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };

    let data_home = xdg("XDG_DATA_HOME", home.join(".local/share"));
    let target = data_home.join(STABLE_ID);
    if target.join(MARKER).exists() {
        return;
    }

    let legacy_data = data_home.join(LEGACY_ID);
    if !legacy_data.is_dir() {
        return;
    }

    let _ = copy_tree(&legacy_data, &target);

    // Configuration is small and holds user-visible settings.
    let config_home = xdg("XDG_CONFIG_HOME", home.join(".config"));
    let legacy_config = config_home.join(LEGACY_ID);
    if legacy_config.is_dir() {
        let _ = copy_tree(&legacy_config, &config_home.join(STABLE_ID));
    }

    let _ = std::fs::create_dir_all(&target);
    let _ = std::fs::write(
        target.join(MARKER),
        "migrated from cloud.minebench.client\n",
    );
}

/// Copies `src` into `dst` recursively, skipping anything that already exists.
/// Symlinks and special files are skipped rather than followed.
#[cfg(not(target_os = "windows"))]
fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if file_type.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else if file_type.is_file() && !target.exists() {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn xdg(key: &str, fallback: PathBuf) -> PathBuf {
    match std::env::var_os(key) {
        Some(value) => PathBuf::from(value),
        None => fallback,
    }
}
