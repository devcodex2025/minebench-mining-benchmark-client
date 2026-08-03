# Bitbucket releases

Pushing a `v*` tag starts the release pipeline. All steps run in Bitbucket
Cloud. It builds native Linux packages and cross-compiles a Windows NSIS
installer with `cargo-xwin`. The final step uploads the packages to the
repository Downloads section used by MineBench-UI.

## Required repository configuration

1. Enable Bitbucket Pipelines for `minebench-client`.
2. Add a secured repository variable named `BITBUCKET_RELEASE_TOKEN`. Use a
   repository or workspace access token with write access to this repository.

No self-hosted runner is required. Bitbucket Cloud only provides Linux Docker
build environments, so it cannot create a macOS DMG. Tauri also requires
Windows for MSI packaging; the Linux cross-build supports NSIS installers.

The pipeline publishes these stable filenames:

- `MineBench.Client_<version>_x64-setup.exe`
- `MineBench.Client_<version>_amd64.AppImage`
- `MineBench.Client_<version>_amd64.deb`
- `MineBench.Client-<version>-1.x86_64.rpm`

Create and push a release tag only after the package version is committed:

```bash
git tag v0.8.29
git push origin v0.8.29
```
