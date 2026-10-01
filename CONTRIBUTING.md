# Contributing to Tether

Thank you for your interest in contributing to **Tether**! Tether is a real-time collaborative code editor built on Yjs CRDTs, Fastify WebSockets, and Next.js.

We welcome contributions of all kinds: bug fixes, documentation improvements, performance optimizations, and test coverage enhancements.

---

## 1. Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please report unacceptable behavior to [hridaysingh2207@gmail.com](mailto:hridaysingh2207@gmail.com).

---

## 2. Architecture & Monorepo Overview

Tether is organized as a `pnpm` monorepo:

- **`apps/server` (`@tether/server`)**: Fastify REST API, WebSocket server, Yjs real-time sync engine, session admission, room persistence.
- **`apps/web` (`@tether/web`)**: Next.js 16 (App Router), React 19, CodeMirror 6, Tailwind CSS v4 web client.
- **`packages/shared` (`@tether/shared`)**: Protocol codecs, Zod schemas, token bucket rate limiter, backoff, checksum utilities.
- **`packages/sync-client` (`@tether/sync-client`)**: Client-side sync engine communicating with the backend WebSocket.
- **`tests/chaos` (`@tether/chaos`)**: Network partition, chaos fuzzing, and stress test suites.

> [!IMPORTANT]
> Whenever you modify `@tether/shared` or `@tether/sync-client`, always run `pnpm build:pkg` so dependent workspaces receive updated TypeScript type definitions.

---

## 3. Development Setup

### Prerequisites
- **Node.js**: `v22.x` or higher (required for native `node:sqlite`)
- **pnpm**: `v9.x` or higher
- **Git**

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/hriday-singh/tether.git
cd tether

# 2. Configure environment
cp .env.example .env
mkdir -p data

# 3. Install dependencies
pnpm install

# 4. Build shared packages
pnpm build:pkg

# 5. Run database migrations (SQLite)
pnpm db:migrate

# 6. Start development servers
pnpm dev
```

The web client runs on `http://localhost:3001` and the backend server runs on `http://localhost:4000`.

---

## 4. Verification & Testing

Every pull request must pass the automated test suites before being merged:

```bash
# Run typechecking across all workspaces
pnpm typecheck

# Run linter
pnpm lint

# Run unit and integration tests (340+ tests)
pnpm test

# Run the chaos resilience & network partition suite
pnpm chaos:ci
```

---

## 5. Development Guidelines

1. **Sync Correctness Over Features**: The core guarantee of Tether is zero lost edits and verifiable convergence under network faults (see ADR-001 in `docs/11-decisions.md`). Features must never compromise CRDT convergence or token-bucket rate limits.
2. **Modular Code**: Ensure files remain clean and focused. Keep individual file lengths under 700 lines.
3. **Strict TypeScript**: Avoid `any`. Use strict type definitions and Zod schemas for runtime validation boundaries.
4. **Conventional Commits**: Format commit messages according to conventional commit guidelines:
   - `feat: add room expiration sweep`
   - `fix: correct IP extraction in websocket gate`
   - `docs: update setup instructions in README`
   - `test: add awareness binding spoof tests`

---

## 6. Submitting a Pull Request

1. Fork the repository and create your feature branch: `git checkout -b feat/my-new-feature`
2. Commit your changes: `git commit -m 'feat: summary of changes'`
3. Push to your fork: `git push origin feat/my-new-feature`
4. Open a Pull Request on GitHub against the `main` branch.
5. Fill out the PR template checklist to confirm that typecheck, lint, and tests pass.
