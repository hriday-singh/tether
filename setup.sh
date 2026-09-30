#!/usr/bin/env bash
# ==============================================================================
# Tether Monorepo — Setup Wizard (POSIX Shell / Linux / macOS / WSL)
# ==============================================================================
# Interactive setup script to configure environment variables (.env), database
# drivers (SQLite / PostgreSQL), generate cryptographic secrets, install dependencies,
# and build shared workspace packages.
# Quick start: press Enter on every prompt to accept all recommended defaults.
# ==============================================================================

set -euo pipefail

# Text formatting
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

write_header() {
  echo -e "\n${CYAN}============================================================${NC}"
  echo -e "${CYAN}  $1${NC}"
  echo -e "${CYAN}============================================================${NC}\n"
}

write_step() {
  echo -e "${BLUE}--> $1${NC}"
}

write_ok() {
  echo -e "${GREEN}[OK] $1${NC}"
}

write_warn() {
  echo -e "${YELLOW}[WARN] $1${NC}"
}

write_err() {
  echo -e "${RED}[ERROR] $1${NC}" >&2
}

# CLI Flags
MODE=""
DATABASE=""
DATABASE_URL=""
BACKEND_PORT=""
FRONTEND_PORT=""
NON_INTERACTIVE=false
SKIP_LAUNCH=false

for arg in "$@"; do
  case $arg in
    --mode=*)
      MODE="${arg#*=}"
      ;;
    --database=*)
      DATABASE="${arg#*=}"
      ;;
    --database-url=*)
      DATABASE_URL="${arg#*=}"
      ;;
    --backend-port=*|--port=*)
      BACKEND_PORT="${arg#*=}"
      ;;
    --frontend-port=*|--web-port=*)
      FRONTEND_PORT="${arg#*=}"
      ;;
    --non-interactive)
      NON_INTERACTIVE=true
      ;;
    --skip-launch)
      SKIP_LAUNCH=true
      ;;
    --help|-h)
      echo "Usage: ./setup.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --mode=local|docker|all      Setup environment (default: local)"
      echo "  --database=sqlite|postgres   Database driver (default: sqlite)"
      echo "  --database-url=URL           Postgres connection string"
      echo "  --backend-port=PORT          Backend API port (default: 4000)"
      echo "  --frontend-port=PORT         Frontend web client port (default: 3001)"
      echo "  --non-interactive            Run silently with defaults"
      echo "  --skip-launch                Do not prompt to launch after setup"
      exit 0
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

prompt_choice() {
  local prompt_text="$1"
  shift
  local default_idx="$1"
  shift
  local options=("$@")

  if [ "$NON_INTERACTIVE" = true ]; then
    echo "$default_idx"
    return 0
  fi

  echo -e "\n${prompt_text}" >&2
  local idx=1
  for opt in "${options[@]}"; do
    local suffix=""
    if [ "$idx" -eq "$default_idx" ]; then
      suffix=" ${GRAY}[Default: Press Enter]${NC}"
    fi
    echo -e "  [${idx}] ${opt}${suffix}" >&2
    idx=$((idx + 1))
  done

  local ans=""
  read -r -p "Select option (1-${#options[@]}) [${default_idx}]: " ans
  ans=$(echo "$ans" | tr -d '[:space:]')
  if [ -z "$ans" ]; then
    echo "$default_idx"
  else
    echo "$ans"
  fi
}

prompt_text() {
  local prompt_msg="$1"
  local default_val="$2"

  if [ "$NON_INTERACTIVE" = true ]; then
    echo "$default_val"
    return 0
  fi

  local prompt_suffix=""
  if [ -n "$default_val" ]; then
    prompt_suffix=" [${default_val}]"
  fi

  read -r -p "$(echo -e "${YELLOW}${prompt_msg}${prompt_suffix}: ${NC}")" ans
  if [ -z "$ans" ]; then
    echo "$default_val"
  else
    echo "$ans"
  fi
}

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else
    head -c 32 /dev/urandom | xxd -p -c 32 2>/dev/null || od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
  fi
}

