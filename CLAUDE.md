# CLAUDE.md

This file provides project-specific context and commands for Anthropic Claude Code.

## Quick Reference Commands

### Setup & Launch
- **Non-interactive Setup (Windows)**: `powershell -ExecutionPolicy Bypass -File .\setup.ps1 -NonInteractive`
- **Non-interactive Setup (POSIX)**: `./setup.sh --non-interactive`
- **Interactive Setup**: `powershell -ExecutionPolicy Bypass -File .\setup.ps1` or `./setup.sh`
- **Run Both Servers (Dev)**: `pnpm dev` or `pnpm --filter @tether/server --filter @tether/web --parallel dev`
- **Run Backend Only**: `pnpm --filter @tether/server dev` (runs on http://localhost:4000)
- **Run Web Only**: `pnpm --filter @tether/web dev` (runs on http://localhost:3001)
- **Docker Compose**: `docker compose up -d` (or `docker compose --profile postgres up -d`)

### Verification & Testing
- **Run All Tests**: `pnpm test` (364 tests across 69 suites)
- **Database Migrations (SQLite)**: `pnpm db:migrate`
- **Typecheck**: `pnpm typecheck`
- **Lint**: `pnpm lint`
- **Chaos Tests**: `pnpm chaos:ci`
- **Latency Benchmarks**: `pnpm bench`
- **Build Packages**: `pnpm build:pkg` (builds `@tether/shared` and `@tether/sync-client` to `dist/`)

---

## Architecture Overview

Tether is a real-time collaborative code editor monorepo (`pnpm` workspaces):

- **`apps/server` (`@tether/server`)**:
  - Fastify 5 REST API + WebSocket server (`ws`).
  - Real-time CRDT synchronization via Yjs and lib0.
  - Session authorization with JWT tokens (HMAC SHA-256 via `jose`).
  - Storage: embedded SQLite via `node:sqlite` (`./data/tether.db`) or PostgreSQL (`DATABASE_URL`).
  - Listens on `PORT` (default: 4000). Health endpoints: `/health/live`, `/health/ready`.
- **`apps/web` (`@tether/web`)**:
  - Next.js 16 (React 19 App Router), Tailwind CSS v4, CodeMirror editor with language packs.
  - Runs on port 3001 (`next dev -p 3001`).
- **`packages/shared` (`@tether/shared`)**:
  - Shared types, Zod protocol schemas, token bucket rate limiter, backoff, and checksum utilities.
  - Must be built (`pnpm --filter @tether/shared build:pkg`) before other packages can consume it.
- **`packages/sync-client` (`@tether/sync-client`)**:
  - Client-side WebSocket sync abstraction for Yjs rooms.

---

## Configuration & Environment (`.env`)

Template: `.env.example`
- `PORT=4000`: Backend REST + WS port.
- `JWT_SECRET`: Minimum 32-character string.
- `ALLOWED_ORIGINS`: Comma-separated allowed origins for CORS and WebSocket upgrade gate.
- `DATABASE_DRIVER`: `sqlite` (default) or `postgres`.
- `SQLITE_PATH`: Path to SQLite database file (`./data/tether.db`).
- `DATABASE_URL`: PostgreSQL connection URL (e.g. `postgres://postgres:postgres@localhost:5432/tether`).
- `NEXT_PUBLIC_API_URL`: Web client backend target (`http://localhost:4000`).
- `NEXT_PUBLIC_WS_URL`: Web client WebSocket target (`ws://localhost:4000`).
- `TRUST_PROXY_HOPS`: Number of reverse proxy hops trusted for client IP (default: `0`).

---

## Development Constraints & Rules

1. **Never Commit Directly**: Code modifications only. Do not stage or execute `git commit`.
2. **Never Run Migrations Automatically**: Output migration SQL/files and explain changes to the human operator.
3. **Strict TypeScript**: No `any` — use `unknown` with type guards or define explicit interfaces.
4. **File Length**: No single file should exceed 700 lines; keep components and services modular.
5. **Shared Package Compilation**: When modifying `packages/shared` or `packages/sync-client`, always compile via `pnpm build:pkg` (or `pnpm --filter @tether/shared build:pkg && pnpm --filter @tether/sync-client build:pkg`).
