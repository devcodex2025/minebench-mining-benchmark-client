use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct MinerState {
    pub child: Arc<Mutex<Option<Child>>>,
}

// Kill any running XMRig process when the managed state is dropped (normal app exit).
// This is a safety net; the primary cleanup path is stop_miner_on_exit called from
// the RunEvent::Exit handler, which fires before Drop.
impl Drop for MinerState {
    fn drop(&mut self) {
        let mut lock = lock_child(&self.child);
        if let Some(mut child) = lock.take() {
            let _ = child.start_kill();
        }
    }
}

fn lock_child(child: &Mutex<Option<Child>>) -> std::sync::MutexGuard<'_, Option<Child>> {
    child.lock().unwrap_or_else(|e| e.into_inner())
}

async fn stop_child(child_state: &Arc<Mutex<Option<Child>>>) -> Result<(), String> {
    let child = {
        let mut lock = lock_child(child_state);
        lock.take()
    };

    if let Some(mut child) = child {
        match tokio::time::timeout(tokio::time::Duration::from_secs(5), child.kill()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::InvalidInput => {}
            Ok(Err(error)) => return Err(format!("Failed to stop miner process: {}", error)),
            Err(_) => return Err("Timed out waiting for miner process to stop".to_string()),
        }
    }

    Ok(())
}

pub async fn spawn_miner(
    app: AppHandle,
    miner_path: String,
    args: Vec<String>,
    miner_state: tauri::State<'_, MinerState>,
) -> Result<(), String> {
    let mut lock = lock_child(&miner_state.child);
    if lock.is_some() {
        return Err("Miner is already running".to_string());
    }

    let path = std::path::PathBuf::from(&miner_path);
    if !path.exists() {
        let message = format!("Miner binary does not exist: {}", miner_path);
        let _ = app.emit("miner-error", message.clone());
        return Err(message);
    }

    // On Unix, make sure the miner binary is executable before spawning it.
    // Bundled binaries can lose their executable bit during packaging or
    // extraction, which makes the spawn below fail with "Permission denied"
    // (os error 13). Re-applying the bit is a no-op when it is already set.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(&path) {
            let mode = metadata.permissions().mode();
            if mode & 0o111 == 0 {
                let mut perms = metadata.permissions();
                perms.set_mode(mode | 0o755);
                if let Err(e) = std::fs::set_permissions(&path, perms) {
                    let message = format!(
                        "Failed to make miner binary executable ({}): {}",
                        miner_path, e
                    );
                    let _ = app.emit("miner-error", message.clone());
                    return Err(message);
                }
            }
        }
    }

    let mut cmd = Command::new(&miner_path);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn miner process: {}", e))?;

    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture miner stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to capture miner stderr".to_string())?;

    let app_handle = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle.emit("miner-log", line);
        }
    });

    let app_handle_err = app.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_handle_err.emit("miner-error", line);
        }
    });

    let app_handle_exit = app.clone();
    let miner_state_clone = miner_state.child.clone();
    let miner_pid = child.id();

    *lock = Some(child);
    drop(lock); // Release the lock before spawning the monitoring task

    // Monitor the child process and clear state when it exits
    tokio::spawn(async move {
        // Give the process references to stdout/stderr tasks time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        loop {
            let is_current_process = {
                let lock = lock_child(&miner_state_clone);
                lock.as_ref().and_then(Child::id) == miner_pid
            };

            if !is_current_process {
                break;
            }

            // Try to wait on the child with a timeout
            let should_clear = {
                let mut lock = lock_child(&miner_state_clone);
                if let Some(child) = lock.as_mut() {
                    if child.id() != miner_pid {
                        break;
                    }
                    // Non-blocking check if process has exited
                    match child.try_wait() {
                        Ok(Some(_status)) => true,  // Process exited
                        Ok(None) => false,           // Process still running
                        Err(_) => true,              // Error, assume exited
                    }
                } else {
                    false
                }
            };

            if should_clear {
                let mut lock = lock_child(&miner_state_clone);
                if lock.as_ref().and_then(Child::id) == miner_pid {
                    lock.take();
                    let _ = app_handle_exit.emit("miner-exit", "Miner process has exited");
                }
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    });

    Ok(())
}

pub async fn stop_miner(miner_state: tauri::State<'_, MinerState>) -> Result<(), String> {
    stop_child(&miner_state.child).await
}

/// Kill any running miner process without needing a `tauri::State` wrapper.
/// Used by the RunEvent::Exit handler to guarantee cleanup on normal app close.
pub fn stop_miner_on_exit(state: &MinerState) {
    let mut lock = lock_child(&state.child);
    if let Some(mut child) = lock.take() {
        let _ = child.start_kill();
    }
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(test)]
mod tests {
    use super::*;

    fn sleeping_child() -> Child {
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 30"]);
            command
        };
        #[cfg(not(target_os = "windows"))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 30"]);
            command
        };
        command.spawn().expect("sleep process should start")
    }

    #[test]
    fn stop_miner_on_exit_with_no_child_does_not_panic() {
        let state = MinerState {
            child: Arc::new(Mutex::new(None)),
        };
        stop_miner_on_exit(&state);
    }

    #[test]
    fn miner_state_drop_does_not_panic_when_empty() {
        let state = MinerState {
            child: Arc::new(Mutex::new(None)),
        };
        drop(state);
    }

    #[tokio::test]
    async fn stop_child_waits_for_process_exit_and_clears_state() {
        let state = Arc::new(Mutex::new(Some(sleeping_child())));
        stop_child(&state).await.expect("process should stop");
        assert!(lock_child(&state).is_none());
    }

    #[tokio::test]
    async fn repeated_start_stop_cycles_leave_no_managed_child() {
        let state = Arc::new(Mutex::new(None));
        for _ in 0..3 {
            *lock_child(&state) = Some(sleeping_child());
            stop_child(&state).await.expect("process should stop");
            assert!(lock_child(&state).is_none());
        }
    }

    #[test]
    fn default_thread_count_formula_is_fifty_percent() {
        // Test the formula used in commands::default_thread_count:
        // ((total_cores as u16) / 2).max(1)
        let cases: &[(usize, u16)] = &[
            (1, 1),   // 1 core  → 1 thread (minimum)
            (2, 1),   // 2 cores → 1 thread (50%)
            (4, 2),   // 4 cores → 2 threads (50%)
            (8, 4),   // 8 cores → 4 threads (50%)
            (16, 8),  // 16 cores → 8 threads (50%)
            (32, 16), // 32 cores → 16 threads (50%)
            (64, 32), // 64 cores → 32 threads (50%)
        ];
        for &(cores, expected) in cases {
            let result = ((cores as u16) / 2).max(1);
            assert_eq!(
                result, expected,
                "default_thread_count({}) should be {} but got {}",
                cores, expected, result
            );
        }
    }
}
