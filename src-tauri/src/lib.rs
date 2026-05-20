mod commands;
mod miner;

use miner::MinerState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(MinerState {
            child: Arc::new(Mutex::new(Option::None)),
        })
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::get_cpu_name,
            commands::get_cpu_cores,
            commands::get_cpu_info,
            commands::get_system_stats,
            commands::get_process_stats,
            commands::get_display_status,
            commands::solana_connect_wallet,
            commands::solana_disconnect_wallet,
            commands::solana_get_token_balance,
            commands::get_premium_status,
            commands::backend_request,
            commands::get_runtime_pool_config,
            commands::get_auto_start,
            commands::set_auto_start,
            commands::get_latest_benchmark,
            commands::submit_benchmark_result,
            commands::p2pool_rpc_call,
            commands::get_pool_sync,
            commands::get_cpu_temp,
            commands::get_cpu_power,
            commands::get_gpu_sensors,
            commands::log_to_file,
            commands::save_miner_settings,
            commands::load_miner_settings,
            commands::save_miner_logs,
            commands::report_stats,
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::open_external_url,
            commands::open_logs_directory,
            commands::get_logs_directory,
            commands::get_miner_path,
            commands::start_benchmark,
            commands::stop_benchmark,
            commands::start_mining,
            commands::stop_mining,
            commands::pause_mining,
            commands::resume_mining,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
