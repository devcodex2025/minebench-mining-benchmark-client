use serde::{Deserialize, Serialize};
use sysinfo::{System, Components};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tokio::sync::oneshot;
use axum::{
    extract::{Query, State},
    response::Html,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use crate::miner::{self, MinerState};

#[derive(Serialize)]
pub struct CpuInfo {
    model: String,
    cores: usize,
    has_aes: bool,
    has_avx: bool,
    has_avx2: bool,
    arch: String,
    platform: String,
    supports_standard_xmrig: bool,
    supports_compat_xmrig: bool,
    message: String,
}

#[tauri::command]
pub fn get_cpu_name() -> String {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    if let Some(cpu) = sys.cpus().first() {
        cpu.brand().to_string()
    } else {
        "Unknown CPU".to_string()
    }
}

#[tauri::command]
pub fn get_cpu_cores() -> usize {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    sys.cpus().len()
}

#[tauri::command]
pub fn get_cpu_info() -> CpuInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    
    let model = sys.cpus().first().map(|c| c.brand().to_string()).unwrap_or_else(|| "Unknown CPU".to_string());
    let cores = sys.cpus().len();
    
    #[cfg(target_arch = "x86_64")]
    let (has_aes, has_avx, has_avx2) = (
        std::is_x86_feature_detected!("aes"),
        std::is_x86_feature_detected!("avx"),
        std::is_x86_feature_detected!("avx2"),
    );
    #[cfg(not(target_arch = "x86_64"))]
    let (has_aes, has_avx, has_avx2) = (false, false, false);

    CpuInfo {
        model,
        cores,
        has_aes,
        has_avx,
        has_avx2,
        arch: std::env::consts::ARCH.to_string(),
        platform: std::env::consts::OS.to_string(),
        supports_standard_xmrig: has_avx2,
        supports_compat_xmrig: has_aes,
        message: if has_avx2 { 
            "✅ Full support".to_string() 
        } else if has_aes { 
            "⚠️ Limited support (use compat version)".to_string() 
        } else { 
            "❌ Legacy only".to_string() 
        },
    }
}

#[derive(Serialize)]
pub struct SystemStats {
    #[serde(rename = "cpuUsage")]
    cpu_usage: f32,
    #[serde(rename = "ramUsage")]
    ram_usage: u64,
    #[serde(rename = "ramTotal")]
    ram_total: u64,
}

#[tauri::command]
pub fn get_system_stats() -> SystemStats {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    
    SystemStats {
        cpu_usage: sys.global_cpu_usage(),
        ram_usage: sys.used_memory(),
        ram_total: sys.total_memory(),
    }
}

// === Solana OAuth ===

#[derive(Deserialize)]
pub struct OAuthCallbackParams {
    #[serde(rename = "publicKey")]
    public_key: String,
    signature: String,
}

#[derive(Serialize, Clone)]
pub struct OAuthResult {
    #[serde(rename = "publicKey")]
    public_key: String,
    signature: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinerStartRequest {
    #[serde(default = "default_device_type")]
    #[serde(alias = "type")]
    device_type: String,
    #[serde(default)]
    wallet: String,
    #[serde(default = "default_worker")]
    worker: String,
    threads: Option<u16>,
    #[serde(default)]
    pool_url: Option<String>,
    #[serde(default)]
    solana_wallet: Option<String>,
    #[serde(default)]
    cpu_priority: Option<u8>,
    #[serde(default)]
    randomx_mode: Option<String>,
    #[serde(default)]
    huge_pages: Option<bool>,
    #[serde(default)]
    donate_level: Option<u8>,
}

fn default_device_type() -> String {
    "cpu".to_string()
}

fn default_worker() -> String {
    "minebench".to_string()
}

struct AppState {
    tx: Mutex<Option<oneshot::Sender<OAuthResult>>>,
}

async fn oauth_callback(
    Query(params): Query<OAuthCallbackParams>,
    State(state): State<Arc<AppState>>,
) -> Html<&'static str> {
    let result = OAuthResult {
        public_key: params.public_key,
        signature: params.signature,
    };

    if let Some(tx) = state.tx.lock().unwrap().take() {
        let _ = tx.send(result);
    }

