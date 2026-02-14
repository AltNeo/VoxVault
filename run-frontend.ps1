param(
    [switch]$Install,
    [switch]$SkipTest,
    [switch]$SkipBuild
)

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
        Write-Host "Running frontend build check..."
        npm run build
    }

    Write-Host "Starting frontend dev server..."
    npm run dev
} finally {
    Pop-Location
}
