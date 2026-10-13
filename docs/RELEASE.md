# 🚀 Quick Start for Releases

## Automated GitHub Release

### Create New Release
```bash
# Update version in package.json
npm version patch  # or minor, or major

# Push with tags
git push && git push --tags
```

This will automatically:
- ✅ Build for Windows (x64 + ARM64)
- ✅ Build for macOS (Intel + Apple Silicon)
- ✅ Build for Linux (x64)
- ✅ Create GitHub Release
- ✅ Upload all installers

## Manual Build

### Local Build (current platform only)
```bash
npm install
npm run dist
```

### Build All Platforms
```bash
npm run dist:all
```

## First Time Setup

1. **Update GitHub repository info** in `package.json`:
   ```json
   "publish": {
     "provider": "github",
     "owner": "your-github-username",
     "repo": "MineBench-Client"
   }
   ```

2. **Ensure icons exist**:
   - ✅ `build/icon.ico` (Windows)
   - ✅ `build/icon.png` (Linux)
   - ⚠️ `build/icon.icns` (macOS) - needs to be created on macOS

3. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Setup multi-platform builds"
   git push
   ```

4. **Create first release**:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

## Download Links
After release, installers will be available at:
`https://github.com/your-username/MineBench-Client/releases`

## Platform Support
- Windows 10/11 (x64, ARM64)
- macOS 10.13+ (Intel, Apple Silicon)
- Linux (x64, AppImage)