    Html(r#"
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <title>MineBench — Wallet Connected</title>
            <style>
              body { background: #0a0a0a; color: #e5e7eb; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
              .card { background: #0b0b0b; border: 2px solid #facc15; padding: 2rem; border-radius: 8px; text-align: center; max-width: 500px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
              h1 { color: #facc15; margin: 0 0 1.5rem; font-size: 1.875rem; line-height: 2.25rem; }
              p { color: #d4d4d8; font-size: 1.125rem; line-height: 1.75rem; margin-bottom: 0.5rem; }
              .sub { color: #71717a; font-size: 0.875rem; margin-top: 1.5rem; }
              .icon { color: #facc15; width: 48px; height: 48px; margin-bottom: 1rem; display: inline-block; }
            </style>
          </head>
          <body>
            <div class="card">
              <svg class="icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h1>Wallet Connected</h1>
              <p>You have successfully authenticated.</p>
              <p id="msg">Closing in <span id="timer">3</span>s...</p>
              <div class="sub">Return to the MineBench application to continue.</div>
            </div>
            <script>
                let seconds = 3;
                const timerInfo = document.getElementById('timer');
                const msgInfo = document.getElementById('msg');
                const interval = setInterval(() => {
                  seconds--;
                  timerInfo.innerText = seconds;
                  if (seconds <= 0) {
                    clearInterval(interval);
                    try { window.close(); } catch(e) {}
                    msgInfo.innerText = "You can close this window now.";
                  }
                }, 1000);
            </script>
          </body>
          </html>
    "#)
}

#[tauri::command]
pub async fn solana_connect_wallet(app: AppHandle) -> Result<OAuthResult, String> {
    let (tx, rx) = oneshot::channel();
    let state = Arc::new(AppState {
        tx: Mutex::new(Some(tx)),
    });

    let app_state = state.clone();
    let router = Router::new()
        .route("/callback", get(oauth_callback))
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    // Always use the production wallet page, even in dev builds. Browser wallets
    // commonly trust the production origin, while localhost can break extension
    // connection state and callback redirects during desktop development.
    let base_url = "https://minebench.cloud";
    let callback_url = format!("http://localhost:{}/callback", port);
    let auth_url = format!("{}/wallet-connect?callbackUrl={}", base_url, urlencoding::encode(&callback_url));

    // Use tauri-plugin-opener to open browser
    app.opener().open_url(auth_url, None::<&str>).map_err(|e| e.to_string())?;

    // Run server and wait for callback or timeout
    let server = axum::serve(listener, router);
    
    tokio::select! {
        _ = server => {
            Err("Server closed unexpectedly".to_string())
        }
        res = rx => {
            res.map_err(|e| e.to_string())
        }
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(300)) => {
            Err("Authentication timeout".to_string())
        }
    }
}

#[tauri::command]
pub async fn solana_disconnect_wallet() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn solana_get_token_balance(owner: String, mint: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getTokenAccountsByOwner",
        "params": [
            owner,
            { "mint": mint },
            { "encoding": "jsonParsed" }
        ]
    });

    let response = client
        .post("https://api.mainnet-beta.solana.com")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let payload: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    if let Some(error) = payload.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Solana RPC error");
        return Ok(serde_json::json!({
            "success": false,
            "balance": 0,
            "error": message
        }));
    }

    let accounts = payload
        .get("result")
        .and_then(|result| result.get("value"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();

    let mut balance = 0.0;
    for account in &accounts {
        let token_amount = &account["account"]["data"]["parsed"]["info"]["tokenAmount"];
        if let Some(ui_amount) = token_amount.get("uiAmount").and_then(|value| value.as_f64()) {
            balance += ui_amount;
        } else if let Some(ui_amount_string) = token_amount.get("uiAmountString").and_then(|value| value.as_str()) {
            if let Ok(parsed) = ui_amount_string.parse::<f64>() {
                balance += parsed;
            }
        }
    }

    Ok(serde_json::json!({
        "success": true,
        "balance": balance,
        "accounts": accounts.len()
    }))
}

#[tauri::command]
pub async fn get_premium_status(_public_key: String) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "isPremium": false,
        "xmrWallet": null
    }))
}

#[tauri::command]
pub async fn get_runtime_pool_config() -> Result<serde_json::Value, String> {
    let fallback = serde_json::json!({
        "primary": {
            "poolUrl": "xmr.minebench.cloud:3333",
            "rpcHost": "152.53.15.22",
            "rpcPort": 18089,
            "stratumPort": 3333
        },
        "backup": null
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let response = match client
        .get("https://backend.minebench.cloud/public/config")
        .send()
        .await
    {
        Ok(response) => response,
        Err(_) => return Ok(fallback),
    };

    if !response.status().is_success() {
        return Ok(fallback);
    }

    let config: serde_json::Value = match response.json().await {
        Ok(config) => config,
        Err(_) => return Ok(fallback),
    };

    let primary = &config["pool"]["primary"];
    let stratum_host = primary["stratumHost"].as_str().unwrap_or("xmr.minebench.cloud");
    let stratum_port = primary["stratumPort"].as_u64().unwrap_or(3333);
    let rpc_host = primary["rpcHost"].as_str().unwrap_or("152.53.15.22");
    let rpc_port = primary["rpcPort"].as_u64().unwrap_or(18089);

    Ok(serde_json::json!({
        "primary": {
            "poolUrl": format!("{}:{}", stratum_host, stratum_port),
            "rpcHost": rpc_host,
            "rpcPort": rpc_port,
            "stratumPort": stratum_port
        },
        "backup": null
    }))
}

#[tauri::command]
pub async fn get_auto_start() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "supported": false,
        "enabled": false
    }))
}

