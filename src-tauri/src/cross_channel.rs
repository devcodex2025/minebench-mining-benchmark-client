//! Cross-channel mutual exclusion.
//!
//! The delivery channels are separate applications: each has its own bundle
//! identifier, data directory, installer and scheduled task, and they are meant
//! to be installed side by side. They must never run at the same time, because
//! they would fight over the same CPU/GPU and the same miner process names, and
//! because two miners on one machine corrupt benchmark timings and payout
//! attribution.
//!
//! Tauri's single-instance plugin is keyed on the bundle identifier, so it
//! cannot see the other channels. This module adds a channel-independent lock,
//! a presence record and a cooperative quit request:
//!
//! * the holder takes an exclusive OS lock on `cross-channel.lock` for its whole
//!   lifetime and publishes its identity to `cross-channel.state.json`;
//! * a starting instance that cannot take the lock reads that identity, so the
//!   user can be told which channel is already running;
//! * if the user chooses to close it, we write `cross-channel.quit.json` naming
//!   the other instance's pid and wait for the lock to fall free;
//! * the running instance polls for a quit request addressed to *its* pid and
//!   exits through the normal shutdown path, so the miner is stopped properly.
//!
//! The coordination directory is deliberately shared between channels: it is the
//! point where they talk to each other, not channel state.

use std::fs::{File, TryLockError};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const LOCK_FILE: &str = "cross-channel.lock";
const STATE_FILE: &str = "cross-channel.state.json";
const QUIT_FILE: &str = "cross-channel.quit.json";

/// How often a running instance looks for a quit request addressed to it.
const QUIT_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// How long the asking side waits for the other instance to release the lock.
const RELEASE_TIMEOUT: Duration = Duration::from_secs(15);

/// Identity of a running instance, published by whoever holds the lock.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// Bundle identifier, e.g. `minebench.canary`.
    pub identifier: String,
    /// Installer identity shown to the user, e.g. `MineBench Client Canary`.
    pub product_name: String,
    pub version: String,
    pub pid: u32,
    pub started_at: String,
}

/// A quit request addressed to one specific process.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QuitRequest {
    target_pid: u32,
    requested_at: String,
}

/// Held for as long as this process owns the cross-channel lock.
#[derive(Debug)]
pub struct Ownership {
    /// Dropping the handle releases the OS lock, so it must outlive the process.
    _lock: File,
    quit_file: PathBuf,
}

/// Outcome of trying to take the cross-channel lock.
#[derive(Debug)]
pub enum Acquisition {
    /// No other channel is running; the caller owns the lock now.
    Owned(Ownership),
    /// Another channel holds the lock. Its identity, when readable.
    Conflict(Option<Presence>),
}

/// State the frontend reads to resolve a conflict.
#[derive(Default)]
pub struct CrossChannelState {
    conflict: Mutex<Option<Presence>>,
    ownership: Mutex<Option<Ownership>>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Directory where the channels coordinate with each other.
///
/// Only a per-user location is used: a shared temporary directory would let
/// another user place the lock, the presence record and the quit request, so
/// coordination is skipped rather than attempted when no such directory exists.
fn coordination_dir() -> Option<PathBuf> {
    let base = if cfg!(target_os = "windows") {
        std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/share"))
            })
    };

    let directory = base?.join("MineBench");
    let _ = std::fs::create_dir_all(&directory);
    Some(directory)
}

fn presence_for(app: &AppHandle) -> Presence {
    let config = app.config();
    Presence {
        identifier: config.identifier.clone(),
        product_name: config
            .product_name
            .clone()
            .unwrap_or_else(|| "MineBench Client".to_string()),
        version: app.package_info().version.to_string(),
        pid: std::process::id(),
        started_at: chrono::Utc::now().to_rfc3339(),
    }
}

