# Cross-Platform Setup Guide

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run tauri:dev` and `npm run tauri:build`. Electron/`electron-builder` references below are outdated.

## Overview

MineBench Client is now configured to support Windows, macOS (Intel & Apple Silicon), and Linux platforms. The application uses a cross-platform binary resolution system that automatically detects your operating system and architecture.

## Directory Structure

The mining binaries are organized by platform and architecture:

```
Miner/
├── Xmrig/
│   ├── win-x64/          # Windows x64
│   ├── macos-x64/        # macOS Intel (x86-64)
│   ├── macos-arm64/      # macOS Apple Silicon (M1, M2, M3, etc.)
│   └── linux-x64/        # Linux x64
└── T-rex/                # (Currently disabled - for future GPU mining)
    ├── win-x64/
    ├── macos-x64/
    ├── macos-arm64/
    └── linux-x64/
```

## Setting Up Each Platform

### Windows (x64)

The Windows x64 XMRig binary is already included (`Miner/Xmrig/win-x64/xmrig.exe`).

**Build Command:**
```bash
npm run build
# Creates: MineBench-Client-0.1.0.exe (NSIS installer)
```

### macOS (Intel & Apple Silicon)

1. **Download XMRig for macOS:**
   - Visit: https://github.com/xmrig/xmrig/releases
   - Download the latest version matching your architecture:
     - **Intel (x64):** `xmrig-6.xx.x-macos-x64.tar.gz`
     - **Apple Silicon (arm64):** `xmrig-6.xx.x-macos-arm64.tar.gz`

2. **Extract and place the binary:**
   ```bash
   # For Intel
   tar -xzf xmrig-6.xx.x-macos-x64.tar.gz
   cp xmrig/xmrig Miner/Xmrig/macos-x64/
   chmod +x Miner/Xmrig/macos-x64/xmrig
   
   # For Apple Silicon
   tar -xzf xmrig-6.xx.x-macos-arm64.tar.gz
   cp xmrig/xmrig Miner/Xmrig/macos-arm64/
   chmod +x Miner/Xmrig/macos-arm64/xmrig
   ```

3. **Generate macOS icon (icns format):**
   ```bash
   # Install png2icns (if not already installed)
   npm install -D png2icns
   
   # Generate icon
   npm run build:icon:macos
   ```

4. **Build DMG installer:**
   ```bash
   npm run build
   # Creates: MineBench-Client-0.1.0.dmg
   ```

**Note:** You may need to install additional build dependencies on macOS:
```bash
brew install python3
```

### Linux (x64)

1. **Download XMRig for Linux:**
   - Visit: https://github.com/xmrig/xmrig/releases
   - Download: `xmrig-6.xx.x-linux-x64.tar.gz`

2. **Extract and place the binary:**
   ```bash
   tar -xzf xmrig-6.xx.x-linux-x64.tar.gz
   cp xmrig/xmrig Miner/Xmrig/linux-x64/
   chmod +x Miner/Xmrig/linux-x64/xmrig
   ```

3. **Install build dependencies (Ubuntu/Debian):**
   ```bash
   sudo apt-get install -y \
     build-essential \
     python3 \
     libx11-dev \
     libxext-dev \
     libxrender-dev
   ```

4. **Build AppImage:**
   ```bash
   npm run build
   # Creates: MineBench-Client-0.1.0.AppImage
   ```

## How Binary Selection Works

The application automatically selects the correct binary based on:

1. **Operating System:** `process.platform`
   - `'win32'` → Windows files (with `.exe` extension)
   - `'darwin'` → macOS files (no extension)
   - `'linux'` → Linux files (no extension)

2. **Architecture:** `process.arch`
   - `'x64'` → 64-bit Intel/AMD
   - `'arm64'` → 64-bit ARM (Apple Silicon, etc.)

3. **Package Status:** `app.isPackaged`
   - Development: Loads from `Miner/` directory in source
   - Production: Loads from packaged app resources

## Code Reference

The binary resolution is handled by the `resolve_miner_path()` function in `src-tauri/src/commands.rs`:

```javascript
function getMinerPath(minerName) {
    const platform = process.platform; // 'win32', 'darwin', 'linux'
    const arch = process.arch; // 'x64', 'arm64'
    
    let platformDir;
    let exeExt = '';
    
    if (platform === 'win32') {
        platformDir = 'win-x64';
        exeExt = '.exe';
    } else if (platform === 'darwin') {
        platformDir = arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
    } else if (platform === 'linux') {
        platformDir = 'linux-x64';
    }
    
    const minerExe = `${minerName}${exeExt}`;
    return app.isPackaged 
        ? path.join(path.dirname(process.execPath), 'Miner', minerName, platformDir, minerExe)
        : path.join(__dirname, '..', 'Miner', minerName, platformDir, minerExe);
}
```

## Building for All Platforms

To build for all three platforms from a single machine (requires all binaries to be present):

```bash
# Build for current platform
npm run tauri:build

# Cross-platform build (requires the target Rust toolchain)
# On Windows: creates .exe/.msi
# On macOS: creates .dmg/.app
# On Linux: creates AppImage/deb
```

## Troubleshooting

### Binary not found error
- Ensure the binary exists at the expected path
- Check file permissions: `chmod +x Miner/Xmrig/*/xmrig`
- Verify the binary matches your architecture

### macOS "Developer cannot be verified"
- Right-click the app → Open
- Or: `xattr -d com.apple.quarantine /path/to/app`

### Linux AppImage won't run
- Make it executable: `chmod +x MineBench-Client-*.AppImage`
- Install required libraries: `sudo apt-get install libfuse2`

### Wayland Display Server

MineBench Client includes native Wayland support. If you're running a modern Linux distribution with Wayland:

```bash
# Wayland is automatically detected and enabled
npm run dev

# Check if running on Wayland
echo $WAYLAND_DISPLAY  # Should show: wayland-0
```

For Wayland-specific troubleshooting, see [WAYLAND_SETUP.md](WAYLAND_SETUP.md).

## Additional Resources

- **XMRig GitHub:** https://github.com/xmrig/xmrig
- **Tauri Docs:** https://tauri.app/
- **Monero Mining Guide:** https://www.getmonero.org/resources/user-guides/mining.html
- **Wayland Support:** [WAYLAND_SETUP.md](WAYLAND_SETUP.md)
