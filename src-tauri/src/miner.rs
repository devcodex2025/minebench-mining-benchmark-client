use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};
use tokio::io::{AsyncBufReadExt, BufReader};

pub struct MinerState {
    pub child: Arc<Mutex<Option<Child>>>,
}

pub async fn spawn_miner(
    app: AppHandle,
    miner_path: String,
    args: Vec<String>,
    miner_state: tauri::State<'_, MinerState>,
) -> Result<(), String> {
    let mut lock = miner_state.child.lock().unwrap();
    if lock.is_some() {
        return Err("Miner is already running".to_string());
    }

    let path = std::path::PathBuf::from(&miner_path);
    if !path.exists() {
        let message = format!("Miner binary does not exist: {}", miner_path);
        let _ = app.emit("miner-error", message.clone());
        return Err(message);
    }

    let mut command = Command::new(&miner_path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(parent) = path.parent() {
        command.current_dir(parent);
    }

    let _ = app.emit("miner-log", format!("Starting miner: {} {}", miner_path, args.join(" ")));

    let mut child = command
        .spawn()
        .map_err(|e| {
            let message = format!("Failed to spawn miner '{}': {}", miner_path, e);
            let _ = app.emit("miner-error", message.clone());
            message
        })?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

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

    let _app_handle_exit = app.clone();
    let _miner_state_clone = miner_state.child.clone();

    
    // We can't easily wait on the child if it's in the Mutex and we want to kill it.
    // However, tokio's Child has `wait()` which takes `&mut self`.
    // We can store it as `Option<Child>` and then `lock().take()` to kill it.
    
    *lock = Some(child);
    
    // To handle exit, we'll need a separate monitoring task that doesn't hold the lock forever
    tokio::spawn(async move {
       // This is tricky with Mutex.
       // For now, let's just let the user stop it manually or handle exit via some other way.
    });

    Ok(())
}

pub fn stop_miner(miner_state: tauri::State<'_, MinerState>) -> Result<(), String> {
    let mut lock = miner_state.child.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.start_kill();
        Ok(())
    } else {
        Err("Miner is not running".to_string())
    }
}
