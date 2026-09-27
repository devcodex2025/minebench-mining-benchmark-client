# MineBench Client - Build Instructions

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/`); use `npm run tauri:dev` and `npm run tauri:build`. Electron/`electron-builder` references below are outdated.

## Prerequisites
- Node.js 20+
- npm or yarn

## Building for All Platforms

### Build for Current Platform
```bash
npm run dist
```

### Build for Specific Platform
```bash
# Windows (x64 + ARM64)
npm run dist:win

# macOS (Intel + Apple Silicon)
npm run dist:mac

# Linux (x64)
npm run dist:linux
```

### Build for All Platforms
```bash
npm run dist:all
```

**Note:** Building for macOS requires macOS, and signing requires Apple Developer account.

## Icons Setup

### Windows (.ico)
Already configured in `build/icon.ico`

### macOS (.icns)
For macOS builds, you need to create an .icns file:
```bash
# On macOS:
mkdir icon.iconset
sips -z 16 16     public/MineBench.png --out icon.iconset/icon_16x16.png
sips -z 32 32     public/MineBench.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     public/MineBench.png --out icon.iconset/icon_32x32.png
sips -z 64 64     public/MineBench.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   public/MineBench.png --out icon.iconset/icon_128x128.png
sips -z 256 256   public/MineBench.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   public/MineBench.png --out icon.iconset/icon_256x256.png
sips -z 512 512   public/MineBench.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   public/MineBench.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 public/MineBench.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build/icon.icns
rm -rf icon.iconset
```

### Linux (.png)
Already configured in `build/icon.png`

## GitHub Actions Auto-Release

### Setup
1. Push code to GitHub repository
2. Update `package.json` publish section with your GitHub username/repo
3. Create a new tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

### What Happens
- GitHub Actions automatically builds for Windows, macOS, and Linux
- Creates a GitHub Release with all installers
- Supports auto-update for all platforms

### Artifacts Generated
- **Windows**: `MineBench-Client-{version}-x64-setup.exe`, `MineBench-Client-{version}-arm64-setup.exe`
- **macOS**: `MineBench-Client-{version}-x64.dmg`, `MineBench-Client-{version}-arm64.dmg`
- **Linux**: `MineBench-Client-{version}-x64.AppImage`

## Output Directory
All builds are saved to `dist/` folder.

## Troubleshooting

### Missing .icns file
If building on non-macOS systems, the .icns file won't be created automatically. Either:
- Build macOS versions on macOS
- Use a tool to convert PNG to ICNS
- Remove macOS target temporarily

### Code Signing
For production releases, you should sign your applications:
- **Windows**: Use `certificateFile` and `certificatePassword` in electron-builder config
- **macOS**: Requires Apple Developer account and certificates
- **Linux**: No signing required for AppImage

## Environment Variables
Set these in GitHub Secrets for automated releases:
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions
- `CSC_LINK` - (Optional) Certificate for code signing
- `CSC_KEY_PASSWORD` - (Optional) Certificate password
