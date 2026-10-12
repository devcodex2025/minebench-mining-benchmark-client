# Registers MineBench's CPU sensor broker so it can read CPU die temperature.
#
# Why a scheduled task: the PawnIO driver's device security descriptor is
# `D:P(A;;GA;;;SY)(A;;GA;;;BA)`, so only LocalSystem and administrators may open
# it. MineBench itself must stay unelevated, so the broker - a small native
# binary - is registered once here, at install time, and Windows then starts it
# on demand without ever prompting the user.
#
# Nothing is elevated until the installer runs this: registration is the consent
# step, and removal on uninstall is symmetric.
#
# Usage:
#   -Operation register -BrokerPath <path to minebench-sensor-broker.exe> [-TaskName <name>] [-StateRoot <name>]
#   -Operation remove [-TaskName <name>]
#   -Operation status [-TaskName <name>]

param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('register', 'remove', 'status')]
    [string]$Operation,

    [string]$BrokerPath,

    # Each channel registers one task under a channel-scoped name, so a canary
    # or nightly installation never replaces a stable installation's task.
    [string]$TaskName = 'MineBenchSensorBroker',

    # Channel-scoped directory the broker publishes its snapshot into. It travels
    # with the task because the broker cannot derive its channel from its own
    # (shared) executable name. The client derives the same name from the product
    # name and reads the snapshot from there.
    # A directory name, never a path: no separators, no leading or trailing dot and
    # no `..`, so the broker's state can only land inside the state root.
    [ValidatePattern('^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$')]
    [string]$StateRoot = 'MineBench'
)

$ErrorActionPreference = 'Stop'

function Get-ExistingTask {
    Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

# Finds the broker executable.
#
# The installer knows the layout, but a repair or a moved installation should
# still work, so the path is discovered rather than assumed: the script's own
# directory tree and the application directory are both searched.
function Find-BrokerPath {
    param([string]$Hint)

    if ($Hint -and (Test-Path -LiteralPath $Hint)) { return (Resolve-Path $Hint).Path }

    # This script ships at <INSTDIR>\_up_\resources\sensor-broker, so walking up
    # three levels gives the installation root of *this* channel. Product-name
    # fallbacks are deliberately not used: they would let one channel register
    # another channel's broker.
    $roots = @()
    if ($PSScriptRoot) {
        $root = $PSScriptRoot
        for ($i = 0; $i -lt 3 -and $root; $i++) { $root = Split-Path $root -Parent }
        if ($root) { $roots += $root }
    }

    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $found = Get-ChildItem -LiteralPath $root -Filter 'minebench-sensor-broker.exe' `
            -Recurse -Depth 3 -File -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Remove-BrokerTask {
    $existing = Get-ExistingTask
    if ($existing) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        return $true
    }
    return $false
}

$resolvedBroker = Find-BrokerPath -Hint $BrokerPath

switch ($Operation) {
    'status' {
        $task = Get-ExistingTask
        [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{
            registered = [bool]$task
            state      = if ($task) { [string]$task.State } else { $null }
            brokerPath = $resolvedBroker
        }))
        exit 0
    }

    'remove' {
        $removed = Remove-BrokerTask
        [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ removed = $removed }))
        exit 0
    }

    'register' {
        if (-not $resolvedBroker) {
            [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{
                ok = $false
                error = 'broker executable not found next to the installation'
            }))
            exit 1
        }

        # Replace any previous registration so an upgrade with a new install path
        # is corrected rather than kept stale.
        Remove-BrokerTask | Out-Null

        $action = New-ScheduledTaskAction -Execute $resolvedBroker -Argument "--state-root $StateRoot"
        # Run on demand: the client starts it per reading, so an elevated process
        # exists only for the duration of one sample.
        $principal = New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\' + $env:USERNAME) `
            -LogonType Interactive -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
            -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -StartWhenAvailable

        Register-ScheduledTask -TaskName $TaskName -Action $action -Principal $principal `
            -Settings $settings `
            -Description 'Reads CPU temperature for MineBench through the PawnIO driver. Started on demand by the client.' | Out-Null

        [Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{
            ok = $true
            registered = $true
            brokerPath = $resolvedBroker
        }))
        exit 0
    }
}
