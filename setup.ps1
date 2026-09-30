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

.PARAMETER BackendUrl
    Public backend URL the browser calls (default: http://localhost:<BackendPort>). WebSocket URL is derived (http->ws, https->wss).

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

    [string]$BackendPort = '',

    [string]$FrontendPort = '',

    [string]$Port = '',

    [string]$WebPort = '',

    [string]$BackendUrl = '',

    [switch]$NonInteractive,

    [switch]$SkipLaunch
)

if ([string]::IsNullOrEmpty($BackendPort) -and -not [string]::IsNullOrEmpty($Port)) {
    $BackendPort = $Port
}
if ([string]::IsNullOrEmpty($FrontendPort) -and -not [string]::IsNullOrEmpty($WebPort)) {
    $FrontendPort = $WebPort
}

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

# 3. Port Configuration
if ([string]::IsNullOrEmpty($BackendPort)) {
    $defaultBp = "4000"
    $envPathProbe = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPathProbe) {
        $pMatch = Get-Content $envPathProbe | Select-String -Pattern "^PORT=(\d+)" | Select-Object -First 1
        if ($pMatch) { $defaultBp = $pMatch.Matches.Groups[1].Value }
    }
    $BackendPort = Prompt-Text -PromptText "Enter backend server port" -DefaultValue $defaultBp
}
if ($BackendPort -notmatch '^\d+$') {
    Write-Warn "Invalid backend port '$BackendPort'. Falling back to 4000."
    $BackendPort = "4000"
}
Write-Success "Backend port selected: $BackendPort"

if ([string]::IsNullOrEmpty($FrontendPort)) {
    $defaultFp = "3001"
    $envPathProbe = Join-Path $PSScriptRoot ".env"
    if (Test-Path $envPathProbe) {
        $wpMatch = Get-Content $envPathProbe | Select-String -Pattern "^WEB_PORT=(\d+)" | Select-Object -First 1
        if ($wpMatch) { $defaultFp = $wpMatch.Matches.Groups[1].Value }
    }
    $FrontendPort = Prompt-Text -PromptText "Enter frontend web client port" -DefaultValue $defaultFp
}
if ($FrontendPort -notmatch '^\d+$') {
    Write-Warn "Invalid frontend port '$FrontendPort'. Falling back to 3001."
    $FrontendPort = "3001"
}
Write-Success "Frontend port selected: $FrontendPort"

# Public backend URL the browser calls (e.g. https://api.example.com behind a reverse proxy)
if ([string]::IsNullOrEmpty($BackendUrl)) {
    $BackendUrl = Prompt-Text -PromptText "Public backend URL (browser-facing)" -DefaultValue "http://localhost:$BackendPort"
}
$BackendUrl = $BackendUrl.TrimEnd('/')
if ($BackendUrl -notmatch '^https?://') {
    Write-Warn "Invalid backend URL '$BackendUrl'. Falling back to http://localhost:$BackendPort."
    $BackendUrl = "http://localhost:$BackendPort"
}
$BackendWsUrl = $BackendUrl -replace '^http', 'ws'
Write-Success "Backend URL selected: $BackendUrl (WebSocket: $BackendWsUrl)"

# 3b. Allowed Origins Configuration
$baseOrigins = @("http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:$FrontendPort", "http://127.0.0.1:$FrontendPort")
$baseOrigins = $baseOrigins | Select-Object -Unique
$defaultOriginsDisplay = $baseOrigins -join ', '

if (-not $NonInteractive) {
    Write-Host ""
    Write-Host "The following origins will be allowed for backend CORS by default:" -ForegroundColor Gray
    Write-Host "  $defaultOriginsDisplay" -ForegroundColor Gray
}
$ExtraBackendOrigins = Prompt-Text -PromptText "Additional backend CORS origins (comma-separated, or Enter to skip)" -DefaultValue ""
Write-Success "Backend CORS origins configured."

if (-not $NonInteractive) {
    Write-Host ""
    Write-Host "Next.js allows localhost / 127.0.0.1 by default for dev HMR." -ForegroundColor Gray
}
$ExtraFrontendOrigins = Prompt-Text -PromptText "Additional frontend dev hostnames (comma-separated, e.g. 192.168.1.5, or Enter to skip)" -DefaultValue ""
Write-Success "Frontend dev origins configured."

# 4. Environment File Configuration (.env)
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

# Update Ports in .env
$envContent = $envContent -replace "(?m)^PORT=.*", "PORT=$BackendPort"
$envContent = $envContent -replace "(?m)^SERVER_PORT=.*", "SERVER_PORT=$BackendPort"
if ($envContent -match "(?m)^WEB_PORT=") {
    $envContent = $envContent -replace "(?m)^WEB_PORT=.*", "WEB_PORT=$FrontendPort"
} else {
    $envContent += "`nWEB_PORT=$FrontendPort"
}
$envContent = $envContent -replace "(?m)^NEXT_PUBLIC_API_URL=.*", "NEXT_PUBLIC_API_URL=$BackendUrl"
$envContent = $envContent -replace "(?m)^NEXT_PUBLIC_WS_URL=.*", "NEXT_PUBLIC_WS_URL=$BackendWsUrl"

# Update ALLOWED_ORIGINS with base origins + any user-supplied extras
$finalOrigins = ($baseOrigins -join ',')
if (-not [string]::IsNullOrWhiteSpace($ExtraBackendOrigins)) {
    $finalOrigins = "$finalOrigins,$ExtraBackendOrigins"
}
$envContent = $envContent -replace "(?m)^ALLOWED_ORIGINS=.*", "ALLOWED_ORIGINS=$finalOrigins"

# Derive ALLOWED_DEV_ORIGINS from ALLOWED_ORIGINS + any user-supplied frontend extras
$devHosts = @()
foreach ($origin in ($finalOrigins -split ",")) {
    $h = $origin.Trim() -replace '^https?://','' -replace ':[0-9]+$',''
    if ($h -and $h -ne "localhost" -and $h -ne "127.0.0.1") {
        $devHosts += $h
    }
}
if (-not [string]::IsNullOrWhiteSpace($ExtraFrontendOrigins)) {
    foreach ($h in ($ExtraFrontendOrigins -split ",")) {
        $trimmed = $h.Trim()
        if ($trimmed -and $trimmed -ne "localhost" -and $trimmed -ne "127.0.0.1") {
            $devHosts += $trimmed
        }
    }
}
$devHosts = $devHosts | Select-Object -Unique
$devOriginsValue = $devHosts -join ","
if ($envContent -match "(?m)^ALLOWED_DEV_ORIGINS=") {
    $envContent = $envContent -replace "(?m)^ALLOWED_DEV_ORIGINS=.*", "ALLOWED_DEV_ORIGINS=$devOriginsValue"
} else {
    $envContent += "`nALLOWED_DEV_ORIGINS=$devOriginsValue"
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

    Write-Step "Compiling @tether/sync-client workspace package..."
    & pnpm --filter @tether/sync-client build:pkg
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to compile @tether/sync-client package."
        exit $LASTEXITCODE
    }
    Write-Success "@tether/sync-client compiled to dist/."
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
Write-Host "  - Backend Server:  http://localhost:$BackendPort (WebSocket: ws://localhost:$BackendPort)"
Write-Host "  - Frontend Client: http://localhost:$FrontendPort (or :3000 in Docker)"
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
