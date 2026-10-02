# Release — MineBench Client v0.8.48 (Windows x64, direct-stratum)

Scope: signed **NSIS** Windows x64 installer, its Tauri updater `.sig`, and the
`latest.json` auto-update manifest. Distribution is **Bitbucket only** — do not
use GitHub for artifacts or actions.

## Prerequisites (one-time per shell)

```powershell
# Tauri updater signing key (minisign private key). Never commit this.
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw <path-to-minisign-private-key>
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<optional key password>'
```

The updater endpoint is already configured in `src-tauri/tauri.conf.json`:
`https://bitbucket.org/minebenchapp/minebench-client/downloads/latest.json`

## Build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-win.ps1
```

Useful switches:
- `-SkipTests` — skip `npm run typecheck` / `npm test`
- `-DryRun` — verify toolchain/versions and print the plan, no build
- `-TryMsi` — also attempt the MSI bundle (only after the ICE30 fix, see below)

The script verifies Node/Rust/Tauri toolchain, points `TEMP`/`TMP` at
`D:\tmp\minebench-client`, sets `CARGO_BUILD_JOBS=1` / `NUM_JOBS=1`, runs
typecheck + tests, builds NSIS, then runs `npm run updater:manifest`.

> Do **not** run `npm run dist:win` for releases: it requests all bundles
> (`bundle.targets: "all"`) and therefore hits the blocked MSI step. The script
> and the direct equivalent below request NSIS explicitly:
> ```powershell
> npm run tauri:build -- --target x86_64-pc-windows-msvc --bundles nsis
> npm run updater:manifest
> ```

## Artifacts

Produced under `src-tauri/target/release/bundle/`:
- `nsis/MineBench Client_0.8.48_x64-setup.exe` — installer
- `nsis/MineBench Client_0.8.48_x64-setup.exe.sig` — updater signature
- `latest.json` — updater manifest (references the installer URL)

## Upload to Bitbucket downloads

Upload all three so the updater can verify the release:
1. Installer `.exe`
2. Its matching `.sig`
3. `latest.json`

Web UI: <https://bitbucket.org/minebenchapp/minebench-client/downloads/> →
**Upload files**.

Overwrite the existing `latest.json` with the new one last, after the installer
and `.sig` are present (otherwise clients can fetch a manifest whose installer
is not uploaded yet). The `.sig` filename must exactly match the installer
filename plus `.sig`.

Optional API upload (placeholders — substitute real credentials locally, never
commit them):

```bash
curl -u "$BITBUCKET_USER:$BITBUCKET_APP_PASSWORD" \
  -X POST \
  "https://api.bitbucket.org/2.0/repositories/minebenchapp/minebench-client/downloads" \
  -F "files=@src-tauri/target/release/bundle/nsis/MineBench Client_0.8.48_x64-setup.exe"
# repeat for the .sig, then latest.json (upload latest.json last)
```

## Verify

- `latest.json` `version` is `0.8.48` and its `platforms.windows-x86_64.url`
  resolves to the uploaded installer.
- Fresh install on a clean Windows machine launches and reaches the direct
  stratum endpoint.
- An existing v0.8.47 install sees and applies the update.

## Rollback

The previous installer and manifest remain on the Bitbucket downloads page.

1. Re-upload the previous release's installer + `.sig`, then its `latest.json`
   (or delete the broken `latest.json`), overwriting v0.8.48.
2. Clients that already updated need a manual reinstall of the previous
   installer; the updater only moves forward on higher versions, so either
   publish a higher patch (e.g. 0.8.49) containing the fix or provide the
   previous installer directly.

Keep the previous version's installer, `.sig` and manifest archived before
overwriting `latest.json`.

## MSI blocker (why NSIS is the default)

`bundle.windows` MSI builds fail with WiX **ICE30**:
`minebench-sensor-broker.exe` is harvested into the installer twice. Introduced
by commit `940e363`, which added `bundle.externalBin:
["binaries/minebench-sensor-broker"]` alongside
`bundle.resources: ["resources/sensor-broker/**/*"]`. NSIS is unaffected.

The script attempts MSI only when `Test-Ice30FixPresent` is true, i.e. when
either:
- `bundle.windows.wix` is configured in `src-tauri/tauri.conf.json` (a real WiX
  override/dedup fix), or
- `MINEBENCH_MSI_ICE30_FIXED=1` is set for the shell.

Until then, MSI is skipped and NSIS artifacts are the release. Once the
duplicate-file fix lands, run with `-TryMsi`.
