# Builds the CPU sensor broker and stages it as a Tauri sidecar.
#
# Why a separate step: the broker is a second binary of this Cargo package, and
# `tauri-build` validates `bundle.externalBin` entries *while compiling the
# application*. The sidecar must therefore exist before the app build starts,
# which is exactly what this script does - and why it runs from the npm
# pre-build hook rather than from Node (Node cannot spawn cargo here).
#
# Usage:
#   build-broker.ps1 [-Target <triple>]

param(
    [string]$Target
)

$ErrorActionPreference = 'Stop'

$tauriRoot = Split-Path $PSScriptRoot -Parent
$projectRoot = Split-Path $tauriRoot -Parent
$binaryName = 'minebench-sensor-broker'

# The caller knows which target is being packaged; fall back to the host.
if (-not $Target) {
    $Target = (& rustc -Vv | Select-String '^host:' | ForEach-Object { $_.Line.Split(' ')[1] })
}
if (-not $Target) { throw 'could not determine the target triple' }

$extension = if ($Target -like '*windows*') { '.exe' } else { '' }
$hostTriple = (& rustc -Vv | Select-String '^host:' | ForEach-Object { $_.Line.Split(' ')[1] })

Write-Output "[sensor-broker] target $Target (host $hostTriple)"

if ($Target -ne $hostTriple) {
    # Cross-compiling the helper would need the matching Rust target installed,
    # and packaging only ever needs the artifact for the target being built.
    Write-Output "[sensor-broker] cross build detected; building for the host instead"
    $Target = $hostTriple
    $extension = if ($Target -like '*windows*') { '.exe' } else { '' }
}

$binariesDir = Join-Path $tauriRoot 'binaries'
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
$destination = Join-Path $binariesDir "$binaryName-$Target$extension"

# Break the build-order cycle: the application's build script validates
# `bundle.externalBin` entries *before* any crate is compiled, so the sidecar
# path must exist even to build the broker itself. A placeholder satisfies that
# check and is overwritten by the real artifact below.
if (-not (Test-Path -LiteralPath $destination)) {
    Set-Content -LiteralPath $destination -Value '' -NoNewline -Encoding ascii
    Write-Output "[sensor-broker] seeded placeholder at $destination"
}

& cargo build --release --manifest-path (Join-Path $tauriRoot 'Cargo.toml') --bin $binaryName
if ($LASTEXITCODE -ne 0) { throw "broker build failed with exit code $LASTEXITCODE" }

$built = Join-Path $tauriRoot "target\release\$binaryName$extension"
if (-not (Test-Path -LiteralPath $built)) {
    throw "expected $built to exist after a successful build"
}

Copy-Item -LiteralPath $built -Destination $destination -Force

$size = (Get-Item -LiteralPath $destination).Length
if ($size -lt 1024) { throw "staged broker looks wrong ($size bytes)" }

Write-Output "[sensor-broker] staged $destination ($([math]::Round($size / 1KB)) KB)"
