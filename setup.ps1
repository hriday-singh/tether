<#
.SYNOPSIS
    Tether Monorepo - Setup Wizard (Windows PowerShell)

.DESCRIPTION
    Interactive setup script to configure environment variables (.env), database drivers
    (SQLite / PostgreSQL), generate cryptographic secrets, install dependencies, and build
    shared workspace packages.
    Supports quick-start by pressing Enter to accept all recommended defaults.

.PARAMETER Mode
    Setup mode: 'local' (default), 'docker', or 'all'.

.PARAMETER Database
    Database driver: 'sqlite' (default) or 'postgres'.

.PARAMETER DatabaseUrl
    PostgreSQL connection string (when Database is postgres).

.PARAMETER NonInteractive
    Runs with defaults without prompting. Ideal for CI and autonomous AI agents.

.PARAMETER SkipLaunch
    Skip the launch prompt at the end of setup.
#>

[CmdletBinding()]
param(
    [ValidateSet('local', 'docker', 'all', '')]
    [string]$Mode = '',

    [ValidateSet('sqlite', 'postgres', '')]
    [string]$Database = '',

    [string]$DatabaseUrl = '',

    [switch]$NonInteractive,

    [switch]$SkipLaunch
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

function Prompt-Text {
    param(
        [string]$PromptText,
        [string]$DefaultValue = ''
    )
    if ($NonInteractive) {
        return $DefaultValue
    }

    $suffix = if (-not [string]::IsNullOrEmpty($DefaultValue)) { " [$DefaultValue]" } else { "" }
    Write-Host -NoNewline "$PromptText$($suffix): " -ForegroundColor Yellow
    $ans = Read-Host
    if ([string]::IsNullOrWhiteSpace($ans)) {
        return $DefaultValue
    }
    return $ans.Trim()
}

function Generate-SecureSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return -join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
}

# --- Main Script ---
Write-Header "Tether Monorepo - Setup Wizard"

# 1. Mode Selection
if ([string]::IsNullOrEmpty($Mode)) {
    $modeChoice = Prompt-Choice `
        -PromptText "Select execution environment:" `
        -Options @("Local Development (Node.js + pnpm) [Recommended]", "Docker Environment (Docker Compose)", "Full Setup (Local dependencies + Docker images)") `
        -DefaultIndex 1

    switch ($modeChoice) {
        "1" { $Mode = "local" }
        "2" { $Mode = "docker" }
        "3" { $Mode = "all" }
        default { $Mode = "local" }
    }
}
Write-Success "Execution mode selected: $Mode"

# 2. Database Selection
if ([string]::IsNullOrEmpty($Database)) {
    $dbChoice = Prompt-Choice `
        -PromptText "Select database configuration:" `
        -Options @("SQLite (Embedded via Node 22, zero external setup) [Recommended]", "PostgreSQL (Docker-managed or external connection)") `
        -DefaultIndex 1

    switch ($dbChoice) {
        "1" { $Database = "sqlite" }
        "2" { $Database = "postgres" }
        default { $Database = "sqlite" }
    }
}

if ($Database -eq "postgres" -and [string]::IsNullOrEmpty($DatabaseUrl)) {
    $pgSource = Prompt-Choice `
        -PromptText "Select PostgreSQL provider:" `
        -Options @("Docker Compose PostgreSQL (runs postgres:16-alpine on :5432)", "Custom / External PostgreSQL Connection String") `
        -DefaultIndex 1

    if ($pgSource -eq "1") {
        $DatabaseUrl = "postgres://postgres:postgres@localhost:5432/tether"
    } else {
        $DatabaseUrl = Prompt-Text -PromptText "Enter PostgreSQL connection string" -DefaultValue "postgres://postgres:postgres@localhost:5432/tether"
    }
}
Write-Success "Database selected: $Database"
if ($Database -eq "postgres") {
    Write-Success "PostgreSQL URL: $DatabaseUrl"
}

# 3. Environment File Configuration (.env)
Write-Step "Configuring environment (.env)..."
$envPath = Join-Path $PSScriptRoot ".env"
$envExamplePath = Join-Path $PSScriptRoot ".env.example"

if (-not (Test-Path $envExamplePath)) {
    Write-Err ".env.example template not found at $envExamplePath!"
    exit 1
}

$createNewEnv = $true
if (Test-Path $envPath) {
    if (-not $NonInteractive) {
        $keepEnv = Prompt-Text -PromptText "An existing .env file was detected. Keep existing values? (Y/n)" -DefaultValue "Y"
        if ($keepEnv -match '^[Yy]$') {
            $createNewEnv = $false
            Write-Success "Preserving existing .env file."
        }
    } else {
        $createNewEnv = $false
        Write-Success "Preserving existing .env file."
    }
}

if ($createNewEnv) {
    Copy-Item -Path $envExamplePath -Destination $envPath -Force
    Write-Success "Created .env from .env.example."
}

# Read and update .env contents
$envContent = Get-Content $envPath -Raw

# Ensure secure JWT_SECRET
if ($envContent -notmatch "JWT_SECRET=[a-zA-Z0-9_\-]{32,}" -or $envContent -match "JWT_SECRET=development_secret_must_be_at_least_32_chars_long!!") {
    $newSecret = Generate-SecureSecret
    $envContent = $envContent -replace "JWT_SECRET=.*", "JWT_SECRET=$newSecret"
    Write-Success "Generated secure 256-bit cryptographic JWT_SECRET."
}

# Update Database settings in .env
if ($Database -eq "sqlite") {
    $envContent = $envContent -replace "DATABASE_DRIVER=.*", "DATABASE_DRIVER=sqlite"
    $envContent = $envContent -replace "SQLITE_PATH=.*", "SQLITE_PATH=./data/tether.db"
} else {
    $envContent = $envContent -replace "DATABASE_DRIVER=.*", "DATABASE_DRIVER=postgres"
    if ($envContent -match "DATABASE_URL=.*") {
        $envContent = $envContent -replace "DATABASE_URL=.*", "DATABASE_URL=$DatabaseUrl"
    } else {
        $envContent += "`nDATABASE_URL=$DatabaseUrl"
    }
}

