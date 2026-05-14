use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct MinerState {
    pub child: Arc<Mutex<Option<Child>>>,
}

fn lock_child(child: &Mutex<Option<Child>>) -> std::sync::MutexGuard<'_, Option<Child>> {
    child.lock().unwrap_or_else(|e| e.into_inner())
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

    *lock = Some(child);
    drop(lock); // Release the lock before spawning the monitoring task

    // Monitor the child process and clear state when it exits
    tokio::spawn(async move {
        // Give the process references to stdout/stderr tasks time to start
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

        loop {
            let is_running = {
                let lock = lock_child(&miner_state_clone);
                lock.is_some()
            };

            if !is_running {
                break;
            }

            // Try to wait on the child with a timeout
            let should_clear = {
                let mut lock = lock_child(&miner_state_clone);
                if let Some(child) = lock.as_mut() {
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
                lock.take();
                let _ = app_handle_exit.emit("miner-exit", "Miner process has exited");
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
    });

    Ok(())
}

pub fn stop_miner(miner_state: tauri::State<'_, MinerState>) -> Result<(), String> {
    let mut lock = lock_child(&miner_state.child);
    if let Some(mut child) = lock.take() {
        let _ = child.start_kill();
    }

    Ok(())
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
