# Migrates the profile of a pre-0.9 installation to the stable bundle identifier.
#
# Releases before 0.9 used the identifier `cloud.minebench.client`; everything
# keyed by it (application data, logs, and the WebView2 store that holds the
# sign-in session) now belongs to `minebench`. The stable NSIS hook runs this
# before the new build is ever launched, so no file is in use and the WebView2
# store can be copied safely.
#
# Idempotent: a marker file records completion, existing files are never
# overwritten, and the legacy directory is left in place as a fallback.
#
# Usage: migrate-legacy-profile.ps1 [-LegacyId <id>] [-NewId <id>]

param(
    [string]$LegacyId = 'cloud.minebench.client',
    [string]$NewId = 'minebench.client'
)

$ErrorActionPreference = 'Stop'

function Write-Result {
    param([hashtable]$Value)
    [Console]::Out.Write((ConvertTo-Json -Compress -InputObject $Value))
}

# robocopy exit codes below 8 mean success (1 = files copied, 3 = extras present).
function Copy-Tree {
    param([string]$Source, [string]$Destination, [string[]]$ExcludeDirs = @())

    if (-not (Test-Path -LiteralPath $Source)) { return $false }

    $arguments = @($Source, $Destination, '/E', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
    if ($ExcludeDirs.Count -gt 0) { $arguments += '/XD'; $arguments += $ExcludeDirs }

    $null = & robocopy @arguments 2>&1
    return ($LASTEXITCODE -lt 8)
}

if (-not $env:APPDATA -or -not $env:LOCALAPPDATA) {
    Write-Result @{ migrated = $false; reason = 'no-profile-environment' }
    exit 0
}

$newRoaming = Join-Path $env:APPDATA $NewId
$marker = Join-Path $newRoaming ".migrated-from-$LegacyId"

if (Test-Path -LiteralPath $marker) {
    Write-Result @{ migrated = $false; reason = 'already-migrated' }
    exit 0
}

$legacyRoaming = Join-Path $env:APPDATA $LegacyId
$legacyLocal = Join-Path $env:LOCALAPPDATA $LegacyId

if (-not (Test-Path -LiteralPath $legacyRoaming) -and -not (Test-Path -LiteralPath $legacyLocal)) {
    Write-Result @{ migrated = $false; reason = 'no-legacy-profile' }
    exit 0
}

# WebView2 recreates its caches; copying them would only slow the upgrade down.
$cacheDirs = @('Cache', 'Code Cache', 'GPUCache', 'ShaderCache', 'GrShaderCache', 'DawnCache', 'Crashpad')

$copiedRoaming = Copy-Tree -Source $legacyRoaming -Destination $newRoaming
$copiedLocal = Copy-Tree -Source $legacyLocal -Destination (Join-Path $env:LOCALAPPDATA $NewId) `
    -ExcludeDirs $cacheDirs

# Repoint an autostart entry that still references the pre-0.9 executable.
$installRoot = $null
if ($PSScriptRoot) {
    $installRoot = $PSScriptRoot
    for ($i = 0; $i -lt 3 -and $installRoot; $i++) { $installRoot = Split-Path $installRoot -Parent }
}
$newExe = if ($installRoot) { Join-Path $installRoot 'minebench-client.exe' } else { $null }

$autostartRepointed = $false
if ($newExe -and (Test-Path -LiteralPath $newExe)) {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (Test-Path -LiteralPath $runKey) {
        foreach ($property in (Get-ItemProperty -LiteralPath $runKey).PSObject.Properties) {
            if ($property.Name -like 'PS*' -or $property.Value -isnot [string]) { continue }
            if ($property.Value -match 'MineBench Client\.exe') {
                Set-ItemProperty -LiteralPath $runKey -Name $property.Name -Value ('"' + $newExe + '"')
                $autostartRepointed = $true
            }
        }
    }
}

# The legacy uninstall entry would otherwise linger next to the new one.
$legacyUninstall = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$LegacyId"
$uninstallRemoved = $false
if (Test-Path -LiteralPath $legacyUninstall) {
    Remove-Item -LiteralPath $legacyUninstall -Recurse -Force
    $uninstallRemoved = $true
}

New-Item -ItemType Directory -Path $newRoaming -Force | Out-Null
Set-Content -LiteralPath $marker -Value (Get-Date -Format o)

Write-Result @{
    migrated            = $true
    roaming             = [bool]$copiedRoaming
    local               = [bool]$copiedLocal
    autostartRepointed  = $autostartRepointed
    legacyUninstallGone = $uninstallRemoved
}
