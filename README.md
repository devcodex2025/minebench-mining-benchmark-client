[![MineBench crypto mining benchmark app preview](./public/minebench-preview-main-800px.png)](https://minebench.cloud/downloads)

# MineBench – Crypto Mining Benchmark Tool for CPU & GPU
> The first crypto mining benchmark that lets you **earn crypto while testing CPU and GPU hardware**


## What is MineBench?

MineBench is a **crypto mining benchmark tool for CPU and GPU** that allows users to test hardware performance, measure hashrate, compare hardware, and earn crypto rewards through real mining workloads. It combines **hardware benchmarking** and real **crypto mining**, making it possible to turn performance testing into a reward-generating process for developers, miners, and crypto enthusiasts.

![Solana blockchain support](https://img.shields.io/badge/Solana-3A3A3A?style=for-the-badge&logo=solana&logoColor=00FFA3)
![Monero mining support](https://img.shields.io/badge/Monero-FF6600?style=for-the-badge&logo=monero&logoColor=white)
![Linux app support](https://img.shields.io/badge/Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![Windows app support](https://img.shields.io/badge/Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![macOS app support](https://img.shields.io/badge/macOS-000000?style=for-the-badge&logo=apple&logoColor=white)
![Tauri desktop app](https://img.shields.io/badge/Tauri-24C8D8?style=for-the-badge&logo=tauri&logoColor=white)
![MIT License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)
![Open source project](https://img.shields.io/badge/Open%20Source-Yes-brightgreen?style=for-the-badge)  
[![MineBench logo for crypto mining benchmark platform](public/minebench-logo-yellow-150px.png)](https://minebench.cloud/)

This **mining benchmark client** allows users to measure hashrate, optimize mining efficiency, and earn crypto rewards.


## Features of MineBench Crypto Mining Benchmark Tool

- ⚡ CPU & GPU benchmarking
- ⛏️ Integrated crypto mining support
- 🧠 Real-time hashrate & performance metrics
- 💰 Earn rewards on Solana blockchain
- 🖥️ Cross-platform (Windows, macOS & Linux)
- 🔐 Secure and lightweight Tauri app


## Why Choose MineBench for Crypto Mining Benchmarking

Unlike traditional benchmarks:

- 🧠 Real mining workloads (not synthetic tests)
- 🔗 Blockchain-verified results
- 💰 Earn crypto rewards for benchmarking

## Mining Mode – Earn Crypto via Monero Mining Pool
[![MineBench mining mode for Monero mining pool and crypto rewards](/public/mining-mode-800px.png)](https://minebench.cloud/downloads)

In mining mode you can connect to MineBench own Monero mining pool and increase total hashrate of our pool.
Rewards will be converted to [$BMT token](https://pump.fun/coin/67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev)
- 20% of rewards will be distributed to support our app
- 80% of rewards will be distributed to active community members who run mining mode minimum 15 minutes.
  
Rewards will be distributed in equivalent parts to each active tester in [$BMT token](https://pump.fun/coin/67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev).

Join our testers community you can inside [Discord channel - MineBench](https://discord.gg/vsDyYh4rma)

## Benchmark Mode – CPU & GPU Performance Testing with Rewards
[![MineBench benchmark mode for CPU and GPU mining performance test](/public/benchmark-mode-800px.png)](https://minebench.cloud/downloads)

Our benchmark mode is the main feature of application. This application is built with goal to monetize benchmarks.
Each benchmark matter. Instead of burning compute power each user who run the benchmark supported Monero blockchain network
our mining pool receiving rewards and we will distribute 20% of rewards to each user who ran the benchmark.

In current period of time we looking for ways to implement automatica rewards feature. This feature of automatic rewards
not working yet. But if you run the benchmark you support our application and help us earn money to build this functionality.

## Mining Pool Statistics – Hashrate, Miners, and Found Blocks

[![MineBench mining pool statistics with hashrate miners and found blocks](/public/minebench-preview-800px.png)](https://minebench.cloud/downloads)

In real time each our miner can look at current total hashrate of our mining pool. You can see how many miners online. That current hashrate of pool.
Also includes information about finded blocks.

## $BMT Token – Utility Token for Mining Rewards Distribution
Token listed on pumpfun - [buy $BMT token to support app development](https://pump.fun/coin/67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev)

$BMT token is a utility token. We will convert earned from mining Monero tokens to our token. And will distribute 80% of rewards in $BMT token to each user who participated in seeking the block.
Our token is backed by Monero mining.

## Architectural role

The client is the trust boundary closest to the user machine. It is responsible
for gathering device-level signals, launching local mining workflows, and
presenting benchmark and reward state without embedding backend-only authority.

That split matters:

- the desktop runtime may observe and submit state
- it must not own backend accounting or treasury logic
- any privileged infrastructure access has to remain server-side

## Technology stack

- Tauri (Rust)
- React
- TypeScript
- Vite

## Use Cases for Crypto Mining Benchmark and Hardware Testing

- Benchmark your mining hardware
- Compare GPU and CPU performance
- Optimize mining efficiency
- Earn crypto rewards via benchmarking

## Development & Contribution to MineBench Open Source Project

MineBench Client is the desktop execution layer of the MineBench ecosystem. It
combines the benchmark runtime, miner orchestration, wallet-aware reward
surfaces, and device-local state needed to turn a user workstation into an
auditable mining edge node.

This repository is where user hardware, miner binaries, wallet UX, and product
controls meet. As a result, it has to balance operator-grade reliability with a
consumer-facing user experience.


## What this module owns

- hardware benchmarking and local capability detection
- miner process lifecycle management
- desktop wallet and rewards UX
- device-local telemetry and settings persistence
- multi-platform packaging for Windows, macOS, and Linux

Install dependencies:

```bash
npm install
```

Run the integrated desktop development flow:

```bash
npm run dev:all
```

## Builds

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```


## 🔐 Security & Transparency

- ✅ Fully open-source
- ✅ No hidden mining
- ✅ User-controlled resource usage
- ⚠️ Antivirus may flag mining software as false-positive

All operations are transparent and verifiable.

## License

![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)


## Download MineBench Crypto Mining Benchmark App
[![Download](https://img.shields.io/badge/⬇️_Download-MineBench-blue?style=for-the-badge)](https://minebench.cloud/downloads)

### Note for macOS users

The macOS build is currently not notarized by Apple. On first launch, Gatekeeper
shows *"Apple could not verify that MineBench Client is free of malware"* with no
"Open anyway" option. Do **not** click "Move to Trash". Instead:

1. Click "Done".
2. Open **System Settings → Privacy & Security**, scroll down and click
   **"Open Anyway"** next to the MineBench Client entry, or remove the quarantine
   flag in a terminal:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/MineBench Client.app"
   ```

3. Launch the app again.

## Support the Project – Buy $BMT Token 
[![Support](https://img.shields.io/badge/💰_Support-Buy_Token-green?style=for-the-badge)](https://pump.fun/coin/67ipDsgK6D7bqTW89H8T1KTxUvVuaFy92GX7Q2XFVdev)
