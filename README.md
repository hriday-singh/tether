# Tether

A real-time collaborative code editor built on Yjs CRDTs, a Fastify WebSocket sync server, CodeMirror 6, and Next.js 16.

## Features

- **CRDT sync**: Yjs v13 over a custom WebSocket protocol, with token-bucket throttling on updates. Peers converge on identical documents after disconnects, dropped frames, or throttling.
- **Live latency readout**: keystroke-to-peer latency (p50 / p95) shown in the UI.
- **Chaos testing**: 275+ unit, property-based, and chaos tests across 60 suites covering network partitions, duplicated frames, and reconnect storms.
- **Chaos mode**: the room host can spawn bot clients that edit under simulated network faults, then roll the document back to its pre-run state with `Y.UndoManager`.
- **Room chat**: per-room text chat with ordered sequence numbers, optimistic updates, unread indicators, and persistence.
- **Sandboxed runs**: JavaScript, HTML, and Python run in a sandboxed iframe or Web Worker with a 5-second watchdog.
- **Storage**: embedded SQLite via Node 22 (`node:sqlite`) by default, PostgreSQL for production.

## Architecture

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

| Path | Package | Description | Dev port |
|------|---------|-------------|----------|
| `apps/server` | `@tether/server` | REST API, WebSocket server, Yjs sync, room persistence (Fastify 5, ws, Yjs) | 4000 |
| `apps/web` | `@tether/web` | Editor, console, room management (Next.js 16, React 19, CodeMirror 6, Tailwind v4) | 3001 |
| `packages/shared` | `@tether/shared` | Protocol codecs, Zod schemas, rate limiter, backoff, checksums | |
| `packages/sync-client` | `@tether/sync-client` | Client-side WebSocket sync driver | |
| `tests/chaos` | `@tether/chaos` | Network chaos, convergence, and invariant tests (Vitest, fast-check) | |

## Getting started

Requires Node 22+ and pnpm.

### 1. Setup

The setup script creates `.env` with a random `JWT_SECRET`, installs dependencies, builds the shared packages, and creates the `./data` directory. Every prompt has a default, so pressing Enter throughout gives a local SQLite setup.

Windows:

```powershell
.\setup.ps1
```

Linux / macOS / WSL / Git Bash:

```bash
chmod +x ./setup.sh ./launch.sh
./setup.sh
```

The script asks for:

1. **Environment**: local (Node + pnpm), Docker Compose, or both.
2. **Database**: SQLite (default) or PostgreSQL (Docker container on 5432 or an external URL).
3. **Ports**: backend (default 4000) and web (default 3001). Related `.env` values are updated to match.
4. **Launch**: whether to start the dev servers when setup finishes.

For CI or scripted installs, use `.\setup.ps1 -NonInteractive` or `./setup.sh --non-interactive`. To point the web client at a public backend, pass `-BackendUrl https://api.example.com` (or `--backend-url=https://api.example.com`), then rebuild the web app, since `NEXT_PUBLIC_*` values are fixed at build time.

### 2. Run

```bash
./launch.sh      # or .\launch.ps1 on Windows, or pnpm dev
```

- Web: http://localhost:3001
- API: http://localhost:4000
- WebSocket: `ws://localhost:4000`
- Health: http://localhost:4000/health/ready

## Docker

```bash
docker compose up -d                      # web + server + SQLite volume
docker compose --profile postgres up -d   # with a PostgreSQL container
```

Web runs on http://localhost:3000, API on http://localhost:4000.

## Configuration

See `.env.example` for all options. Database selection:

```env
# SQLite (default)
DATABASE_DRIVER=sqlite
SQLITE_PATH=./data/tether.db

# PostgreSQL
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/tether
```

## Benchmarks

From `pnpm bench`, 5 concurrent clients on localhost:

| Scenario | Samples | Min | p50 | p95 | p99 | Max | Mean |
|----------|---------|-----|-----|-----|-----|-----|------|
| Isolated edits (1 edit/s per client) | 200 | 0.67 ms | 1.60 ms | 6.27 ms | 13.06 ms | 13.26 ms | 2.50 ms |
| Burst typing (15 chars/s per client) | 500 | 1.41 ms | 8.33 ms | 124.26 ms | 142.71 ms | 143.31 ms | 37.46 ms |

Burst latency is bounded by the 200 ms batching window and the token-bucket throttle.

## Scripts

```bash
pnpm dev          # server + web
pnpm dev:server   # backend only
pnpm dev:web      # frontend only
pnpm test         # all tests
pnpm chaos:ci     # chaos suite
pnpm bench        # latency benchmark
pnpm typecheck
pnpm lint
pnpm build:pkg    # build @tether/shared and @tether/sync-client
pnpm build
```

## Documentation

- [Product brief](docs/01-product-brief.md)
- [Architecture](docs/02-architecture.md)
- [Sync engine](docs/03-sync-engine.md)
- [Wire protocol](docs/04-protocol.md)
- [Rooms, security, and host handover](docs/05-rooms-security-roles.md)
- [Data model](docs/06-data-model.md)
- [Frontend](docs/07-frontend.md)
- [Testing and benchmarks](docs/08-testing-and-verification.md)
- [Operations](docs/09-operations.md)
- [UI / UX](docs/12-ui-ux.md)

## License

MIT
