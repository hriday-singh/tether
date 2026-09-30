#!/usr/bin/env bash
# ==============================================================================
# Tether Monorepo — Server Launcher (POSIX Shell / Linux / macOS / WSL)
# ==============================================================================
# Orchestrates launching local development servers (@tether/server on :4000 and
# @tether/web on :3001) or containerized Docker Compose stacks.
# Supports quick-start by pressing Enter to launch both servers.
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

PNPM_CMD="pnpm"
if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD="pnpm"
elif command -v pnpm.cmd >/dev/null 2>&1; then
  PNPM_CMD="pnpm.cmd"
elif command -v pnpm.exe >/dev/null 2>&1; then
  PNPM_CMD="pnpm.exe"
fi

DOCKER_CMD="docker"
if command -v docker >/dev/null 2>&1; then
  DOCKER_CMD="docker"
elif command -v docker.exe >/dev/null 2>&1; then
  DOCKER_CMD="docker.exe"
fi

TARGET=""

for arg in "$@"; do
  case $arg in
    --target=*)
      TARGET="${arg#*=}"
      ;;
    local|both)
      TARGET="both"
      ;;
    server)
      TARGET="server"
      ;;
    web)
      TARGET="web"
      ;;
    docker)
      TARGET="docker"
      ;;
    docker-postgres|postgres)
      TARGET="docker-postgres"
      ;;
    --help|-h)
      echo "Usage: ./launch.sh [TARGET]"
      echo ""
      echo "Targets:"
      echo "  both | local       Start both local servers (default)"
      echo "  server             Start backend server only (:4000)"
      echo "  web                Start frontend web client only (:3001)"
      echo "  docker             Start Docker Compose stack"
      echo "  docker-postgres    Start Docker Compose stack with PostgreSQL"
      exit 0
      ;;
    *)
      TARGET="$arg"
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

write_header "Tether Monorepo — Server Launcher"

# 1. Environment Verification
if [ ! -f ".env" ]; then
  write_warn "No .env file found. Running setup.sh first..."
  if [ -f "./setup.sh" ]; then
    ./setup.sh --skip-launch
  else
    write_err "setup.sh not found! Please create .env from .env.example."
    exit 1
  fi
fi

# Detect configured ports
BACKEND_PORT="4000"
FRONTEND_PORT="3001"
if [ -f ".env" ]; then
  bp=$(grep -E "^PORT=[0-9]+" .env | head -n1 | cut -d'=' -f2 | tr -d '[:space:]' || true)
  if [ -n "$bp" ]; then BACKEND_PORT="$bp"; fi
  fp=$(grep -E "^WEB_PORT=[0-9]+" .env | head -n1 | cut -d'=' -f2 | tr -d '[:space:]' || true)
  if [ -n "$fp" ]; then FRONTEND_PORT="$fp"; fi
fi

# 2. Build Verification
if [ ! -f "packages/shared/dist/index.js" ]; then
  write_step "Compiling @tether/shared workspace package..."
  $PNPM_CMD --filter @tether/shared build:pkg
  write_ok "@tether/shared compiled."
fi

if [ ! -f "packages/sync-client/dist/index.js" ]; then
  write_step "Compiling @tether/sync-client workspace package..."
  $PNPM_CMD --filter @tether/sync-client build:pkg
  write_ok "@tether/sync-client compiled."
fi

# 3. Target Selection
if [ -z "$TARGET" ]; then
  choice=$(prompt_choice "Select what to launch:" 1 \
    "Local: Both Servers (Backend :${BACKEND_PORT} + Web :${FRONTEND_PORT}) [Recommended]" \
    "Local: Backend Server Only (Fastify + WS on :${BACKEND_PORT})" \
    "Local: Frontend Web Client Only (Next.js on :${FRONTEND_PORT})" \
    "Docker Compose: Web + Server" \
    "Docker Compose: Web + Server + PostgreSQL")

  case "$choice" in
    1) TARGET="both" ;;
    2) TARGET="server" ;;
    3) TARGET="web" ;;
    4) TARGET="docker" ;;
    5) TARGET="docker-postgres" ;;
    *) TARGET="both" ;;
  esac
fi

# 4. Check PostgreSQL if local mode
if [ "$TARGET" = "both" ] || [ "$TARGET" = "server" ]; then
  if grep -q "DATABASE_DRIVER=postgres" .env && grep -q "localhost:5432" .env; then
    pg_reachable=false
    if (echo > /dev/tcp/127.0.0.1/5432) >/dev/null 2>&1; then
      pg_reachable=true
    fi

    if [ "$pg_reachable" = false ]; then
      write_warn "PostgreSQL on localhost:5432 is not currently reachable."
      start_pg=$(prompt_choice "Start PostgreSQL container via Docker Compose now?" 1 \
        "Yes, start PostgreSQL in Docker [Default]" \
        "No, continue anyway")
      if [ "$start_pg" -eq 1 ]; then
        write_step "Starting PostgreSQL container..."
        $DOCKER_CMD compose --profile postgres up -d postgres
        sleep 3
      fi
    fi
  fi
fi

# 5. Execution
echo -e "\n${GREEN}============================================================${NC}"
echo -e "${GREEN}  Starting Tether [${TARGET}]${NC}"
echo -e "${GREEN}============================================================${NC}\n"

case "$TARGET" in
  both|local)
    echo -e "${CYAN}Endpoints:${NC}"
    echo -e "  * Web App:       http://localhost:${FRONTEND_PORT}"
    echo -e "  * Backend API:   http://localhost:${BACKEND_PORT}"
    echo -e "  * WebSocket:     ws://localhost:${BACKEND_PORT}"
    echo -e "  * Health Check:  http://localhost:${BACKEND_PORT}/health/ready"
    echo ""
    echo -e "${GRAY}Press Ctrl+C to stop both servers.${NC}\n"

    $PNPM_CMD --filter @tether/server --filter @tether/web --parallel dev
    ;;

  server)
    echo -e "${CYAN}Backend API & WebSocket Server${NC}"
    echo -e "  * URL:    http://localhost:${BACKEND_PORT}"
    echo -e "  * WS:     ws://localhost:${BACKEND_PORT}"
    echo -e "  * Health: http://localhost:${BACKEND_PORT}/health/ready"
    echo ""
    $PNPM_CMD --filter @tether/server dev
    ;;

  web)
    echo -e "${GREEN}Frontend Web Client (Next.js)${NC}"
    echo -e "  * URL: http://localhost:${FRONTEND_PORT}"
    echo ""
    $PNPM_CMD --filter @tether/web dev
    ;;

  docker)
    write_step "Launching Docker Compose (Server + Web)..."
    echo -e "  * Web App:     http://localhost:3000"
    echo -e "  * Backend API: http://localhost:4000"
    echo ""
    $DOCKER_CMD compose up
    ;;

  docker-postgres)
    write_step "Launching Docker Compose with PostgreSQL..."
    echo -e "  * Web App:     http://localhost:3000"
    echo -e "  * Backend API: http://localhost:4000"
    echo -e "  * PostgreSQL:  localhost:5432"
    echo ""
    $DOCKER_CMD compose --profile postgres up
    ;;

  *)
    write_err "Unknown target: $TARGET"
    exit 1
    ;;
esac