# --- Main Flow ---
write_header "Tether Monorepo — Setup Wizard"

# 1. Mode Selection
if [ -z "$MODE" ]; then
  choice=$(prompt_choice "Select execution environment:" 1 \
    "Local Development (Node.js + pnpm) [Recommended]" \
    "Docker Environment (Docker Compose)" \
    "Full Setup (Local dependencies + Docker images)")
  case "$choice" in
    1) MODE="local" ;;
    2) MODE="docker" ;;
    3) MODE="all" ;;
    *) MODE="local" ;;
  esac
fi
write_ok "Execution mode selected: $MODE"

# 2. Database Selection
if [ -z "$DATABASE" ]; then
  db_choice=$(prompt_choice "Select database configuration:" 1 \
    "SQLite (Embedded via Node 22, zero external setup) [Recommended]" \
    "PostgreSQL (Docker-managed or external connection)")
  case "$db_choice" in
    1) DATABASE="sqlite" ;;
    2) DATABASE="postgres" ;;
    *) DATABASE="sqlite" ;;
  esac
fi

if [ "$DATABASE" = "postgres" ] && [ -z "$DATABASE_URL" ]; then
  pg_choice=$(prompt_choice "Select PostgreSQL provider:" 1 \
    "Docker Compose PostgreSQL (runs postgres:16-alpine on :5432)" \
    "Custom / External PostgreSQL Connection String")
  if [ "$pg_choice" -eq 1 ]; then
    DATABASE_URL="postgres://postgres:postgres@localhost:5432/tether"
  else
    DATABASE_URL=$(prompt_text "Enter PostgreSQL connection string" "postgres://postgres:postgres@localhost:5432/tether")
  fi
fi

write_ok "Database selected: $DATABASE"
if [ "$DATABASE" = "postgres" ]; then
  write_ok "PostgreSQL URL: $DATABASE_URL"
fi

# 3. Port Configuration
if [ -z "$BACKEND_PORT" ]; then
  def_bp="4000"
  if [ -f ".env" ] && grep -qE "^PORT=[0-9]+" .env; then
    def_bp=$(grep -E "^PORT=[0-9]+" .env | head -n1 | cut -d'=' -f2 | tr -d '[:space:]')
  fi
  BACKEND_PORT=$(prompt_text "Enter backend server port" "$def_bp")
fi
if ! [[ "$BACKEND_PORT" =~ ^[0-9]+$ ]]; then
  write_warn "Invalid backend port '$BACKEND_PORT'. Falling back to 4000."
  BACKEND_PORT="4000"
fi
write_ok "Backend port selected: $BACKEND_PORT"

if [ -z "$FRONTEND_PORT" ]; then
  def_fp="3001"
  if [ -f ".env" ] && grep -qE "^WEB_PORT=[0-9]+" .env; then
    def_fp=$(grep -E "^WEB_PORT=[0-9]+" .env | head -n1 | cut -d'=' -f2 | tr -d '[:space:]')
  fi
  FRONTEND_PORT=$(prompt_text "Enter frontend web client port" "$def_fp")
fi
if ! [[ "$FRONTEND_PORT" =~ ^[0-9]+$ ]]; then
  write_warn "Invalid frontend port '$FRONTEND_PORT'. Falling back to 3001."
  FRONTEND_PORT="3001"
fi
write_ok "Frontend port selected: $FRONTEND_PORT"

# 3b. Allowed Origins Configuration
# Build deduplicated base origins list
declare -a BASE_ORIGINS=("http://localhost:3000" "http://127.0.0.1:3000" "http://localhost:${FRONTEND_PORT}" "http://127.0.0.1:${FRONTEND_PORT}")
# Deduplicate (in case FRONTEND_PORT is 3000)
declare -a UNIQUE_ORIGINS=()
for o in "${BASE_ORIGINS[@]}"; do
  local_dup=false
  for u in "${UNIQUE_ORIGINS[@]+"${UNIQUE_ORIGINS[@]}"}"; do
    if [ "$o" = "$u" ]; then local_dup=true; break; fi
  done
  if [ "$local_dup" = false ]; then UNIQUE_ORIGINS+=("$o"); fi
