# Bitbucket releases

Pushing a `v*` tag starts the release pipeline. It builds Linux packages in
Bitbucket Cloud and uses self-hosted runners for Windows and macOS. The final
step uploads all packages to the repository Downloads section used by
MineBench-UI.

## Required repository configuration

1. Enable Bitbucket Pipelines for `minebench-client`.
2. Add a secured repository variable named `BITBUCKET_RELEASE_TOKEN`. Use a
   repository or workspace access token with write access to this repository.
3. Register a Windows runner with the labels `self.hosted`, `windows`, and
   `minebench-windows`. Install Node.js 24, Rust stable, the MSVC build tools,
   and the Tauri 2 Windows prerequisites on the runner host.
4. Register a macOS runner with the labels `self.hosted`, `macos`, and
   `minebench-macos`. Install Node.js 24, Rust stable, Xcode command-line tools,
   and the Tauri 2 macOS prerequisites on the runner host.

The pipeline publishes these stable filenames:

- `MineBench.Client_<version>_x64-setup.exe`
- `MineBench.Client_<version>_x64_en-US.msi`
- `MineBench.Client_<version>_universal.dmg`
- `MineBench.Client_<version>_amd64.AppImage`
- `MineBench.Client_<version>_amd64.deb`
- `MineBench.Client-<version>-1.x86_64.rpm`

Create and push a release tag only after the package version is committed:

```bash
git tag v0.8.29
git push origin v0.8.29
```
