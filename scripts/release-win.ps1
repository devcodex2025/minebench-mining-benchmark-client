# MineBench Client - Windows release builder (NSIS-first)
#
# Produces the signed NSIS installer + its Tauri updater `.sig` and the updater
# manifest (`latest.json`) that Bitbucket-hosted auto-updates consume.
#
# Usage:
#   scripts\release-win.ps1                    # full release (NSIS only)
#   scripts\release-win.ps1 -SkipTests         # skip typecheck/unit tests
#   scripts\release-win.ps1 -DryRun            # verify toolchain + print plan only
#   scripts\release-win.ps1 -TryMsi            # also attempt MSI (only after ICE30 fix)
#
# The MSI bundle is currently blocked by WiX ICE30 (minebench-sensor-broker.exe
# is harvested twice, introduced by commit 940e363). NSIS is the release default
# and is unaffected. See docs/RELEASE_CLIENT_v0.8.48.md.
#
# Requires (set before running, never commit):
#   TAURI_SIGNING_PRIVATE_KEY           Tauri updater minisign private key
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD  optional key password

param(
    [switch]$TryMsi,
    [switch]$SkipTests,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$repoRoot   = Split-Path $PSScriptRoot -Parent
$tauriConf  = Join-Path $repoRoot 'src-tauri\tauri.conf.json'
$packageJson = Join-Path $repoRoot 'package.json'
$bundleDir  = Join-Path $repoRoot 'src-tauri\target\release\bundle'
$target     = 'x86_64-pc-windows-msvc'

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "required command '$Name' was not found on PATH"
    }
}

function Assert-LastExit([string]$What) {
    if ($LASTEXITCODE -ne 0) { throw "$What failed with exit code $LASTEXITCODE" }
}

# MSI is attempted only when the ICE30 duplicate-file problem has actually been
# fixed. Until then (commit 940e363) it stays skipped. A genuine fix removes the
# duplicate package entry or adds a WiX override (`bundle.windows.wix`), so either
# signal - or an explicit opt-in - unlocks the MSI attempt.
function Test-Ice30FixPresent {
    if ($env:MINEBENCH_MSI_ICE30_FIXED -match '^(1|true|yes)$') { return $true }
    $conf = Get-Content -LiteralPath $tauriConf -Raw | ConvertFrom-Json
    return [bool]$conf.bundle.windows.wix
}

function Initialize-BuildEnvironment {
    Write-Step "Applying build workarounds"

    $buildTemp = if ($env:MINEBENCH_BUILD_TEMP) { $env:MINEBENCH_BUILD_TEMP } else { 'D:\tmp\minebench-client' }
    if (-not (Test-Path 'D:\')) {
        Write-Warning "D: not available; keeping existing TEMP=$env:TEMP"
    } else {
        if (-not (Test-Path -LiteralPath $buildTemp)) {
            New-Item -ItemType Directory -Force -Path $buildTemp | Out-Null
        }
        $env:TEMP = $buildTemp
        $env:TMP = $buildTemp
        Write-Host "TEMP/TMP -> $buildTemp"
    }

    # Single-job Rust builds avoid exhausting memory on this host.
    if (-not $env:CARGO_BUILD_JOBS) { $env:CARGO_BUILD_JOBS = '1' }
    if (-not $env:NUM_JOBS) { $env:NUM_JOBS = '1' }
    Write-Host "CARGO_BUILD_JOBS=$env:CARGO_BUILD_JOBS NUM_JOBS=$env:NUM_JOBS"
}

function Assert-Toolchain {
    Write-Step "Verifying toolchain"
    Require-Command 'node'
    Require-Command 'npm'
    Require-Command 'rustc'
    Require-Command 'cargo'

    Write-Host "node    $(node --version)"
    Write-Host "rustc   $(rustc --version)"

    $binding = Join-Path $repoRoot 'node_modules\@tauri-apps\cli-win32-x64-msvc'
    if (-not (Test-Path -LiteralPath $binding)) {
        Write-Warning "Tauri Win32 CLI binding missing; installing optional deps"
        & npm install --include=optional
        Assert-LastExit 'npm install --include=optional'
    }
    if (-not (Test-Path -LiteralPath $binding)) {
        throw "Tauri Win32 CLI binding still missing: $binding (run 'npm install --include=optional')"
    }
    Write-Host "tauri   binding present"
}

function Assert-Versions {
    Write-Step "Checking version consistency"
    $pkg = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
    $conf = Get-Content -LiteralPath $tauriConf -Raw | ConvertFrom-Json
    Write-Host "package.json=$($pkg.version) tauri.conf.json=$($conf.version)"
    if ($pkg.version -ne $conf.version) {
        throw "version mismatch between package.json ($($pkg.version)) and tauri.conf.json ($($conf.version))"
    }
    return $pkg.version
}

function Assert-SigningKey {
    if ($DryRun) {
        Write-Host "DryRun: signing key check skipped (no signed build performed)"
        return
    }
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        throw @'
TAURI_SIGNING_PRIVATE_KEY is not set.
Tauri cannot produce updater artifacts (installer .sig) without it.
Set it for this shell (never commit it), then re-run:
  $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content -Raw <minisign-private-key>
  $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '<optional password>'
'@
    }
    Write-Host "TAURI_SIGNING_PRIVATE_KEY present"
}