/// Takes the cross-channel lock, or reports who holds it.
pub fn acquire_in(directory: &Path, presence: Presence) -> io::Result<Acquisition> {
    let lock = File::options()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(directory.join(LOCK_FILE))?;

    match lock.try_lock() {
        Ok(()) => {
            let quit_file = directory.join(QUIT_FILE);
            // A request left behind by a previous run can only ever name the pid
            // that read it, so clearing it here is safe.
            let _ = std::fs::remove_file(&quit_file);
            write_presence(directory, &presence)?;
            Ok(Acquisition::Owned(Ownership {
                _lock: lock,
                quit_file,
            }))
        }
        Err(TryLockError::WouldBlock) => Ok(Acquisition::Conflict(read_presence(directory))),
        Err(TryLockError::Error(error)) => Err(error),
    }
}

/// Asks `target` to exit and waits until the lock becomes free.
pub async fn take_over_in(
    directory: &Path,
    target: &Presence,
    ours: Presence,
    timeout: Duration,
) -> io::Result<Ownership> {
    let request = QuitRequest {
        target_pid: target.pid,
        requested_at: chrono::Utc::now().to_rfc3339(),
    };
    let body = serde_json::to_vec(&request).map_err(io::Error::other)?;
    std::fs::write(directory.join(QUIT_FILE), body)?;

    let deadline = Instant::now() + timeout;
    loop {
        let lock = File::options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(directory.join(LOCK_FILE))?;

        match lock.try_lock() {
            Ok(()) => {
                let quit_file = directory.join(QUIT_FILE);
                let _ = std::fs::remove_file(&quit_file);
                write_presence(directory, &ours)?;
                return Ok(Ownership {
                    _lock: lock,
                    quit_file,
                });
            }
            Err(TryLockError::WouldBlock) => {
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "the other channel did not exit in time",
                    ));
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            Err(TryLockError::Error(error)) => return Err(error),
        }
    }
}

impl Ownership {
    /// Exits the app when another channel asks this instance to step aside.
    pub fn watch_for_quit(&self, app: AppHandle) {
        let quit_file = self.quit_file.clone();
        let pid = std::process::id();
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(QUIT_POLL_INTERVAL).await;
                if quit_targets(&quit_file, pid) {
                    log::info!("cross-channel: another channel asked this instance to exit");
                    app.exit(0);
                    return;
                }
            }
        });
    }
}

fn quit_targets(quit_file: &Path, pid: u32) -> bool {
    let Ok(body) = std::fs::read(quit_file) else {
        return false;
    };
    match serde_json::from_slice::<QuitRequest>(&body) {
        Ok(request) => request.target_pid == pid,
        Err(_) => false,
    }
}

fn write_presence(directory: &Path, presence: &Presence) -> io::Result<()> {
    let body = serde_json::to_vec(presence).map_err(io::Error::other)?;
    let temporary = directory.join(format!("{STATE_FILE}.tmp"));
    std::fs::write(&temporary, body)?;
    // Atomic on both platforms, so a reader never sees a half-written record.
    std::fs::rename(&temporary, directory.join(STATE_FILE))
}

fn read_presence(directory: &Path) -> Option<Presence> {
    let body = std::fs::read(directory.join(STATE_FILE)).ok()?;
    serde_json::from_slice(&body).ok()
}

/// Claims the cross-channel lock, or records the conflict for the frontend.
///
/// Coordination is best effort: a filesystem problem must never stop the client
/// from starting, so failures are logged rather than propagated.
pub fn start(app: &AppHandle) {
    let state = CrossChannelState::default();

    let Some(directory) = coordination_dir() else {
        log::warn!("cross-channel coordination unavailable: no per-user directory");
        app.manage(state);
        return;
    };

    match acquire_in(&directory, presence_for(app)) {
        Ok(Acquisition::Owned(ownership)) => {
            ownership.watch_for_quit(app.clone());
            *lock(&state.ownership) = Some(ownership);
        }
        Ok(Acquisition::Conflict(other)) => {
            *lock(&state.conflict) = other;
        }
        Err(error) => log::warn!("cross-channel coordination unavailable: {error}"),
    }
    app.manage(state);
}