#[tauri::command]
pub async fn set_auto_start(_enabled: bool) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "success": false,
        "supported": false,
        "enabled": false
    }))
}

#[tauri::command]
pub async fn get_latest_benchmark(device_type: String) -> Result<serde_json::Value, String> {
    let requested_type = device_type.trim().to_uppercase();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get("https://minebench.cloud/api/benchmarks?limit=200")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = response.status();
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Latest benchmark fetch failed");
        return Err(format!("{} ({})", message, status));
    }

    let latest = body
        .as_array()
        .and_then(|items| {
            items.iter().find(|item| {
                let avg_hashrate = item
                    .get("avg_hashrate")
                    .and_then(|value| value.as_f64())
                    .unwrap_or(0.0);

                if avg_hashrate <= 0.0 {
                    return false;
                }

                item.get("device_type")
                    .and_then(|value| value.as_str())
                    .map(|value| value.trim().eq_ignore_ascii_case(&requested_type))
                    .unwrap_or(false)
            })
        })
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    Ok(latest)
}

#[tauri::command]
pub async fn submit_benchmark_result(record: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post("https://minebench.cloud/api/benchmarks")
        .json(&record)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = res.status();
    let body: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let message = body
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("Benchmark submit failed");
        return Err(format!("{} ({})", message, status));
    }

    Ok(body)
}

// === P2Pool RPC ===

#[tauri::command]
pub async fn p2pool_rpc_call(
    method: String,
    params: serde_json::Value,
    host: String,
    port: u16,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://{}:{}/json_rpc", host, port);
    
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "id": "0",
        "method": method,
        "params": params
    });

    let res = client.post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(error) = json.get("error") {
        return Err(error.get("message").and_then(|m| m.as_str()).unwrap_or("RPC Error").to_string());
    }

    Ok(json.get("result").cloned().unwrap_or(serde_json::Value::Null))
}

#[tauri::command]
pub async fn get_pool_sync(host: String, port: u16) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!("http://{}:{}/get_info", host, port);

    let res = client.get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    
    Ok(data)
}

#[tauri::command]
pub fn get_cpu_temp() -> Result<serde_json::Value, String> {
    let components = Components::new_with_refreshed_list();

    // Look for CPU temperature component
    for component in components.iter() {
        let label = component.label().to_lowercase();
        if label.contains("cpu") || label.contains("package") || label.contains("core") || label.contains("thermal") {
            return Ok(serde_json::json!({
                "success": true,
                "temp": component.temperature()
            }));
        }
    }

    if let Some(temp) = read_windows_acpi_temperature_celsius() {
        return Ok(serde_json::json!({
            "success": true,
            "temp": temp,
            "source": "windows-acpi-thermal-zone"
        }));
    }

    Ok(serde_json::json!({
        "success": false,
        "temp": null,
        "message": "CPU temperature component not found"
    }))
}

#[tauri::command]
pub fn get_cpu_power() -> Result<serde_json::Value, String> {
    if let Some(power) = read_linux_rapl_power_watts() {
        return Ok(serde_json::json!({
            "success": true,
            "power": power,
            "source": "sensor:linux-rapl",
            "estimated": false
        }));
    }

    if let Some(power) = read_windows_hardware_monitor_power_watts() {
        return Ok(serde_json::json!({
            "success": true,
            "power": power,
            "source": "sensor:hardware-monitor-wmi",
            "estimated": false
        }));
    }

    if let Some(power) = estimate_cpu_power_watts() {
        return Ok(serde_json::json!({
            "success": true,
            "power": power,
            "source": "estimated:cpu-utilization-tdp",
            "estimated": true
        }));
    }

    Ok(serde_json::json!({
        "success": false,
        "power": null,
        "message": "CPU power telemetry unavailable"
    }))
}

