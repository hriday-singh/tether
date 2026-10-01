<#
.SYNOPSIS
    Tether Monorepo - Server Launcher (Windows PowerShell)

.DESCRIPTION
    Orchestrates launching local development servers (@tether/server on :4000 and
    @tether/web on :3001) or containerized Docker Compose stacks.
    Supports quick-start by pressing Enter to launch both servers.

.PARAMETER Target
    Launch target: 'both' (default), 'server', 'web', 'docker', or 'docker-postgres'.

.PARAMETER SeparateWindows
    Spawns development servers in separate PowerShell terminal windows.

.PARAMETER NonInteractive
    Runs with default target ('both') without prompting.
#>

[CmdletBinding()]
param(
    [ValidateSet('both', 'server', 'web', 'docker', 'docker-postgres', '')]
    [string]$Target = '',

    [switch]$SeparateWindows,

    [switch]$NonInteractive
)

$ErrorActionPreference = 'Stop'

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host "  $Text" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step {
    param([string]$Text)
    Write-Host "--> $Text" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Text)
    Write-Host "[WARN] $Text" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Text)
    Write-Host "[ERROR] $Text" -ForegroundColor Red
}

function Prompt-Choice {
    param(
        [string]$PromptText,
        [string[]]$Options,
        [int]$DefaultIndex = 1
    )
    if ($NonInteractive) {
        return "$DefaultIndex"
    }

    Write-Host ""
    Write-Host $PromptText -ForegroundColor White
    for ($i = 0; $i -lt $Options.Length; $i++) {
        $num = $i + 1
        $suffix = if ($num -eq $DefaultIndex) { " [Default: Press Enter]" } else { "" }
        Write-Host "  [$num] $($Options[$i])$suffix" -ForegroundColor Gray
    }

    Write-Host -NoNewline "Select option (1-$($Options.Length)) [$DefaultIndex]: " -ForegroundColor Yellow
    $ans = Read-Host
    if ([string]::IsNullOrWhiteSpace($ans)) {
        return "$DefaultIndex"
    }
    return $ans.Trim()
}

Write-Header "Tether Monorepo - Server Launcher"

# 1. Environment Verification
$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Warn "No .env file found. Running setup.ps1 first..."
    $setupScript = Join-Path $PSScriptRoot "setup.ps1"
    if (Test-Path $setupScript) {
        & $setupScript -SkipLaunch
    } else {
        Write-Err "setup.ps1 not found! Please create .env from .env.example."
        exit 1
    }
}

# Detect configured ports
$backendPort = "4000"
$frontendPort = "3001"
if (Test-Path $envPath) {
    $envContent = Get-Content $envPath
    $portMatch = $envContent | Select-String -Pattern "^PORT=(\d+)" | Select-Object -First 1
    if ($portMatch) { $backendPort = $portMatch.Matches.Groups[1].Value }
    $webPortMatch = $envContent | Select-String -Pattern "^WEB_PORT=(\d+)" | Select-Object -First 1
    if ($webPortMatch) { $frontendPort = $webPortMatch.Matches.Groups[1].Value }
}

# 2. Build Check
$sharedDist = Join-Path $PSScriptRoot "packages/shared/dist/index.js"
if (-not (Test-Path $sharedDist)) {
    Write-Step "Compiling @tether/shared workspace package..."
    & pnpm --filter @tether/shared build:pkg
    Write-Success "@tether/shared compiled."
}

