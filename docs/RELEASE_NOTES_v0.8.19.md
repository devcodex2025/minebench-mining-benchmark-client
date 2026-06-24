# MineBench v0.8.19

## Fixed

- Benchmark Start now enters a visible loading state immediately.
- Duplicate benchmark launches are blocked while XMRig starts.
- Benchmark startup no longer waits for an unnecessary pool RPC request.
- Mining and benchmark charts no longer display data from the other mode.

## Verification notes

- Version synchronized in `package.json`, `package-lock.json`, and Tauri configuration.
- Full local build remains blocked by the existing mixed-platform `node_modules` installation missing the Linux Rollup optional package.
