use std::{fs, path::Path};

fn watch_frontend(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                watch_frontend(&path);
            } else {
                println!("cargo:rerun-if-changed={}", path.display());
            }
        }
    }
}

fn main() {
    // Tauri embeds the renderer assets during the Cargo build. Watch every Vite
    // output file so a reused Cargo target cannot package a stale or empty UI.
    watch_frontend(Path::new("../web-dist"));
    tauri_build::build()
}
