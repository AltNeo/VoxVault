param(
    [switch]$Install,
    [switch]$SkipTest,
    [switch]$SkipBuild,
    [switch]$NoLaunch
)

<#
.SYNOPSIS
    Start VoxVault with Electron-managed backend only.

.DESCRIPTION
    Stops existing VoxVault frontend/backend processes, clears ports 5173/8000,
    optionally installs/tests/builds frontend, then starts `npm run dev` in
    `frontend/`. Backend is started by Electron's built-in process manager.

.EXAMPLE
    ./run-electron-managed.ps1
    ./run-electron-managed.ps1 -Install
    ./run-electron-managed.ps1 -NoLaunch
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stop-ProcessTreeById {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [string]$Reason
    )

    if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        return
    }

    Write-Host "Stopping pid $ProcessId ($Reason)..."
    & taskkill /PID $ProcessId /T /F 2>$null | Out-Null
}

function Stop-PortListeners {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$Ports
    )

    foreach ($port in $Ports) {
        $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $connections) {
            continue
        }

        $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($processId in $processIds) {
            Stop-ProcessTreeById -ProcessId $processId -Reason "listening on port $port"
        }
    }
}

function Stop-VoxVaultElectron {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoPath
    )

    $escaped = [Regex]::Escape($RepoPath)
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq "electron.exe" -and
            $_.CommandLine -match $escaped
        }

    foreach ($proc in $processes) {
        Stop-ProcessTreeById -ProcessId $proc.ProcessId -Reason "VoxVault Electron process"
    }
}

$rootPath = $PSScriptRoot
$frontendPath = Join-Path $rootPath "frontend"

if (-not (Test-Path $frontendPath)) {
    throw "Could not find frontend directory at '$frontendPath'."
}

Write-Host "Cleaning up running VoxVault instances..."
Stop-VoxVaultElectron -RepoPath $rootPath
Stop-PortListeners -Ports @(5173, 8000)

if ($NoLaunch) {
    Write-Host "Cleanup complete. Skipping launch because -NoLaunch was specified."
    exit 0
}

Push-Location $frontendPath
try {
    if ($Install -or -not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies..."
        npm install
    } else {
        Write-Host "Dependencies already present. Skipping npm install."
    }

    if (-not $SkipTest) {
        Write-Host "Running frontend tests..."
        npm run test
    }

    if (-not $SkipBuild) {
        Write-Host "Building frontend..."
        npm run build
    }

    Write-Host "Starting Electron dev app (backend managed by Electron)..."
    npm run dev
} finally {
    Pop-Location
}
