# 📋 Setup Instructions for MineBench-Client Repository

> **Note:** the client is now **Tauri v2** (`src-tauri/`, Rust + WebView), not Electron. Use `npm run tauri:dev`/`npm run tauri:build`.

## Quick Setup (Copy & Paste)

### 1️⃣ Create New GitHub Repository

Go to: https://github.com/new
- Name: `MineBench-Client`
- Description: `MineBench Desktop Mining Client - Cross-platform Tauri app`
- Public/Private: Your choice
- **DO NOT** add README, .gitignore, or license
- Click "Create repository"

### 2️⃣ Push to New Repository

**Replace `YOUR_USERNAME` with your GitHub username!**

```powershell
cd "D:\Projects\MineBench dApp\MineBench-Client"

# Update package.json publish section first
# Edit line ~88 in package.json:
# "owner": "YOUR_USERNAME",

# Set new remote
git remote set-url origin https://github.com/YOUR_USERNAME/MineBench-Client.git

# Commit everything
git commit -m "Initial commit: MineBench Desktop Client v0.2.0

Features:
- Cross-platform Tauri app (Windows, macOS, Linux)
- Multi-architecture support (x64, ARM64)
- CPU mining with XMRig 6.26.0
- Custom UI with React + Three.js + Tailwind
- Real-time mining statistics
- Node synchronization monitoring
- Thread control slider
- $BMT rewards system with XMR backing
- Custom title bar and window controls
- GitHub Actions for automated releases

Tech Stack:
- Tauri v2 + Rust
- React 18 + TypeScript
- Tailwind CSS 4
- Three.js + React Three Fiber
- Zustand state management
- Vite + Tauri bundler"

# Push to GitHub
git push -u origin main

# Create first tag for release
git tag v0.2.0
git push origin v0.2.0
```

### 3️⃣ Add as Submodule to Main Project

```powershell
cd "D:\Projects\MineBench dApp"

# Backup current directory
Move-Item "MineBench-Client" "MineBench-Client-backup" -Force

# Add as submodule (replace YOUR_USERNAME)
git submodule add https://github.com/YOUR_USERNAME/MineBench-Client.git MineBench-Client

# Initialize submodule
git submodule update --init --recursive

# Commit
git add .gitmodules MineBench-Client
git commit -m "Add MineBench-Client as submodule"
git push

# Remove backup if everything works
# Remove-Item "MineBench-Client-backup" -Recurse -Force
```

### 4️⃣ Verify Everything Works

```powershell
# Check GitHub Actions
# Visit: https://github.com/YOUR_USERNAME/MineBench-Client/actions

# Check Release (after tag push)
# Visit: https://github.com/YOUR_USERNAME/MineBench-Client/releases

# Clone fresh to test
cd D:\Temp
git clone --recursive https://github.com/YOUR_USERNAME/MineBench-dApp.git
cd MineBench-dApp\MineBench-Client
npm install
npm run dev:all
```

## ✅ What You Get

1. **Separate Repository**: MineBench-Client has its own repo
2. **Automated Releases**: Push tags → auto-build for all platforms
3. **Submodule Integration**: Linked to main MineBench dApp project
4. **Clean Structure**: Each component is independent

## 📝 Next Steps

1. Update `package.json` line ~88 with your GitHub username
2. Create GitHub repository
3. Run the commands above
4. Check GitHub Actions builds

## 🔗 Quick Links After Setup

- Repository: `https://github.com/YOUR_USERNAME/MineBench-Client`
- Releases: `https://github.com/YOUR_USERNAME/MineBench-Client/releases`
- Actions: `https://github.com/YOUR_USERNAME/MineBench-Client/actions`

## ⚠️ Important Notes

- Don't forget to replace `YOUR_USERNAME`!
- The first release will be triggered by the `v0.2.0` tag
- GitHub Actions will build for Windows, macOS, and Linux
- Builds take ~10-20 minutes total

---

Need help? Check:
- [BUILD.md](BUILD.md) - Detailed build instructions
- [RELEASE.md](RELEASE.md) - Release process
- [SUBMODULE_SETUP.md](SUBMODULE_SETUP.md) - Submodule details
