# TECHNICAL REQUIREMENTS (PRD / TASK FOR AI)

## Project name

**MineBench Client v1.0**

Cross-platform benchmarking and mining client with real Monero mining under the hood.

---

## 1. Project Goal

Redesign and rebuild the existing desktop mining client to:

* Support **Windows, Linux, macOS**
* Provide **real hardware benchmarking using Monero mining**
* Track **per-user performance and expected rewards**
* Deliver a **modern, high-end UI with 3D animations**
* Separate **Benchmark Mode** and **Mining Mode**
* Maintain transparency and user consent

---

## 2. Target Platforms

The client must be built and distributed for:

* Windows (x64)
* Linux (AppImage / deb / rpm)
* macOS (Intel + Apple Silicon)

Cross-platform build system is required.

---

## 3. Technology Stack (Recommended)

### Desktop Framework

* **Tauri** (Rust + WebView, lower CPU/RAM usage)
* Auto-updater support

### Frontend

* **React**
* **Three.js** or **React Three Fiber** for 3D UI
* Tailwind / modern UI system
* GPU-accelerated animations

### Backend (Client-side)

* Rust runtime (Tauri)
* Embedded **XMRig**
* Secure config generation

### Backend (Server-side, assumed)

* Custom Monero mining pool
* Monero wallet-rpc with subaddress support
* REST + WebSocket API

---

## 4. Application Modes

### 4.1 Benchmark Mode (Default)

Purpose:

* Measure real-world mining performance of hardware
* No payouts required

Behavior:

* Limited session time (e.g. 5–10 minutes)
* Auto-generated subaddress or benchmark ID
* Shows:

  * Average hashrate
  * Stability
  * Power usage (if available)
  * Estimated daily/monthly XMR
* Stops automatically

UI:

* Real-time animated graphs
* 3D visualization of CPU/GPU load

---

### 4.2 Mining Mode

Purpose:

* Continuous mining with optional payouts

Behavior:

* Requires explicit user consent
* Persistent subaddress assigned to user
* Manual start / stop
* Configurable:

  * CPU/GPU usage limits
  * Background / foreground mode
* Displays:

  * Live hashrate
  * Shares accepted/rejected
  * Estimated earnings
  * Pool connection status

---

## 5. Mining Architecture

* Embedded **XMRig** binary per OS
* Mining connects ONLY to the official project pool
* Authentication:

  * Login = Monero subaddress
  * Password = user_id / session_id
* No external pools allowed

Reward tracking:

* Based on:

  * Accepted shares
  * Pool-side accounting
* Client displays **expected rewards**, not raw blockchain data

---

## 6. UI / UX Requirements

### Visual Style

* Ultra-modern, dark theme
* Web3 / high-tech aesthetics
* Smooth transitions (60 FPS)
* GPU-accelerated rendering

### 3D UI

* 3D dashboard using Three.js
* Animated:

  * Hashrate waves
  * Thermal / load visualization
  * Hardware abstraction (CPU/GPU nodes)
* Disable 3D on low-end systems automatically

---

## 7. Security & Transparency

* Clear explanation of mining usage
* No background mining without consent
* Visible start/stop controls
* Open-source core logic
* Signed binaries (Windows + macOS)

---

## 8. Configuration Management

* Auto-detect hardware
* Generate optimal XMRig config
* Manual override allowed (advanced users)
* Store configs locally, encrypted

---

## 9. Auto Update System

* Delta updates
* Platform-specific installers
* Rollback on failure

---

## 10. Logging & Telemetry

Client logs:

* Mining start/stop
* Errors
* Performance stats

Telemetry (optional, anonymized):

* OS type
* CPU/GPU model
* Hashrate benchmarks

No personal data stored without consent.

---

## 11. Deliverables

AI must generate:

1. Cross-platform desktop application
2. Modular UI with reusable components
3. Mining controller (start/stop/status)
4. Benchmark mode logic
5. Build scripts for:

   * Windows
   * Linux
   * macOS
6. Documentation:

   * Architecture
   * Build instructions
   * Security notes

---

## 12. Non-Goals (Explicitly)

* No hidden mining
* No browser mining
* No external pool support
* No custodial wallets per user
* No payment IDs

---

## 13. Success Criteria

* App runs on all supported OS
* Stable mining sessions >24h
* Accurate benchmark results
* Smooth UI on mid-range hardware
* Clear user trust and transparency

---

## 14. Tokenized Reward System ($BMT)

### 14.1 Overview

The application uses a **tokenized reward model** where users receive rewards in the native project token **$BMT**, which represents mining contribution and performance.

Mining is performed in **Monero (XMR)**, but user-facing rewards are distributed in **$BMT**, based on internal accounting.

---

### 14.2 Reward Distribution Logic

All mined Monero is accounted internally and split as follows:

* **80%** — allocated to users
* **20%** — allocated to the application treasury (storage vault)

The user **never directly receives XMR** during normal operation.

---

### 14.3 Conversion Model (XMR → $BMT)

* User rewards are calculated based on:

  * Accepted shares
  * Hashrate contribution
  * Mining session duration
* The system calculates the **equivalent value** of mined XMR
* That value is **converted into $BMT** using:

  * Internal pricing logic OR
  * Oracle-based rate (implementation defined)

Important:

* $BMT is a **utility / accounting token**, not a mining pool payout token
* Conversion happens **off-chain or on-chain**, depending on implementation

---

### 14.4 User Reward Formula (Conceptual)

```text
total_xmr_mined = pool_reward
user_share = user_contribution / total_contribution

user_xmr_equivalent = total_xmr_mined * user_share * 0.80
app_xmr_share        = total_xmr_mined * 0.20

user_bmt_reward = convert(user_xmr_equivalent → BMT)
```

---

### 14.5 Treasury / Vault

* 20% of mined value is allocated to the **application treasury**
* Treasury purpose:

  * Infrastructure costs
  * Token liquidity
  * Long-term project sustainability
* Treasury address (reference):

```text
BMT Treasury:
He4qB3mLHzvD98C4HYEqiMjveVdkBGWeG4Knx4wXWC2G
```

*(Address is informational and must not be hardcoded into the client)*

---

### 14.6 Client Responsibilities

The desktop client must:

* Display:

  * Estimated mined XMR (virtual)
  * Converted $BMT rewards
  * User share percentage
* NOT:

  * Handle swaps directly
  * Interact with DEXes
  * Store private keys
* Only fetch:

  * Reward data from backend API

---

### 14.7 Backend Responsibilities (Assumed)

* Maintain authoritative mining statistics
* Calculate XMR-equivalent rewards
* Perform or simulate conversion to $BMT
* Credit user balances in $BMT
* Track treasury allocation separately

---

### 14.8 Transparency & User Communication

The UI must clearly explain:

* Mining is performed in Monero
* Rewards are paid in $BMT
* 80/20 reward split
* $BMT represents mining contribution, not direct XMR ownership

No misleading language allowed.

---

### 14.9 Explicit Non-Goals

* No direct XMR withdrawals from the client
* No private wallet generation inside the app
* No hidden fee mechanics beyond the 20% treasury allocation

---

## ⚠️ VERY IMPORTANT

The system must be designed as:

* **Performance-based reward accounting**
* **Tokenized incentive model**
* NOT as a custodial mining payout wallet
