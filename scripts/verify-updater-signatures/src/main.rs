use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde_json::Value;
use std::{env, fs, path::PathBuf};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut project_root = PathBuf::from(".");
    let mut artifact_root = PathBuf::from("release-artifacts");
    let mut version_override = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        let value = args.next().ok_or("argument requires a value")?;
        match arg.as_str() {
            "--project-root" => project_root = value.into(),
            "--artifact-root" => artifact_root = value.into(),
            "--version" => version_override = Some(value),
            _ => return Err("unknown argument".into()),
        }
    }
    let package: Value = serde_json::from_slice(&fs::read(project_root.join("package.json"))?)?;
    let config: Value =
        serde_json::from_slice(&fs::read(project_root.join("src-tauri/tauri.conf.json"))?)?;
    let package_version = package["version"]
        .as_str()
        .ok_or("missing package version")?;
    let config_version = config["version"].as_str().ok_or("missing Tauri version")?;
    if version_override.is_none() && package_version != config_version {
        return Err("package and Tauri versions differ".into());
    }
    let version = version_override.as_deref().unwrap_or(package_version);
    if version.is_empty()
        || !version
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-+".contains(&b))
    {
        return Err("invalid release version".into());
    }
    let encoded_key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("missing updater public key")?;
    let decoded_key = String::from_utf8(STANDARD.decode(encoded_key.trim())?)?;
    let key = PublicKey::decode(&decoded_key)?;
    for suffix in ["x64-setup.exe", "amd64.AppImage"] {
        let name = format!("MineBench.Client_{version}_{suffix}");
        let data = fs::read(artifact_root.join(&name))?;
        if data.is_empty() {
            return Err(format!("empty artifact: {name}").into());
        }
        let encoded_signature = fs::read_to_string(artifact_root.join(format!("{name}.sig")))?;
        let decoded_signature = String::from_utf8(STANDARD.decode(encoded_signature.trim())?)?;
        let signature = Signature::decode(&decoded_signature)?;
        key.verify(&data, &signature, true)?;
        println!("Verified {name}");
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Release signature verification failed: {error}");
        std::process::exit(1);
    }
}
