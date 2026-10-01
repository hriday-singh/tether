# Tether Monorepo: AI Agent Guide

This document is the authoritative guide for AI coding agents (Antigravity, Cursor, OpenAI Codex, GitHub Copilot) operating in this repository. Follow these conventions and commands when analyzing, setting up, building, testing, or launching the system.

---

## 1. System Architecture & Layout

This repository is a TypeScript monorepo managed with `pnpm` workspaces (`pnpm-workspace.yaml`).

| Path | Name | Description | Key Tech | Dev Port |
|------|------|-------------|----------|----------|
| `apps/server` | `@tether/server` | Real-time collaboration backend: Fastify REST API, WebSocket server, Yjs sync engine, session admission, room persistence | Fastify 5, ws, Yjs, lib0, node:sqlite / pg | `4000` |
| `apps/web` | `@tether/web` | Web client: collaborative code editor, terminal, room management | Next.js 16 (App Router), React 19, CodeMirror, Tailwind CSS v4 | `3001` |
| `packages/shared` | `@tether/shared` | Shared protocol codecs, Zod schemas, token bucket rate limiter, backoff, checksum utilities | TypeScript, Zod, lib0 | - |
| `packages/sync-client` | `@tether/sync-client` | Client-side sync engine communicating with server WebSocket | TypeScript, Yjs | - |
| `tests/chaos` | `@tether/chaos` | Automated network chaos, concurrency, and stress test suites | Vitest | - |

---

## 2. Quickstart Commands for Autonomous Agents

### Autonomous Setup (Non-Interactive)
To configure the environment, generate cryptographic secrets, install dependencies, and build shared packages without manual prompts:

**Windows PowerShell:**
```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1 -NonInteractive
```

**POSIX Shell (Linux / macOS / WSL / Git Bash):**
```bash
chmod +x ./setup.sh ./launch.sh
./setup.sh --non-interactive
```

**Manual Fallback Steps:**
```bash
# 1. Copy environment template if missing
cp .env.example .env

# 2. Ensure data directory exists for SQLite
mkdir -p data

# 3. Install dependencies
pnpm install

# 4. Build shared packages (required before web/server can compile)
pnpm build:pkg
```

---

## 3. Development Server Launch Commands

### Launch Both Servers Concurrently
```bash
# Using root script
pnpm dev

# Or directly via pnpm filter
pnpm --filter @tether/server --filter @tether/web --parallel dev
```

### Launch Individual Services
- **Backend API & WebSocket Server (`@tether/server`)**:
  ```bash
  pnpm --filter @tether/server dev
  ```
  Runs Fastify + WebSocket engine on `http://localhost:4000` (or `PORT` in `.env`).

- **Frontend Web Client (`@tether/web`)**:
  ```bash
  pnpm --filter @tether/web dev
  ```
  Runs Next.js development server on `http://localhost:3001`.

### Launch via Docker Compose
- **Standard (Server + Web + SQLite)**:
  ```bash
  docker compose up -d
  ```

---

## 4. Environment & Database Configuration

Environment configuration is read from `.env` in the repository root.

### Database:
- **SQLite only**: Embedded storage via Node 22 built-in `node:sqlite` in `./data/tether.db`. Zero external setup. Any `DATABASE_DRIVER` other than `sqlite` stops the server at boot (ADR-020). The repo layer is synchronous, so Postgres needs an async rewrite, not just an adapter.
  ```env
  DATABASE_DRIVER=sqlite
  SQLITE_PATH=./data/tether.db
  ```

### Critical Keys:
- `PORT`: Server port (default: `4000`)
- `JWT_SECRET`: Cryptographic secret string ($\ge 32$ characters)
- `ALLOWED_ORIGINS`: Comma-separated CORS origins (e.g. `http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001`)
- `NEXT_PUBLIC_API_URL`: Backend URL for Web client (default: `http://localhost:4000`)
- `NEXT_PUBLIC_WS_URL`: WebSocket URL for Web client (default: `ws://localhost:4000`)
- `TRUST_PROXY_HOPS`: Number of reverse proxy hops trusted for client IP resolution (default: `0`)

---

## 5. Testing & Verification Protocol

Always execute verification before claiming completion:

1. **Unit & Integration Tests (370+ tests across 70 suites)**:
   ```bash
   pnpm test
   ```
2. **Database Migrations (SQLite)**:
   ```bash
   pnpm db:migrate
   ```
3. **TypeScript Compilation & Typechecking**:
   ```bash
   pnpm typecheck
   ```
4. **Linting**:
   ```bash
   pnpm lint
   ```
5. **Chaos & Resilience Tests**:
   ```bash
   pnpm chaos:ci
   ```
6. **Latency Benchmarks**:
   ```bash
   pnpm bench
   ```
7. **Live Health Check Endpoints**:
   - Liveness: `GET http://localhost:4000/health/live`
   - Readiness: `GET http://localhost:4000/health/ready`

---

## 6. Development Rules for Agents

- **No Unsolicited Migrations**: Never auto-apply database migrations. Generate migration files and instruct the human operator.
- **Never Commit Directly**: Code modifications only; leave git staging and commits to the human operator.
- **File Length Limit**: Ensure modularization such that no single file exceeds 700 lines.
- **Dependency Awareness**: When modifying `@tether/shared` or `@tether/sync-client`, always re-run `pnpm build:pkg` (or `pnpm --filter @tether/shared build:pkg && pnpm --filter @tether/sync-client build:pkg`) so other packages resolve updated type definitions and exports.
