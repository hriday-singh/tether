# Tether

A real-time collaborative code editor built on Yjs CRDTs, a Fastify WebSocket sync server, CodeMirror 6, and Next.js 16.

## Features

- **Real-time collaboration**: Peers can edit together. Yjs merges concurrent edits, and rate-limited broadcasts combine pending updates instead of dropping them.
- **Sync verification**: When editing pauses, clients compare document checksums with the server. The interface shows when they match, and a mismatch triggers automatic recovery.
- **Latency and sync status**: View round-trip and peer-delivery latency, including p50 and p95 measurements. The status indicators show whether edits are pending, syncing, or saved.
- **Network Lab and bot storms**: Use the diagnostics drawer to add latency, take the client offline, or drop its socket. Hosts can configure bot storms, review convergence, and restore the document afterward.
- **Presence and host controls**: See collaborators' cursors, selections, and activity. Hosts can lock rooms, rotate passcodes, remove participants, and change the room's syntax mode.
- **Room chat with code quotes**: Quote a selected code snippet in chat with `Ctrl/Cmd+Shift+M`. The reference follows the code as it changes.
- **Sandboxed execution and console**: Preview HTML, CSS, and JavaScript in an isolated iframe. Run JavaScript and TypeScript in a Web Worker with a 5-second watchdog. The console captures logs, warnings, errors, and results.
- **Themes**: Choose Quiet Dark, Quiet Light, or High Contrast, and preview theme changes before switching.
- **Command palette**: Press `Ctrl/Cmd+K` to search navigation, room and host actions, editor settings, and themes.
- **Storage and room cleanup**: Local development uses SQLite by default, and production can use PostgreSQL. Inactive temporary rooms are deleted after 24 hours.

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

| Path                   | Package               | Description                                                                        | Dev port |
| ---------------------- | --------------------- | ---------------------------------------------------------------------------------- | -------- |
| `apps/server`          | `@tether/server`      | REST API, WebSocket server, Yjs sync, room persistence (Fastify 5, ws, Yjs)        | 4000     |
| `apps/web`             | `@tether/web`         | Editor, console, room management (Next.js 16, React 19, CodeMirror 6, Tailwind v4) | 3001     |
| `packages/shared`      | `@tether/shared`      | Protocol codecs, Zod schemas, rate limiter, backoff, checksums                     |          |
| `packages/sync-client` | `@tether/sync-client` | Client-side WebSocket sync driver                                                  |          |
| `tests/chaos`          | `@tether/chaos`       | Network chaos, convergence, and invariant tests (Vitest, fast-check)               |          |

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

| Scenario                             | Samples | Min     | p50     | p95       | p99       | Max       | Mean     |
| ------------------------------------ | ------- | ------- | ------- | --------- | --------- | --------- | -------- |
| Isolated edits (1 edit/s per client) | 200     | 0.67 ms | 1.60 ms | 6.27 ms   | 13.06 ms  | 13.26 ms  | 2.50 ms  |
| Burst typing (15 chars/s per client) | 500     | 1.41 ms | 8.33 ms | 124.26 ms | 142.71 ms | 143.31 ms | 37.46 ms |

Burst latency is bounded by the 200 ms batching window and the token-bucket throttle.

## Scripts

```bash
pnpm dev          # server + web
pnpm dev:server   # backend only
pnpm dev:web      # frontend only
pnpm db:migrate   # run sqlite database migrations
pnpm test         # all tests
pnpm chaos:ci     # network partition and convergence tests
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

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before submitting pull requests.

## Security

For security vulnerability reports, please review our [Security Policy](SECURITY.md) and report responsibly to [hridaysingh2207@gmail.com](mailto:hridaysingh2207@gmail.com).

## License

[MIT](LICENSE) © 2026 Hriday Singh