fn read_windows_acpi_temperature_celsius() -> Option<f64> {
    #[cfg(not(target_os = "windows"))]
    return None;

    #[cfg(target_os = "windows")]
    {
        let script = r#"
try {
  $zones = Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop |
    Where-Object { $_.CurrentTemperature -gt 0 }
  foreach ($zone in $zones) {
    $c = ($zone.CurrentTemperature / 10) - 273.15
    if ($c -gt 0 -and $c -lt 125) {
      [Console]::Out.Write([Math]::Round($c, 2))
      exit 0
    }
  }
} catch {}
exit 1
"#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim().parse::<f64>().ok().filter(|value| *value > 0.0 && *value < 125.0)
    }
}

fn estimate_cpu_power_watts() -> Option<f64> {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(std::time::Duration::from_millis(250));
    sys.refresh_cpu_usage();

    let cpus = sys.cpus();
    if cpus.is_empty() {
        return None;
    }

    let usage = sys.global_cpu_usage().clamp(0.0, 100.0) as f64 / 100.0;
    let brand = cpus.first().map(|cpu| cpu.brand().to_lowercase()).unwrap_or_default();
    let core_count = cpus.len();
    let tdp = estimate_cpu_tdp_watts(&brand, core_count);
    let idle = (tdp * 0.12).max(3.0);
    let dynamic = (tdp - idle).max(1.0) * usage.powf(1.25);
    Some((idle + dynamic).max(1.0))
}

fn estimate_cpu_tdp_watts(brand: &str, core_count: usize) -> f64 {
    let is_mobile = brand.contains("mobile")
        || brand.contains("laptop")
        || brand.contains("notebook")
        || brand.contains("u-")
        || brand.contains(" u ")
        || brand.ends_with('u')
        || brand.contains("p-")
        || brand.ends_with('p');

    if is_mobile {
        return if core_count >= 16 { 45.0 } else if core_count >= 8 { 28.0 } else { 15.0 };
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

fn read_linux_rapl_power_watts() -> Option<f64> {
    #[cfg(not(target_os = "linux"))]
    return None;

    #[cfg(target_os = "linux")]
    {
        use std::{fs, thread, time::Duration};

        for entry in fs::read_dir("/sys/class/powercap").ok()?.flatten() {
            let path = entry.path();
            let energy_path = path.join("energy_uj");
            let first = fs::read_to_string(&energy_path).ok()?.trim().parse::<f64>().ok()?;
            thread::sleep(Duration::from_millis(250));
            let second = fs::read_to_string(&energy_path).ok()?.trim().parse::<f64>().ok()?;
            if second <= first {
                continue;
            }

            return Some(((second - first) / 1_000_000.0) / 0.25);
        }

        None
    }
}

fn read_windows_hardware_monitor_power_watts() -> Option<f64> {
    #[cfg(not(target_os = "windows"))]
    return None;

    #[cfg(target_os = "windows")]
    {
        let script = r#"
$namespaces = @('root\LibreHardwareMonitor','root\OpenHardwareMonitor')
foreach ($ns in $namespaces) {
  try {
    $sensor = Get-CimInstance -Namespace $ns -ClassName Sensor -ErrorAction Stop |
      Where-Object { $_.SensorType -eq 'Power' -and ($_.Name -match 'CPU|Package|Processor') } |
      Select-Object -First 1
    if ($sensor -and $sensor.Value -gt 0) {
      [Console]::Out.Write($sensor.Value)
      exit 0
    }
  } catch {}
}
exit 1
"#;

        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
            .output()
            .ok()?;

        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        stdout.trim().parse::<f64>().ok().filter(|value| *value > 0.0)
    }
}

#[tauri::command]
pub fn get_gpu_sensors() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "success": false,
        "temp": null,
        "power": null,
        "message": "GPU telemetry not yet implemented in Rust backend"
    }))
}