# Ensure PORT defaults
if ($envContent -match "PORT=3000" -and $envContent -match "NEXT_PUBLIC_API_URL=http://localhost:4000") {
    $envContent = $envContent -replace "PORT=3000", "PORT=4000"
}

[System.IO.File]::WriteAllText($envPath, $envContent, [System.Text.Encoding]::UTF8)
Write-Success ".env configuration saved successfully."

# Ensure data directory exists for SQLite
$dataDir = Join-Path $PSScriptRoot "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
    Write-Success "Created persistent data directory at ./data"
}

# 4. Dependency Checks
Write-Step "Checking prerequisites..."

# Node check
$nodeInstalled = $false
try {
    $nodeVer = & node -v 2>$null
    if ($LASTEXITCODE -eq 0 -and $nodeVer) {
        $nodeInstalled = $true
        Write-Success "Node.js detected: $nodeVer"
    }
} catch {}

if (-not $nodeInstalled -and ($Mode -eq "local" -or $Mode -eq "all")) {
    Write-Err "Node.js (>= 20) is required for local development but was not found on PATH."
    Write-Host "Please install Node.js from https://nodejs.org or via winget: winget install OpenJS.NodeJS.LTS"
    exit 1
}

# pnpm check
$pnpmInstalled = $false
try {
    $pnpmVer = & pnpm -v 2>$null
    if ($LASTEXITCODE -eq 0 -and $pnpmVer) {
        $pnpmInstalled = $true
        Write-Success "pnpm detected: v$pnpmVer"
    }
} catch {}

if (-not $pnpmInstalled -and ($Mode -eq "local" -or $Mode -eq "all")) {
    Write-Warn "pnpm is not installed. Attempting to enable via corepack..."
    try {
        & corepack enable
        & corepack prepare pnpm@latest --activate
        $pnpmVer = & pnpm -v 2>$null
        if ($LASTEXITCODE -eq 0) {
            $pnpmInstalled = $true
            Write-Success "pnpm enabled via corepack: v$pnpmVer"
        }
    } catch {}

    if (-not $pnpmInstalled) {
        Write-Warn "Corepack setup failed. Installing pnpm globally via npm..."
        & npm install -g pnpm
        $pnpmInstalled = $true
        Write-Success "pnpm installed globally."
    }
}

# Docker check
if ($Mode -eq "docker" -or $Mode -eq "all" -or ($Database -eq "postgres" -and $DatabaseUrl -match "localhost:5432")) {
    $dockerInstalled = $false
    try {
        $dockerVer = & docker --version 2>$null
        if ($LASTEXITCODE -eq 0) {
            $dockerInstalled = $true
            Write-Success "Docker detected: $dockerVer"
        }
    } catch {}

    if (-not $dockerInstalled) {
        Write-Warn "Docker is not detected on PATH. Containerized runs will not be available until Docker Desktop is installed."
    } else {
        # Check daemon
        & docker info 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "Docker CLI is present, but the Docker daemon does not appear to be running. Please start Docker Desktop."
        } else {
            Write-Success "Docker daemon is active and responsive."
        }
    }
}

# 5. Installation and Compilation
if ($Mode -eq "local" -or $Mode -eq "all") {
    Write-Step "Installing workspace dependencies via pnpm..."
    & pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "pnpm install failed."
        exit $LASTEXITCODE
    }
    Write-Success "Workspace dependencies installed."

    Write-Step "Compiling @tether/shared workspace package..."
    & pnpm --filter @tether/shared build:pkg
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to compile @tether/shared package."
        exit $LASTEXITCODE
    }
    Write-Success "@tether/shared compiled to dist/."
}

if ($Mode -eq "docker" -or $Mode -eq "all") {
    Write-Step "Building Docker Compose images..."
    & docker compose build
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker images built successfully."
    } else {
        Write-Warn "Docker build encountered an issue. You can rebuild later using 'docker compose build'."
    }
}

# 6. Completion & Auto-Launch Prompt
Write-Header "Setup Complete!"
Write-Host "Summary of Configuration:" -ForegroundColor Green
Write-Host "  - Mode:            $Mode"
Write-Host "  - Database:        $Database"
Write-Host "  - Backend Server:  http://localhost:4000 (WebSocket: ws://localhost:4000)"
Write-Host "  - Frontend Client: http://localhost:3001 (or :3000 in Docker)"
Write-Host "  - Environment:     .env"
Write-Host ""

if (-not $SkipLaunch) {
    $launchChoice = Prompt-Text -PromptText "Launch dev servers now? (Y/n)" -DefaultValue "Y"
    if ($launchChoice -match '^[Yy]$') {
        $launchScript = Join-Path $PSScriptRoot "launch.ps1"
        if (Test-Path $launchScript) {
            Write-Step "Launching Tether..."
            if ($Mode -eq "docker") {
                & $launchScript -Target docker
            } else {
                & $launchScript -Target both
            }
        } else {
            Write-Warn "launch.ps1 not found. Start manually with: pnpm dev"
        }
    } else {
        Write-Host "To launch later, run: .\launch.ps1 or pnpm dev" -ForegroundColor Cyan
    }
}
