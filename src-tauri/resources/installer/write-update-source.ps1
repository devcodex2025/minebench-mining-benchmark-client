# Registers where this installation gets its updates from.
#
# The channel's installer owns exactly one file, so reinstalling or upgrading
# replaces the registration instead of adding another one. The client ignores a
# file written for a different channel, and falls back to the source compiled
# into the build when this one is missing or unusable.
#
# Usage:
#   write-update-source.ps1 -Channel <stable|canary|nightly> -Identifier <bundle id>
#                           [-DownloadsBase <url>]

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('stable', 'canary', 'nightly')]
    [string]$Channel,

    # A bundle identifier, never a path: reject separators and `..` so the file can
    # only ever land inside the user's own application data directory.
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$')]
    [string]$Identifier,

    [string]$DownloadsBase = 'https://bitbucket.org/minebenchapp/minebench-client/downloads/'
)

$ErrorActionPreference = 'Stop'

# The channel's own application data directory: already isolated per channel by
# the bundle identifier, so no shared location has to be managed.
$directory = Join-Path $env:APPDATA $Identifier
New-Item -ItemType Directory -Path $directory -Force | Out-Null

$source = [ordered]@{
    schemaVersion = 1
    channel       = $Channel
    downloadsBase = $DownloadsBase
    updatedAt     = (Get-Date).ToUniversalTime().ToString('o')
}

$path = Join-Path $directory 'update-source.json'
$source | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $path -Encoding UTF8

[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{
    registered = $path
    channel    = $Channel
}))
