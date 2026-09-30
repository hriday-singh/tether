# Tether

> **A real-time collaborative code editor that never loses a keystroke.**  
> Powered by Yjs CRDTs, a custom Fastify WebSocket sync engine, CodeMirror 6, and Next.js 16. Proven with automated chaos network fault tests.

---

## Overview

Tether is a modern, real-time collaborative workspace designed for zero document divergence. Every peer converges on byte-identical documents regardless of abrupt disconnects, packet loss, or aggressive message throttling.

- **Zero-Loss CRDT Sync**: Real-time collaboration using pinned Yjs v13 with custom WebSocket protocols and token-bucket throttled updates.
- **Measured Latency**: Keystroke-to-peer latency is continuously measured and displayed live in the UI (p50 / p95 metrics).
- **Chaos Resilience Tested**: 275+ automated unit, property-based, and chaos tests across 60 test suites simulating split-brain network partitions, duplicated frames, and client reconnect storms.
- **Real-Time Text Chat**: Room text chat with gapless per-room sequence ordering, optimistic updates, unread indicators, and SQLite / PostgreSQL persistence.
- **Bot Storm Spawner**: Host-triggered demo storm spawner running virtual bot clients under simulated network faults with clean pre-storm state rollback via `Y.UndoManager`.
- **"Quiet IDE" Aesthetic**: Minimalist, distraction-free interface built with Next.js 16, Tailwind CSS v4, Radix UI primitives, semantic themes, and smooth SVG/text morphing.
- **Sandboxed Execution**: Client-side sandboxed iframe preview with a 5-second watchdog Web Worker runner for safe JavaScript, HTML, and Python execution.
- **Flexible Storage**: Zero-dependency embedded SQLite via Node 22 (`node:sqlite`) for local development, with first-class PostgreSQL support for production scale.

---

## System Architecture

```
                       ┌─────────────────────────────────────────┐
                       │               Web Browser               │
                       │   Next.js 16 Client (http://:3001)      │
                       └─────────────┬─────────────┬─────────────┘
                                     │             │
                             HTTP API│             │WebSocket Sync
                          (Port 4000)│             │(Port 4000)
                                     ▼             ▼
                       ┌─────────────────────────────────────────┐
                       │          @tether/server (:4000)         │
                       │   Fastify 5 REST + WebSocket Engine     │
                       │   Yjs CRDT Sync + Host Election         │
                       └─────────────┬─────────────┬─────────────┘
                                     │             │
                    DATABASE_DRIVER  ▼             ▼  DATABASE_DRIVER
                       = sqlite      │             │   = postgres
                       ┌─────────────┴──┐       ┌──┴─────────────┐
                       │ Embedded SQLite│       │   PostgreSQL   │
                       │ ./data/tether.db       │ localhost:5432 │
                       └────────────────┘       └────────────────┘
```

### Workspace Packages

| Path | Package | Description | Key Tech | Dev Port |
|------|---------|-------------|----------|----------|
| `apps/server` | `@tether/server` | REST API, WebSocket server, Yjs sync engine, session admission, room persistence | Fastify 5, ws, Yjs, lib0, node:sqlite / pg | `4000` |
| `apps/web` | `@tether/web` | Collaborative code editor, terminal console, room management, theme picker | Next.js 16, React 19, CodeMirror 6, Tailwind CSS v4 | `3001` |
| `packages/shared` | `@tether/shared` | Protocol codecs, Zod schemas, token bucket rate limiter, backoff, checksum | TypeScript, Zod, lib0 | — |
| `packages/sync-client` | `@tether/sync-client` | Client-side WebSocket sync driver for browser & workers | TypeScript, Yjs | — |
| `tests/chaos` | `@tether/chaos` | Automated network chaos, convergence, and invariant stress testing | Vitest, fast-check | — |

---

## Quickstart (Under 1 Minute)

Setup and launch wizards are provided for both Windows PowerShell and POSIX shells (Linux, macOS, WSL, Git Bash).

### 1. Run Setup Wizard
The setup script configures your environment, creates `.env` with a secure 256-bit cryptographic `JWT_SECRET`, installs workspace dependencies, compiles shared packages, and initializes the `./data` directory.

**Windows PowerShell:**
```powershell
.\setup.ps1
```

**POSIX (Linux / macOS / WSL / Git Bash):**
```bash
# Ensure execution permissions on Linux/macOS
chmod +x ./setup.sh ./launch.sh

# Run interactive setup wizard
./setup.sh
```

> [!NOTE]
> **Linux / macOS Permission Notice:**
> If you encounter `Permission denied` when trying to execute `./setup.sh`:
> ```text
> crane1@thecrane:/srv/dev/web-apps/tether$ ./setup.sh
> -bash: ./setup.sh: Permission denied
> crane1@thecrane:/srv/dev/web-apps/tether$ chmod +x ./setup.sh ./launch.sh
> crane1@thecrane:/srv/dev/web-apps/tether$ ./setup.sh
> ```
> Both `setup.sh` and `launch.sh` require executable bit permissions (`chmod +x`).

> **Quick-Start Tip:** Every prompt has a recommended default. You can simply press **`Enter`** throughout the prompts to configure local development with zero-setup SQLite and automatically launch the servers!