#[tauri::command]
pub fn save_miner_settings(app: AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let settings_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("miner-settings.json");
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_miner_settings(app: AppHandle) -> Result<serde_json::Value, String> {
    let settings_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("miner-settings.json");
    if !settings_path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let content = std::fs::read_to_string(settings_path).map_err(|e| e.to_string())?;
    let settings = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(settings)
}

#[tauri::command]
pub fn save_miner_logs(
    app: AppHandle,
    system_logs: Vec<String>,
    miner_logs: Vec<String>,
    session_type: String,
    device: String,
) -> Result<serde_json::Value, String> {
    let logs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    let now = chrono::Local::now();
    let timestamp = now.format("%Y-%m-%dT%H-%M-%S").to_string();
    let filename = format!("minebench-{}-{}-{}.log", session_type, device, timestamp);
    let filepath = logs_dir.join(&filename);

    let content = format!(
        "=== MineBench {} Logs ===\nDevice: {}\nTimestamp: {}\n\n=== SYSTEM LOGS ===\n{}\n\n=== MINER LOGS ===\n{}",
        session_type.to_uppercase(),
        device,
        now.to_rfc3339(),
        system_logs.join("\n"),
        miner_logs.join("\n")
    );

    std::fs::write(&filepath, content).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "success": true,
        "filepath": filepath.to_string_lossy(),
        "logsDir": logs_dir.to_string_lossy()
    }))
}

#[tauri::command]
pub fn report_stats(_temp: Option<f32>, _power: Option<f32>) {
}

#[tauri::command]
pub async fn log_to_file(app: AppHandle, level: String, message: String, source: String) -> Result<(), String> {
    use std::io::Write;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;

    let now = chrono::Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let log_file_path = log_dir.join(format!("app-{}.log", date_str));

    let log_line = format!("[{}] [{}] [{}] {}\n", 
        now.format("%Y-%m-%dT%H:%M:%S"),
        source,
        level.to_uppercase(),
        message
    );

    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_path)
        .map_err(|e| e.to_string())?;

    file.write_all(log_line.as_bytes()).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_maximize(window: tauri::Window) -> Result<(), String> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    app.opener().open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_logs_directory(app: AppHandle) -> Result<serde_json::Value, String> {
    let logs_dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("logs");
    std::fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "path": logs_dir.to_string_lossy()
    }))
}

#[tauri::command]
fn resolve_miner_path(app: &AppHandle, miner_name: &str) -> Result<PathBuf, String> {
    let platform = std::env::consts::OS; // "windows", "macos", "linux"
    let arch = std::env::consts::ARCH; // "x86_64", "aarch64"

    let platform_dir = match (platform, arch) {
        ("windows", "aarch64") => "win-arm64".to_string(),
        ("windows", _) => "win-x64".to_string(),
        ("macos", "aarch64") => "macos-arm64".to_string(),
        ("macos", _) => "macos-x64".to_string(),
        ("linux", _) => "linux-x64".to_string(),
        _ => return Err(format!("Unsupported platform/arch: {}/{}", platform, arch)),
    };

    let exe_ext = if platform == "windows" { ".exe" } else { "" };
    let miner_folder = if miner_name.to_lowercase() == "xmrig" { "Xmrig" } else { &miner_name };
    let miner_exe = format!("{}{}", miner_name, exe_ext);

    let mut miner_sub_dir = "";
    if miner_name.to_lowercase() == "xmrig" {
        #[cfg(target_arch = "x86_64")]
        {
            if std::is_x86_feature_detected!("avx2") {
                miner_sub_dir = "";
            } else if std::is_x86_feature_detected!("aes") {
                miner_sub_dir = "compat";
            } else {
                miner_sub_dir = "legacy";
            }
        }
    }

    let platform_path = if !miner_sub_dir.is_empty() {
        Path::new(&platform_dir).join(miner_sub_dir)
    } else {
        PathBuf::from(&platform_dir)
    };

    let mut relative_miner_paths = vec![
        Path::new("Miner")
            .join(miner_folder)
            .join(&platform_path)
            .join(&miner_exe),
    ];

    if miner_name.to_lowercase() == "xmrig" {
        let root_path = Path::new("Miner")
            .join(miner_folder)
            .join(&platform_dir)
            .join(&miner_exe);
        let legacy_path = Path::new("Miner")
            .join(miner_folder)
            .join(&platform_dir)
            .join("legacy")
            .join(&miner_exe);

        if !relative_miner_paths.contains(&root_path) {
            relative_miner_paths.push(root_path);
        }
        if !relative_miner_paths.contains(&legacy_path) {
            relative_miner_paths.push(legacy_path);
        }
    }

    let mut candidates = Vec::new();

    if let Ok(resource_path) = app.path().resource_dir() {
        for relative_path in &relative_miner_paths {
            candidates.push(resource_path.join(relative_path));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        for relative_path in &relative_miner_paths {
            candidates.push(current_dir.join(relative_path));
            candidates.push(current_dir.join("..").join(relative_path));
        }
    }

    #[cfg(debug_assertions)]
    {
        for relative_path in &relative_miner_paths {
            candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join(relative_path));
        }
    }

    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }

    let checked = candidates
        .iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("; ");

    Err(format!(
        "Miner binary not found. Checked: {}",
        checked
    ))
}

