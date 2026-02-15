param(
    [switch]$Install,
    [switch]$SkipTest,
    [switch]$SkipBuild
)

<#
.SYNOPSIS
    Single-command workflow for the VoxVault Electron + React frontend.

.DESCRIPTION
    Installs dependencies, runs tests, builds, and starts the Electron app in development mode.
    The Electron app uses desktopCapturer for system audio capture.

.PARAMETER Install
    Force npm install even if node_modules exists.

.PARAMETER SkipTest
    Skip running frontend tests.

.PARAMETER SkipBuild
    Skip the build step (useful for quick dev iterations).

.EXAMPLE
    ./run-frontend.ps1
    ./run-frontend.ps1 -Install -SkipTest
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$frontendPath = Join-Path $PSScriptRoot "frontend"
if (-not (Test-Path $frontendPath)) {
    throw "Could not find frontend directory at '$frontendPath'."
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
        Write-Host "Building React app for Electron..."
        npm run build
    }

    Write-Host "Starting Electron app in development mode..."
    npm run dev
} finally {
    Pop-Location
}