# 3. Target Selection
if ([string]::IsNullOrEmpty($Target)) {
    $choice = Prompt-Choice `
        -PromptText "Select what to launch:" `
        -Options @(
            "Local: Both Servers (Backend :$backendPort + Web :$frontendPort) [Recommended]",
            "Local: Backend Server Only (Fastify + WS on :$backendPort)",
            "Local: Frontend Web Client Only (Next.js on :$frontendPort)",
            "Docker Compose: Web + Server",
            "Docker Compose: Web + Server + PostgreSQL"
        ) `
        -DefaultIndex 1

    switch ($choice) {
        "1" { $Target = "both" }
        "2" { $Target = "server" }
        "3" { $Target = "web" }
        "4" { $Target = "docker" }
        "5" { $Target = "docker-postgres" }
        default { $Target = "both" }
    }
}

# 4. Check PostgreSQL dependency if local mode
$envRaw = Get-Content $envPath -Raw
if ($Target -in @('both', 'server')) {
    if ($envRaw -match "DATABASE_DRIVER=postgres" -and $envRaw -match "localhost:5432") {
        # Check if port 5432 is responding
        $pgReachable = $false
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $async = $tcp.BeginConnect("127.0.0.1", 5432, $null, $null)
            $wait = $async.AsyncWaitHandle.WaitOne(500, $false)
            if ($wait -and $tcp.Connected) {
                $pgReachable = $true
                $tcp.EndConnect($async)
            }
            $tcp.Close()
        } catch {}

        if (-not $pgReachable) {
            Write-Warn "PostgreSQL on localhost:5432 is not currently reachable."
            $startPg = Prompt-Choice `
                -PromptText "Start PostgreSQL container via Docker Compose now?" `
                -Options @("Yes, start PostgreSQL in Docker [Default]", "No, continue anyway") `
                -DefaultIndex 1
            if ($startPg -eq "1") {
                Write-Step "Starting PostgreSQL container..."
                & docker compose --profile postgres up -d postgres
                Start-Sleep -Seconds 3
            }
        }
    }
}

# 5. Database Migrations
if ($Target -in @('both', 'server')) {
    Write-Step "Checking and applying database migrations..."
    try {
        & pnpm db:migrate
        Write-Success "Database migrations up-to-date."
    } catch {
        Write-Warn "Database migration warning: $_"
    }
}

# 6. Execution
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Starting Tether [$Target]" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

switch ($Target) {
    "both" {
        Write-Host "Endpoints:" -ForegroundColor Cyan
        Write-Host "  * Web App:       http://localhost:$frontendPort" -ForegroundColor Cyan
        Write-Host "  * Backend API:   http://localhost:$backendPort" -ForegroundColor Cyan
        Write-Host "  * WebSocket:     ws://localhost:$backendPort" -ForegroundColor Cyan
        Write-Host "  * Health Check:  http://localhost:$backendPort/health/ready" -ForegroundColor Cyan
        Write-Host ""

        if ($SeparateWindows) {
            Write-Step "Opening Backend Server in new window..."
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Tether Backend Server (:$backendPort)' -ForegroundColor Cyan; pnpm --filter @tether/server dev"
            Write-Step "Opening Frontend Client in new window..."
            Start-Process powershell -ArgumentList "-NoExit", "-Command", "Write-Host 'Tether Web Client (:$frontendPort)' -ForegroundColor Green; pnpm --filter @tether/web dev"
            Write-Success "Both servers launched in dedicated terminal windows."
        } else {
            Write-Host "Press Ctrl+C to stop both servers." -ForegroundColor Gray
            Write-Host ""
            & pnpm --filter @tether/server --filter @tether/web --parallel dev
        }
    }

    "server" {
        Write-Host "Backend API & WebSocket Server" -ForegroundColor Cyan
        Write-Host "  * URL:    http://localhost:$backendPort" -ForegroundColor Cyan
        Write-Host "  * WS:     ws://localhost:$backendPort" -ForegroundColor Cyan
        Write-Host "  * Health: http://localhost:$backendPort/health/ready" -ForegroundColor Cyan
        Write-Host ""
        & pnpm --filter @tether/server dev
    }

    "web" {
        Write-Host "Frontend Web Client (Next.js)" -ForegroundColor Green
        Write-Host "  * URL: http://localhost:$frontendPort" -ForegroundColor Green
        Write-Host ""
        & pnpm --filter @tether/web dev
    }

    "docker" {
        Write-Step "Launching Docker Compose (Server + Web)..."
        Write-Host "  * Web App:     http://localhost:3000" -ForegroundColor Cyan
        Write-Host "  * Backend API: http://localhost:4000" -ForegroundColor Cyan
        Write-Host ""
        & docker compose up
    }

    "docker-postgres" {
        Write-Step "Launching Docker Compose with PostgreSQL..."
        Write-Host "  * Web App:     http://localhost:3000" -ForegroundColor Cyan
        Write-Host "  * Backend API: http://localhost:4000" -ForegroundColor Cyan
        Write-Host "  * PostgreSQL:  localhost:5432" -ForegroundColor Cyan
        Write-Host ""
        & docker compose --profile postgres up
    }
}