#[tauri::command]
pub async fn get_miner_path(app: AppHandle, miner_name: String) -> Result<String, String> {
    Ok(resolve_miner_path(&app, &miner_name)?.to_string_lossy().to_string())
}

fn build_xmrig_args(request: &MinerStartRequest, _benchmark: bool) -> Result<(String, Vec<String>), String> {
    if request.device_type.to_lowercase() == "gpu" {
        return Err("GPU mining is not implemented in the Tauri backend yet".to_string());
    }

    let pool_url = request
        .pool_url
        .clone()
        .unwrap_or_else(|| "xmr.minebench.cloud:3333".to_string());
    let normalized_pool = if pool_url.contains("://") {
        pool_url
    } else {
        format!("stratum+tcp://{}", pool_url)
    };
    let worker = request.worker.replace(char::is_whitespace, "-");
    let rig_id = request
        .solana_wallet
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| worker.clone());
    let api_port = "4077";
    let donate_level = request.donate_level.unwrap_or(0).to_string();
    let cpu_priority = request.cpu_priority.unwrap_or(2).to_string();
    let randomx_mode = request
        .randomx_mode
        .clone()
        .unwrap_or_else(|| "auto".to_string());

    let mut args = vec![
        "--coin".to_string(),
        "monero".to_string(),
        "-o".to_string(),
        normalized_pool,
        "-u".to_string(),
        request.wallet.clone(),
        "-p".to_string(),
        "x".to_string(),
        "--rig-id".to_string(),
        rig_id,
        "--http-enabled".to_string(),
        "--http-host".to_string(),
        "127.0.0.1".to_string(),
        "--http-port".to_string(),
        api_port.to_string(),
        "--donate-level".to_string(),
        donate_level,
        "--cpu-priority".to_string(),
        cpu_priority,
        "--randomx-mode".to_string(),
        randomx_mode,
    ];

    if request.huge_pages.unwrap_or(true) {
        args.push("--randomx-1gb-pages".to_string());
    }

    if let Some(threads) = request.threads {
        if threads > 0 {
            args.push("-t".to_string());
            args.push(threads.to_string());
        }
    }

    Ok(("xmrig".to_string(), args))
}

#[tauri::command]
pub async fn start_benchmark(
    app: AppHandle,
    request: MinerStartRequest,
    state: tauri::State<'_, MinerState>,
) -> Result<(), String> {
    let (miner_name, args) = build_xmrig_args(&request, true)?;
    let miner_path = resolve_miner_path(&app, &miner_name)?.to_string_lossy().to_string();
    miner::spawn_miner(app, miner_path, args, state).await
}

#[tauri::command]
pub async fn stop_benchmark(state: tauri::State<'_, MinerState>) -> Result<(), String> {
    miner::stop_miner(state)
}

#[tauri::command]
pub async fn start_mining(
    app: AppHandle,
    request: MinerStartRequest,
    state: tauri::State<'_, MinerState>,
) -> Result<(), String> {
    let (miner_name, args) = build_xmrig_args(&request, false)?;
    let miner_path = resolve_miner_path(&app, &miner_name)?.to_string_lossy().to_string();
    miner::spawn_miner(app, miner_path, args, state).await
}

#[tauri::command]
pub async fn stop_mining(state: tauri::State<'_, MinerState>) -> Result<(), String> {
    miner::stop_miner(state)
}

#[tauri::command]
pub async fn pause_mining() -> Result<String, String> {
    Ok("Pause is not implemented in the Tauri backend yet".to_string())
}

#[tauri::command]
pub async fn resume_mining() -> Result<String, String> {
    Ok("Resume is not implemented in the Tauri backend yet".to_string())
}
