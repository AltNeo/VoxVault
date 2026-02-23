param(
    [switch]$Install
)

<#
.SYNOPSIS
    One-click full-stack launcher for VoxVault.

.DESCRIPTION
    Ensures backend/frontend dependencies exist, then starts:
    - FastAPI backend on http://127.0.0.1:8000
    - Electron frontend dev app (Vite + Electron)

.PARAMETER Install
    Force reinstall of backend/frontend dependencies.

.EXAMPLE
    ./run-all.ps1
    ./run-all.ps1 -Install
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-PortOwners {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        return @()
    }

    return $connections |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            $proc = Get-Process -Id $_ -ErrorAction SilentlyContinue
            if ($proc) {
                "{0} ({1})" -f $proc.ProcessName, $proc.Id
            } else {
                "pid $_"
            }
        }
}

function Test-HttpEndpoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSec = 3
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec $TimeoutSec
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Wait-ForPort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($connections) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Resolve-ServiceStatus {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$ServiceName,
        [Parameter(Mandatory = $true)]
        [string]$HealthUrl
    )

    $owners = @(Get-PortOwners -Port $Port)
    if ($owners.Count -eq 0) {
        return $false
    }

    if (Test-HttpEndpoint -Url $HealthUrl) {
        Write-Host "$ServiceName is already running on port $Port. Reusing existing instance."
        return $true
    }

    $ownerText = $owners -join ", "
    throw "$ServiceName could not start because port $Port is already in use by: $ownerText"
}

function Stop-ProcessTree {
    param(
        [Parameter(Mandatory = $true)]
        [int]$ProcessId,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $proc) {
        return
    }

    Write-Host "Stopping $Name process tree (pid $ProcessId)..."
    & taskkill /PID $ProcessId /T /F | Out-Null
}

function Start-BackendShutdownWatcher {
    param(
        [Parameter(Mandatory = $true)]
        [int]$BackendPid,
        [Parameter(Mandatory = $true)]
        [int]$FrontendPid
    )

    # Run a detached watcher so backend gets cleaned up after frontend closes.
    $watcherCommand = @"
try {
    Wait-Process -Id $FrontendPid -ErrorAction Stop
} catch {}
try {
    if (Get-Process -Id $BackendPid -ErrorAction SilentlyContinue) {
        taskkill /PID $BackendPid /T /F | Out-Null
    }
} catch {}
"@

    Start-Process `
        -FilePath "powershell.exe" `
        -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-Command", $watcherCommand) `
        -WindowStyle Hidden | Out-Null
}

$rootPath = $PSScriptRoot
$backendPath = Join-Path $rootPath "backend"
$frontendPath = Join-Path $rootPath "frontend"
$venvPath = Join-Path $backendPath ".venv"
$venvPython = Join-Path $venvPath "Scripts\python.exe"
$runtimePath = Join-Path $rootPath ".runtime"
$backendOutLog = Join-Path $runtimePath "backend.out.log"
$backendErrLog = Join-Path $runtimePath "backend.err.log"
$frontendOutLog = Join-Path $runtimePath "frontend.out.log"
$frontendErrLog = Join-Path $runtimePath "frontend.err.log"
$backendProc = $null
$frontendProc = $null

if (-not (Test-Path $backendPath)) {
    throw "Could not find backend directory at '$backendPath'."
}
if (-not (Test-Path $frontendPath)) {
    throw "Could not find frontend directory at '$frontendPath'."
}
if (-not (Test-Path $runtimePath)) {
    New-Item -ItemType Directory -Path $runtimePath | Out-Null
}

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

if ($Install -or -not (Test-Path (Join-Path $frontendPath "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    Push-Location $frontendPath
    try {
        $env:NPM_CONFIG_IGNORE_SCRIPTS = "false"
        npm install
    } finally {
        Pop-Location
    }
}

$backendAlreadyRunning = Resolve-ServiceStatus -Port 8000 -ServiceName "Backend" -HealthUrl "http://127.0.0.1:8000/docs"
$frontendAlreadyRunning = Resolve-ServiceStatus -Port 5173 -ServiceName "Frontend" -HealthUrl "http://localhost:5173"

try {
    if (-not $backendAlreadyRunning) {
        Write-Host "Starting backend server in background..."
        Remove-Item $backendOutLog, $backendErrLog -Force -ErrorAction SilentlyContinue
        $backendProc = Start-Process `
            -FilePath $venvPython `
            -ArgumentList @("-m", "uvicorn", "app.main:app", "--reload", "--port", "8000") `
            -WorkingDirectory $backendPath `
            -WindowStyle Hidden `
            -RedirectStandardOutput $backendOutLog `
            -RedirectStandardError $backendErrLog `
            -PassThru
    }

    if (-not $frontendAlreadyRunning) {
        Write-Host "Starting frontend dev app in background..."
        Remove-Item $frontendOutLog, $frontendErrLog -Force -ErrorAction SilentlyContinue
        $env:NPM_CONFIG_IGNORE_SCRIPTS = "false"
        $frontendProc = Start-Process `
            -FilePath "npm.cmd" `
            -ArgumentList @("run", "dev") `
            -WorkingDirectory $frontendPath `
            -WindowStyle Hidden `
            -RedirectStandardOutput $frontendOutLog `
            -RedirectStandardError $frontendErrLog `
            -PassThru
    }

    if (-not $backendAlreadyRunning -and -not (Wait-ForPort -Port 8000 -TimeoutSec 20)) {
        throw "Backend did not bind to port 8000 within 20 seconds. Process: $($backendProc.Id). Logs: '$backendOutLog', '$backendErrLog'"
    }
    if (-not $frontendAlreadyRunning -and -not (Wait-ForPort -Port 5173 -TimeoutSec 30)) {
        throw "Frontend did not bind to port 5173 within 30 seconds. Process: $($frontendProc.Id). Logs: '$frontendOutLog', '$frontendErrLog'"
    }
} catch {
    if ($frontendProc) {
        Stop-ProcessTree -ProcessId $frontendProc.Id -Name "frontend"
    }
    if ($backendProc) {
        Stop-ProcessTree -ProcessId $backendProc.Id -Name "backend"
    }
    throw
}

Write-Host ""
Write-Host "VoxVault is launching."
Write-Host "Backend:  http://127.0.0.1:8000"
Write-Host "Frontend: Electron dev window (Vite on http://localhost:5173)"
Write-Host "Logs:     $runtimePath"
if ($backendProc -and $frontendProc) {
    Start-BackendShutdownWatcher -BackendPid $backendProc.Id -FrontendPid $frontendProc.Id
    Write-Host "Backend process will be stopped when the frontend exits."
}