/// The channel that is already running, if this instance could not take the lock.
#[tauri::command]
pub fn cross_channel_conflict(state: tauri::State<'_, CrossChannelState>) -> Option<Presence> {
    lock(&state.conflict).clone()
}

/// Asks the channel reported by [`cross_channel_conflict`] to close, then takes
/// over the lock so this instance can continue.
#[tauri::command]
pub async fn cross_channel_close_other(
    app: AppHandle,
    state: tauri::State<'_, CrossChannelState>,
) -> Result<(), String> {
    let conflict = lock(&state.conflict)
        .clone()
        .ok_or_else(|| "no other channel is running".to_string())?;

    let Some(directory) = coordination_dir() else {
        return Err("there is no per-user directory to coordinate in".to_string());
    };

    let ownership = take_over_in(
        &directory,
        &conflict,
        presence_for(&app),
        RELEASE_TIMEOUT,
    )
    .await
    .map_err(|error| error.to_string())?;

    ownership.watch_for_quit(app.clone());
    *lock(&state.ownership) = Some(ownership);
    *lock(&state.conflict) = None;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "minebench-cross-channel-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).expect("create test directory");
        directory
    }

    fn presence(identifier: &str) -> Presence {
        Presence {
            identifier: identifier.to_string(),
            product_name: "MineBench Client".to_string(),
            version: "0.9.0".to_string(),
            pid: std::process::id(),
            started_at: "2026-10-12T00:00:00+00:00".to_string(),
        }
    }

    #[test]
    fn presence_round_trips_through_json() {
        let original = presence("minebench.canary");
        let body = serde_json::to_vec(&original).expect("serialize");
        let restored: Presence = serde_json::from_slice(&body).expect("deserialize");
        assert_eq!(restored, original);
    }

    #[test]
    fn a_second_instance_reports_the_holder() {
        let directory = test_dir("conflict");
        let held = acquire_in(&directory, presence("minebench.client")).expect("first acquire");
        assert!(matches!(held, Acquisition::Owned(_)));

        let second = acquire_in(&directory, presence("minebench.canary")).expect("second acquire");
        match second {
            Acquisition::Conflict(Some(reported)) => {
                assert_eq!(reported.identifier, "minebench.client");
                assert_eq!(reported.pid, std::process::id());
            }
            other => panic!("expected a conflict naming the holder, got {other:?}"),
        }

        // The holder is still alive, so a third attempt still conflicts.
        assert!(matches!(
            acquire_in(&directory, presence("minebench.nightly")).expect("third acquire"),
            Acquisition::Conflict(_)
        ));
    }

    #[test]
    fn taking_over_waits_for_the_holder_and_publishes_our_identity() {
        let directory = test_dir("take-over");
        let held = acquire_in(&directory, presence("minebench.client")).expect("first acquire");
        let Acquisition::Owned(ownership) = held else {
            panic!("first acquire must own the lock");
        };

        // Release the lock the way a process exit would, then take it over.
        drop(ownership);
        let taken = tauri::async_runtime::block_on(take_over_in(
            &directory,
            &presence("minebench.client"),
            presence("minebench.canary"),
            Duration::from_secs(5),
        ))
        .expect("take over");

        let published = read_presence(&directory).expect("presence published");
        assert_eq!(published.identifier, "minebench.canary");
        drop(taken);
    }

    #[test]
    fn a_quit_request_only_matches_the_pid_it_names() {
        let directory = test_dir("quit");
        let quit_file = directory.join(QUIT_FILE);
        let request = QuitRequest {
            target_pid: 4242,
            requested_at: "2026-10-12T00:00:00+00:00".to_string(),
        };
        std::fs::write(&quit_file, serde_json::to_vec(&request).unwrap()).expect("write request");

        assert!(quit_targets(&quit_file, 4242));
        assert!(!quit_targets(&quit_file, 1));

        std::fs::write(&quit_file, b"not json").expect("write garbage");
        assert!(!quit_targets(&quit_file, 4242));
        assert!(!quit_targets(&directory.join("missing.json"), 4242));
    }
}