function Invoke-TauriBuild([string]$bundles) {
    Write-Step "Building $bundles ($target)"
    if ($DryRun) {
        Write-Host "  [DryRun] npm run tauri:build -- --target $target --bundles $bundles"
        return $true
    }
    & npm run tauri:build -- --target $target --bundles $bundles
    return ($LASTEXITCODE -eq 0)
}

function Show-Artifacts {
    Write-Step "Release artifacts"
    if (-not (Test-Path -LiteralPath $bundleDir)) {
        Write-Warning "bundle directory not found: $bundleDir"
        return
    }
    Get-ChildItem -LiteralPath $bundleDir -Recurse -File |
        Where-Object { $_.Name -match '\.(exe|msi|sig)$' -or $_.Name -eq 'latest.json' } |
        ForEach-Object { Write-Host ("  {0}  ({1:N0} bytes)" -f $_.FullName, $_.Length) }
}

# ---------------------------------------------------------------------------

Push-Location $repoRoot
try {
    $version = Assert-Versions
    Write-Host "MineBench Client v$version Windows release (target $target)" -ForegroundColor Green

    Assert-Toolchain
    Initialize-BuildEnvironment
    Assert-SigningKey

    if (-not $SkipTests) {
        Write-Step "Typecheck"
        if ($DryRun) { Write-Host '  [DryRun] npm run typecheck' }
        else { & npm run typecheck; Assert-LastExit 'npm run typecheck' }

        Write-Step "Unit tests"
        if ($DryRun) { Write-Host '  [DryRun] npm test' }
        else { & npm test; Assert-LastExit 'npm test' }
    }

    $nsisOk = Invoke-TauriBuild 'nsis'
    if (-not $nsisOk) { throw 'NSIS build failed' }

    if ($TryMsi) {
        if (Test-Ice30FixPresent) {
            if (-not (Invoke-TauriBuild 'msi')) {
                Write-Warning 'MSI build failed (likely WiX ICE30). Continuing with NSIS artifacts.'
            }
        } else {
            Write-Warning 'MSI skipped: ICE30 fix not detected (see docs/RELEASE_CLIENT_v0.8.48.md).'
        }
    } else {
        Write-Host "MSI not requested (pass -TryMsi once the ICE30 fix is present)."
    }

    Write-Step "Updater manifest"
    if ($DryRun) {
        Write-Host '  [DryRun] npm run updater:manifest'
    } else {
        & npm run updater:manifest
        Assert-LastExit 'npm run updater:manifest'
    }

    Show-Artifacts
    Write-Host "`nDone. Upload the installer, its .sig and latest.json to Bitbucket downloads." -ForegroundColor Green
} finally {
    Pop-Location
}
