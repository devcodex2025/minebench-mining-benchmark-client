# MineBench Client Setup as Submodule

> **Note:** the client is now **Tauri v2** (`src-tauri/`, Rust + WebView), not Electron. Use `npm run tauri:dev`/`npm run tauri:build`.

## Step 1: Create New GitHub Repository

1. Go to https://github.com/new
2. Repository name: `MineBench-Client`
3. Description: `MineBench Desktop Mining Client - Cross-platform Tauri app`
4. Visibility: Public (or Private)
5. **DO NOT** initialize with README, .gitignore, or license
6. Click "Create repository"

## Step 2: Push MineBench-Client to New Repository

```bash
cd "D:\Projects\MineBench dApp\MineBench-Client"

# Update remote URL (replace YOUR_USERNAME)
git remote set-url origin https://github.com/YOUR_USERNAME/MineBench-Client.git

# Or if no remote exists
git remote add origin https://github.com/YOUR_USERNAME/MineBench-Client.git

# Stage all changes
git add .

# Commit
git commit -m "Initial commit: MineBench Desktop Client v0.2.0

- Cross-platform Tauri app (Windows, macOS, Linux)
- CPU mining with XMRig
- Multi-architecture support (x64, ARM64)
- Custom UI with React + Three.js
- Real-time mining statistics
- Node synchronization monitoring
- GitHub Actions for automated releases"

# Push to GitHub
git push -u origin main
```

## Step 3: Add as Submodule to Main Project

```bash
cd "D:\Projects\MineBench dApp"

# Remove current MineBench-Client directory (after backing up if needed)
# Or move it temporarily
Move-Item "MineBench-Client" "MineBench-Client-backup"

# Add as submodule (replace YOUR_USERNAME)
git submodule add https://github.com/YOUR_USERNAME/MineBench-Client.git MineBench-Client

# Initialize and update submodule
git submodule update --init --recursive

# Commit the submodule
git add .gitmodules MineBench-Client
git commit -m "Add MineBench-Client as submodule"
git push
```

## Step 4: Working with Submodule

### Clone main project with submodules:
```bash
git clone --recursive https://github.com/YOUR_USERNAME/MineBench-dApp.git
```

### Update submodule to latest:
```bash
cd "D:\Projects\MineBench dApp"
git submodule update --remote MineBench-Client
git add MineBench-Client
git commit -m "Update MineBench-Client submodule"
git push
```

### Make changes in submodule:
```bash
cd MineBench-Client
# Make your changes
git add .
git commit -m "Your changes"
git push origin main

# Then update main project
cd ..
git add MineBench-Client
git commit -m "Update MineBench-Client reference"
git push
```

## Benefits of Submodule Approach

✅ Separate repository for client
✅ Independent versioning and releases
✅ CI/CD automation per component
✅ Easier collaboration on specific parts
✅ Cleaner main repository structure
