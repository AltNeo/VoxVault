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
    optionally installs/tests/builds frontend, prepares backend dependencies in
    `backend/.venv`, then starts `npm run dev` in `frontend/`.
    Backend is started by Electron's built-in process manager using
    VOXVAULT_BACKEND_CMD.

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

function Stop-VoxVaultFrontendProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoPath
    )

    $escaped = [Regex]::Escape($RepoPath)
    $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            ($_.Name -in @("electron.exe", "node.exe")) -and
            $_.CommandLine -match $escaped
        }

    foreach ($proc in $processes) {
        Stop-ProcessTreeById -ProcessId $proc.ProcessId -Reason "VoxVault frontend process"
    }
}

$rootPath = $PSScriptRoot
$backendPath = Join-Path $rootPath "backend"
$frontendPath = Join-Path $rootPath "frontend"
$venvPath = Join-Path $backendPath ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"

if (-not (Test-Path $backendPath)) {
    throw "Could not find backend directory at '$backendPath'."
}
if (-not (Test-Path $frontendPath)) {
    throw "Could not find frontend directory at '$frontendPath'."
}

Write-Host "Cleaning up running VoxVault instances..."
Stop-VoxVaultFrontendProcesses -RepoPath $rootPath
Stop-PortListeners -Ports @(5173, 8000)
if ($Install -or -not (Test-Path $venvPython)) {
    Write-Host "Setting up backend virtual environment..."
    Push-Location $backendPath
    try {
        python -m venv .venv
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path $venvPython)) {
    throw "Backend virtual environment python not found at '$venvPython'."
}

if ($Install) {
    Write-Host "Installing backend dependencies..."
    & $venvPython -m pip install -r (Join-Path $backendPath "requirements.txt")
} elseif (-not (Test-Path (Join-Path $venvPath "Lib\site-packages\fastapi"))) {
    Write-Host "Installing backend dependencies (first run)..."
    & $venvPython -m pip install -r (Join-Path $backendPath "requirements.txt")
}

if ($NoLaunch) {
    Write-Host "Cleanup complete. Skipping launch because -NoLaunch was specified."
    exit 0
}
$originalBackendCmd = $env:VOXVAULT_BACKEND_CMD
$backendCommand = "`"$venvPython`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000"
$env:VOXVAULT_BACKEND_CMD = $backendCommand

Push-Location $frontendPath
try {
    if ($Install -or -not (Test-Path "node_modules")) {
        Write-Host "Installing frontend dependencies..."
        $env:NPM_CONFIG_IGNORE_SCRIPTS = "false"
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
    Write-Host "Using backend command: $backendCommand"
    npm run dev
} finally {
    Pop-Location
    if ($null -eq $originalBackendCmd) {
        Remove-Item Env:VOXVAULT_BACKEND_CMD -ErrorAction SilentlyContinue
    } else {
        $env:VOXVAULT_BACKEND_CMD = $originalBackendCmd
    }
}
