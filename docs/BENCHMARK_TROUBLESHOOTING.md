# Quick Troubleshooting Guide: Benchmark No Display Issue

## Problem
✗ Benchmark starts but shows:
- No graph
- No statistics
- No error message
- Blank chart area

## Solutions (in order)

### 1. **Check if Miner is Actually Running** (FIRST THING)
- Open Windows Task Manager (`Ctrl+Shift+Esc`)
- Look for `xmrig.exe` process
- If you don't see it → Miner didn't start
  - Check antivirus/Windows Defender blocking it
  - Check if file exists: `MineBench-Client\Miner\Xmrig\windows-x64\xmrig.exe`

### 2. **Enable Console Logging** (NEW - Shows Diagnostics)
- While benchmark is running, press `F12`
- Go to **Console** tab
- You'll see messages like:
  ```
  ✅ [Benchmark] Hashrate update: 45.23 H/s | Temp: 62°C
  ⏳ [Benchmark] Waiting for miner to start on http://127.0.0.1:4077/2/summary...
  ⚠️  [Benchmark] Failed to fetch from http://127.0.0.1:4077/2/summary: Network error
  ```

### 3. **New Status Indicator** (Shows Real-time Status)
- Look for **blue badge** below the START button
- It now shows:
  - "Mining at 45.23 H/s - Check chart for updates" → ✅ Working
  - "Waiting for miner to start... (checking port 4077)" → ⏳ Miner not responding
  - Red badge with error → ❌ Critical issue

### 4. **Increase Benchmark Duration** (For Old CPUs)
- Click duration dropdown (default 60s)
- Change to **5 Minutes**
- Sandy Bridge needs more time to show stable hashrate
- Watch the **blue badge** - it will update as data arrives

### 5. **Check Firewall**
```
Windows Defender Firewall → Allow an app through firewall
Look for: MineBench-Client
Check both Private and Public
If not there → Add it
```

### 6. **Check Antivirus**
- Windows Defender flags mining software as suspicious
- Temporarily disable Real-Time Protection
- OR add `MineBench-Client/Miner/Xmrig/` to exclusions

### 7. **Verify Miner Exists**
```powershell
# Run in PowerShell
Test-Path "D:\Projects\MineBench dApp\MineBench-Client\Miner\Xmrig\windows-x64\xmrig.exe"
# Should return: True
```

---

## What Each Status Means

| UI Shows | Meaning | What to Do |
|----------|---------|-----------|
| 🟦 "Mining at X H/s - Check chart for updates" | **Working perfectly** | Wait, chart will populate |
| 🟦 "Waiting for miner to start... (port 4077)" | **Miner starting up** | Wait 10-30 seconds, check F12 console |
| 🔴 Red error badge | **Miner crashed** | Check F12 console for error details |
| Nothing shown | **Chart is loading** | Give it 20-30 seconds and check F12 console |

---

## For Intel i7-2640M Users

Your CPU is **very old** (2011, Sandy Bridge). This affects benchmarking:

✅ **Will it work?** Yes, but slowly
```
Expected: 50-100 H/s
Modern CPU: 2000+ H/s
Difference: 20-40x slower
```

✅ **Recommendations:**
1. Use 5-10 minute benchmark (needs more time to stabilize)
2. Monitor temps - old CPUs throttle when hot
3. Close other apps using CPU
4. Don't expect competitive hashrate (mining with this CPU isn't profitable)

---

## Console Messages Explained

### ✅ Good Signs
```
[Benchmark] Hashrate update: 45.23 H/s | Temp: 62°C
```
→ Everything working, data is flowing

### ⏳ Normal Waiting
```
[Benchmark] Waiting for miner to start on http://127.0.0.1:4077/2/summary...
```
→ Miner still initializing, wait 10-30 seconds

### ⚠️ Warning Signs
```
[Benchmark] Failed to fetch from http://127.0.0.1:4077/2/summary: Network error
```
→ Miner not responding, check Task Manager for xmrig.exe

```
[Benchmark] Miner is running but no hashrate detected yet
```
→ Miner started but hasn't begun hashing (normal for first 30s)

---

## Last Resort: Full Restart

If still no graph after 5 minutes:

1. Stop benchmark (click STOP button)
2. Close MineBench application completely
3. Kill any remaining xmrig.exe processes:
   ```powershell
   Stop-Process -Name xmrig -Force
   ```
4. Reopen MineBench
5. Try again with **5-minute duration**
6. Watch F12 console this time

---

## Need More Help?

Check the detailed guide: **INTEL_PROCESSOR_SUPPORT.md**

Contains:
- Full compatibility analysis for i7-2640M
- System requirements breakdown
- Why Sandy Bridge is problematic
- Diagnostic commands to run