#### Setup Options:
1. **Execution Environment**:
   - `[1] Local Development (Node.js + pnpm)` *(Default)*
   - `[2] Docker Environment (Docker Compose)`
   - `[3] Full Setup (Local + Docker)`
2. **Database Configuration**:
   - `[1] SQLite` *(Default, embedded in Node 22, zero external setup)*
   - `[2] PostgreSQL` *(Docker-managed container on port 5432 or custom external URL)*
3. **Port Configuration**:
   - **Backend Server Port**: default `:4000` *(Customizable; automatically updates `PORT`, `SERVER_PORT`, `NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_WS_URL`)*
   - **Frontend Web Client Port**: default `:3001` *(Customizable; automatically updates `WEB_PORT` and `ALLOWED_ORIGINS`)*
4. **Auto-Launch**:
   - Prompts *"Launch dev servers now? [Y/n]"* at the end of setup to start immediately.

---

### 2. Launch Development Servers

You can launch the servers anytime with the launcher scripts:

**Windows PowerShell:**
```powershell
.\launch.ps1
```

**POSIX (Linux / macOS / WSL / Git Bash):**
```bash
./launch.sh
```

Or start both servers concurrently using `pnpm`:
```bash
pnpm dev
```

#### Access Endpoints:
- **Web Client**: [http://localhost:3001](http://localhost:3001)
- **Backend API**: [http://localhost:4000](http://localhost:4000)
- **WebSocket Sync**: `ws://localhost:4000`
- **Health Check**: [http://localhost:4000/health/ready](http://localhost:4000/health/ready)

---

## Docker Compose Deployment

To run containerized instances:

```bash
# Standard Stack (Web + Server + SQLite volume)
docker compose up -d

# Stack with Managed PostgreSQL Container
docker compose --profile postgres up -d
```

- Web Client (Production): [http://localhost:3000](http://localhost:3000)
- Server API: [http://localhost:4000](http://localhost:4000)
- PostgreSQL (when active): `localhost:5432`

---

## Database Configuration

Tether supports switching database drivers via `.env`:

### SQLite (Default)
Embedded inside Node 22 via `node:sqlite`. Zero external database required.
```env
DATABASE_DRIVER=sqlite
SQLITE_PATH=./data/tether.db
```

### PostgreSQL
For multi-node deployment or local PostgreSQL instance:
```env
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tether
```

---

## Latency Benchmarks

Measured using the automated benchmark harness (`pnpm bench`) simulating 5 concurrent clients on localhost:

| Benchmark Scenario | Samples | Min | p50 (Median) | p95 | p99 | Max | Mean |
|--------------------|---------|-----|--------------|-----|-----|-----|------|
| **Isolated Edits** (1 edit/s per client) | 200 | 0.67 ms | **1.60 ms** | **6.27 ms** | 13.06 ms | 13.26 ms | 2.50 ms |
| **Burst Typing** (15 chars/s per client) | 500 | 1.41 ms | **8.33 ms** | **124.26 ms** | 142.71 ms | 143.31 ms | 37.46 ms |

Burst typing latency remains bounded by the 200 ms cooperative batching window and token-bucket throttle rate limiter.

---

## NPM Scripts & Verification

All standard scripts are managed from the root `package.json`:

```bash
# Development
pnpm dev              # Launch both Server and Web concurrently
pnpm dev:server       # Launch Fastify backend only (:4000)
pnpm dev:web          # Launch Next.js frontend only (:3001)

# Testing & Verification
pnpm test             # Run all 275+ unit, integration, and chaos tests (60 suites)
pnpm chaos:ci         # Run automated chaos resilience test suite
pnpm bench            # Run latency benchmark harness (5 clients)
pnpm typecheck        # Run TypeScript checks across all workspaces
pnpm lint             # Run ESLint

# Building
pnpm build:pkg        # Compile shared packages (@tether/shared & @tether/sync-client) to dist/
pnpm build            # Full workspace compilation and verification
```

---

## Autonomous AI Agent Guides

If you are using AI coding assistants (such as Antigravity, Cursor, OpenAI Codex, or Claude Code), dedicated instruction files are available at the repository root:

- **[AGENTS.md](AGENTS.md)**: Universal guide with exact non-interactive setup (`.\setup.ps1 -NonInteractive` / `./setup.sh --non-interactive`), architecture maps, ports, and verification protocol.
- **[CLAUDE.md](CLAUDE.md)**: High-density quick-reference optimized for Anthropic's Claude Code CLI.

---

## Detailed Documentation

Comprehensive architectural design records and technical specifications are available in the [`docs/`](docs/) directory:

- [01 — Product Brief](docs/01-product-brief.md)
- [02 — System Architecture](docs/02-architecture.md)
- [03 — Sync Engine & CRDTs](docs/03-sync-engine.md)
- [04 — Wire Protocol & Message Frames](docs/04-protocol.md)
- [05 — Security, Rooms, & Host Handover](docs/05-rooms-security-roles.md)
- [06 — Data Model & Persistence Strategy](docs/06-data-model.md)
- [07 — Frontend & CodeMirror Integration](docs/07-frontend.md)
- [08 — Testing, Chaos Harness, & Latency Benchmarks](docs/08-testing-and-verification.md)
- [09 — Operations & Observability](docs/09-operations.md)
- [12 — UI / UX Architecture & Theme System](docs/12-ui-ux.md)

---

## License

MIT
