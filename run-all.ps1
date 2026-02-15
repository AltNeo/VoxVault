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
        npm install
    } finally {
        Pop-Location
    }
}

Write-Host "Starting backend server in a new window..."
$backendCommand = "Set-Location '$backendPath'; & '$venvPython' -m uvicorn app.main:app --reload --port 8000"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $backendCommand) | Out-Null

Write-Host "Starting frontend dev app in a new window..."
$frontendCommand = "Set-Location '$frontendPath'; npm run dev"
Start-Process powershell -ArgumentList @("-NoExit", "-Command", $frontendCommand) | Out-Null

Write-Host ""
Write-Host "VoxVault is launching."
Write-Host "Backend:  http://127.0.0.1:8000"
Write-Host "Frontend: Electron dev window (Vite on http://localhost:5173)"