done
BASE_ORIGINS=("${UNIQUE_ORIGINS[@]}")
DEFAULT_ORIGINS_DISPLAY=$(IFS=', '; echo "${BASE_ORIGINS[*]}")

if [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  echo -e "${GRAY}The following origins will be allowed for backend CORS by default:${NC}"
  echo -e "${GRAY}  ${DEFAULT_ORIGINS_DISPLAY}${NC}"
fi
EXTRA_BACKEND_ORIGINS=$(prompt_text "Additional backend CORS origins (comma-separated, or Enter to skip)" "")
write_ok "Backend CORS origins configured."

if [ "$NON_INTERACTIVE" = false ]; then
  echo ""
  echo -e "${GRAY}Next.js allows localhost / 127.0.0.1 by default for dev HMR.${NC}"
fi
EXTRA_FRONTEND_ORIGINS=$(prompt_text "Additional frontend dev hostnames (comma-separated, e.g. 192.168.1.5, or Enter to skip)" "")
write_ok "Frontend dev origins configured."

# 4. Environment Configuration (.env)
write_step "Configuring environment (.env)..."
if [ ! -f ".env.example" ]; then
  write_err ".env.example template not found!"
  exit 1
fi

create_env=true
if [ -f ".env" ]; then
  if [ "$NON_INTERACTIVE" = false ]; then
    keep_env=$(prompt_text "An existing .env file was detected. Keep existing values? (Y/n)" "Y")
    if [[ "$keep_env" =~ ^[Yy]$ ]]; then
      create_env=false
      write_ok "Preserving existing .env file."
    fi
  else
    create_env=false
    write_ok "Preserving existing .env file."
  fi
fi

if [ "$create_env" = true ]; then
  cp .env.example .env
  write_ok "Created .env from .env.example."
fi

# Update JWT_SECRET if empty or default
if grep -q "JWT_SECRET=development_secret_must_be_at_least_32_chars_long!!" .env || ! grep -qE "JWT_SECRET=[a-zA-Z0-9_\-]{32,}" .env; then
  new_secret=$(generate_secret)
  # Portable in-place replacement for sed
  sed -i.bak -e "s|^JWT_SECRET=.*|JWT_SECRET=${new_secret}|" .env && rm -f .env.bak
  write_ok "Generated secure 256-bit cryptographic JWT_SECRET."
fi

# Update Database settings in .env
if [ "$DATABASE" = "sqlite" ]; then
  sed -i.bak -e "s|^DATABASE_DRIVER=.*|DATABASE_DRIVER=sqlite|" .env && rm -f .env.bak
  sed -i.bak -e "s|^SQLITE_PATH=.*|SQLITE_PATH=./data/tether.db|" .env && rm -f .env.bak
else
  sed -i.bak -e "s|^DATABASE_DRIVER=.*|DATABASE_DRIVER=postgres|" .env && rm -f .env.bak
  if grep -q "^DATABASE_URL=" .env; then
    sed -i.bak -e "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" .env && rm -f .env.bak
  else
    echo "DATABASE_URL=${DATABASE_URL}" >> .env
  fi
fi

# Update Ports in .env
sed -i.bak -e "s|^PORT=.*|PORT=${BACKEND_PORT}|" .env && rm -f .env.bak
sed -i.bak -e "s|^SERVER_PORT=.*|SERVER_PORT=${BACKEND_PORT}|" .env && rm -f .env.bak
if grep -q "^WEB_PORT=" .env; then
  sed -i.bak -e "s|^WEB_PORT=.*|WEB_PORT=${FRONTEND_PORT}|" .env && rm -f .env.bak
else
  echo "WEB_PORT=${FRONTEND_PORT}" >> .env
fi
sed -i.bak -e "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=http://localhost:${BACKEND_PORT}|" .env && rm -f .env.bak
sed -i.bak -e "s|^NEXT_PUBLIC_WS_URL=.*|NEXT_PUBLIC_WS_URL=ws://localhost:${BACKEND_PORT}|" .env && rm -f .env.bak

# Update ALLOWED_ORIGINS with base origins + any user-supplied extras
FINAL_ORIGINS=$(IFS=','; echo "${BASE_ORIGINS[*]}")
if [ -n "$EXTRA_BACKEND_ORIGINS" ]; then
  FINAL_ORIGINS="${FINAL_ORIGINS},${EXTRA_BACKEND_ORIGINS}"
fi
sed -i.bak -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${FINAL_ORIGINS}|" .env && rm -f .env.bak

# Derive ALLOWED_DEV_ORIGINS from ALLOWED_ORIGINS + any user-supplied frontend extras
dev_hosts=""
IFS=',' read -ra parts <<< "$FINAL_ORIGINS"
for origin in "${parts[@]}"; do
  host=$(echo "$origin" | sed -e 's|^https\?://||' -e 's|:[0-9]*$||' -e 's|^[[:space:]]*||' -e 's|[[:space:]]*$||')
  if [ -n "$host" ] && [ "$host" != "localhost" ] && [ "$host" != "127.0.0.1" ]; then
    if [ -n "$dev_hosts" ]; then
      dev_hosts="${dev_hosts},${host}"
    else
      dev_hosts="$host"
    fi
  fi
done
# Append any extra frontend-specific hostnames
if [ -n "$EXTRA_FRONTEND_ORIGINS" ]; then
  IFS=',' read -ra fe_parts <<< "$EXTRA_FRONTEND_ORIGINS"
  for h in "${fe_parts[@]}"; do
    trimmed=$(echo "$h" | sed -e 's|^[[:space:]]*||' -e 's|[[:space:]]*$||')
    if [ -n "$trimmed" ] && [ "$trimmed" != "localhost" ] && [ "$trimmed" != "127.0.0.1" ]; then
      if [ -n "$dev_hosts" ]; then
        dev_hosts="${dev_hosts},${trimmed}"
      else
        dev_hosts="$trimmed"
      fi
    fi
  done
fi
if grep -q "^ALLOWED_DEV_ORIGINS=" .env; then
  sed -i.bak -e "s|^ALLOWED_DEV_ORIGINS=.*|ALLOWED_DEV_ORIGINS=${dev_hosts}|" .env && rm -f .env.bak
else
  echo "ALLOWED_DEV_ORIGINS=${dev_hosts}" >> .env
fi
write_ok ".env configuration saved successfully."

# Ensure data directory exists for SQLite
mkdir -p data
write_ok "Persistent data directory ready at ./data"

# Make helper scripts executable
chmod +x setup.sh launch.sh 2>/dev/null || true

# 4. Prerequisites Verification
write_step "Checking prerequisites..."

NODE_CMD=""
if command -v node >/dev/null 2>&1; then
  NODE_CMD="node"
elif command -v node.exe >/dev/null 2>&1; then
  NODE_CMD="node.exe"
fi

if [ -n "$NODE_CMD" ]; then
  node_ver=$($NODE_CMD -v)
  write_ok "Node.js detected: ${node_ver}"
elif [ "$MODE" = "local" ] || [ "$MODE" = "all" ]; then
  write_err "Node.js (>= 20) is required for local development but was not found."
  exit 1
fi

PNPM_CMD=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD="pnpm"
elif command -v pnpm.cmd >/dev/null 2>&1; then
  PNPM_CMD="pnpm.cmd"
elif command -v pnpm.exe >/dev/null 2>&1; then
  PNPM_CMD="pnpm.exe"
fi

if [ -n "$PNPM_CMD" ]; then
  pnpm_ver=$($PNPM_CMD -v)
  write_ok "pnpm detected: v${pnpm_ver}"
elif [ "$MODE" = "local" ] || [ "$MODE" = "all" ]; then
  write_warn "pnpm is not installed. Attempting to activate via corepack..."
  if command -v corepack >/dev/null 2>&1 || command -v corepack.cmd >/dev/null 2>&1; then
    corepack enable || true
    corepack prepare pnpm@latest --activate || true
    if command -v pnpm >/dev/null 2>&1; then
      PNPM_CMD="pnpm"
      write_ok "pnpm activated via corepack: $(pnpm -v)"
    elif command -v pnpm.cmd >/dev/null 2>&1; then
      PNPM_CMD="pnpm.cmd"
      write_ok "pnpm activated via corepack: $(pnpm.cmd -v)"
    fi
  fi

  if [ -z "$PNPM_CMD" ]; then
    write_warn "Corepack activation failed. Installing pnpm globally via npm..."
    npm install -g pnpm || npm.cmd install -g pnpm || true
    if command -v pnpm >/dev/null 2>&1; then
      PNPM_CMD="pnpm"
    elif command -v pnpm.cmd >/dev/null 2>&1; then
      PNPM_CMD="pnpm.cmd"
    fi
    if [ -n "$PNPM_CMD" ]; then
      write_ok "pnpm installed globally."
    else
      write_err "Could not install pnpm automatically. Please install pnpm."
      exit 1
    fi
  fi
fi

DOCKER_CMD=""
if command -v docker >/dev/null 2>&1; then
  DOCKER_CMD="docker"
elif command -v docker.exe >/dev/null 2>&1; then
  DOCKER_CMD="docker.exe"
fi

if [ "$MODE" = "docker" ] || [ "$MODE" = "all" ] || { [ "$DATABASE" = "postgres" ] && [[ "$DATABASE_URL" == *"localhost:5432"* ]]; }; then
  if [ -n "$DOCKER_CMD" ]; then
    write_ok "Docker detected: $($DOCKER_CMD --version)"
    if $DOCKER_CMD info >/dev/null 2>&1; then
      write_ok "Docker daemon is active and responsive."
    else
      write_warn "Docker CLI is present, but daemon is not running. Please start Docker."
    fi
  else
    write_warn "Docker is not detected on PATH."
  fi
fi

# 5. Dependency Installation & Shared Package Compilation
if [ "$MODE" = "local" ] || [ "$MODE" = "all" ]; then
  write_step "Installing workspace dependencies via pnpm..."
  $PNPM_CMD install
  write_ok "Workspace dependencies installed."

  write_step "Compiling @tether/shared workspace package..."
  $PNPM_CMD --filter @tether/shared build:pkg
  write_ok "@tether/shared compiled to dist/."

  write_step "Compiling @tether/sync-client workspace package..."
  $PNPM_CMD --filter @tether/sync-client build:pkg
  write_ok "@tether/sync-client compiled to dist/."
fi

if [ "$MODE" = "docker" ] || [ "$MODE" = "all" ]; then
  write_step "Building Docker Compose images..."
  if [ -n "$DOCKER_CMD" ] && $DOCKER_CMD compose build; then
    write_ok "Docker images built successfully."
  else
    write_warn "Docker build encountered an issue. You can rebuild later using 'docker compose build'."
  fi
fi

# 6. Completion & Auto-Launch Prompt
write_header "Setup Complete!"
echo -e "${GREEN}Configuration Summary:${NC}"
echo -e "  - Mode:            ${MODE}"
echo -e "  - Database:        ${DATABASE}"
echo -e "  - Backend Server:  http://localhost:${BACKEND_PORT} (WebSocket: ws://localhost:${BACKEND_PORT})"
echo -e "  - Frontend Client: http://localhost:${FRONTEND_PORT} (or :3000 in Docker)"
echo -e "  - Environment:     .env"
echo ""

if [ "$SKIP_LAUNCH" = false ]; then
  launch_choice=$(prompt_text "Launch dev servers now? (Y/n)" "Y")
  if [[ "$launch_choice" =~ ^[Yy]$ ]]; then
    if [ -f "./launch.sh" ]; then
      write_step "Launching Tether..."
      if [ "$MODE" = "docker" ]; then
        ./launch.sh docker
      else
        ./launch.sh local
      fi
    else
      write_warn "launch.sh not found. Start manually with: pnpm dev"
    fi
  else
    echo -e "${CYAN}To launch later, run: ./launch.sh or pnpm dev${NC}"
  fi
fi
