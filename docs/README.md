# Tether — Real-Time Collaborative Code Workspace (WEB-02)

Status: **DRAFT v1, pending review**. Nothing gets built until these docs are approved.
Last updated: 2026-09-29

## One-line pitch

A real-time collaborative code pad that **never loses a keystroke**. Every peer ends up with identical
text through bad networks, abrupt disconnects, and spam throttling. We prove it with an automated chaos
test suite and show measured latency live in the UI.

## The one thing that must be solid

Everything else in the spec (rooms, roster, audit feed, host handover) is table stakes. The showcase is:

1. **Convergence.** All clients and the server end with byte-identical documents. No exceptions.
2. **Zero loss.** An edit made on any client (online or offline) survives reconnects, throttling,
   server restarts and slow consumers.
3. **Measured latency.** Keystroke-to-peer latency is measured by the test harness and shown in the
   app (p50/p95). We report real numbers, not claims.
4. **No UI freeze.** React never re-renders per keystroke. Editor state lives in Yjs + CodeMirror.

If a feature threatens any of these four, the feature loses.

## Reading order

| # | Doc | What it answers |
|---|-----|-----------------|
| 01 | [Product brief](01-product-brief.md) | What we build, spec mapping, scope, non-goals, success criteria |
| 02 | [Architecture](02-architecture.md) | Components, repo layout, data flow, stack |
| 03 | [Sync engine](03-sync-engine.md) | **Core.** Convergence, lossless throttle, reconnect, persistence, latency |
| 04 | [Wire protocol](04-protocol.md) | Frames, messages, handshake, close codes, limits |
| 05 | [Rooms, security, roles](05-rooms-security-roles.md) | Passcodes, tokens, admission, host election |
| 06 | [Data model](06-data-model.md) | SQLite (POC) & PostgreSQL (production scale) schema, persistence strategy |
| 07 | [Frontend](07-frontend.md) | Layout, components, tokens, render strategy, a11y |
| 08 | [Testing & verification](08-testing-and-verification.md) | Chaos harness, property tests, latency bench |
| 09 | [Operations](09-operations.md) | Env config, local run, observability, shutdown, scale path |
| 10 | [Roadmap & TODO](10-roadmap.md) | 2-week plan + week-3 stretch checklist |
| 11 | [Decisions log](11-decisions.md) | ADRs (001–016) + research sources |
| 12 | [UI / UX direction](12-ui-ux.md) | "Quiet IDE" aesthetic, verified libraries, and ADR-016 overview |
| — | [**UI/UX Specs Suite**](ui-ux/) | **Dedicated modular frontend & UI/UX architecture:** |
| · | [01 — Design tokens & themes](ui-ux/01-design-tokens-and-themes.md) | Semantic OKLCH tokens, dark/light scales, presence colors, zero-emoji rule |
| · | [02 — Component library specs](ui-ux/02-component-library-specs.md) | Radix, Hugeicons, theSVG, morphicons, torph (`<TextMorph />`), bklit-ui, thinking-orbs |
| · | [03 — Views & screen layouts](ui-ux/03-views-and-screen-layouts.md) | Desktop resizable 3-pane workspace, small screen barrier (`<ScreenTooSmallGate />`), landing page, join gate, overlays |
| · | [04 — Settings & theme picker](ui-ux/04-settings-and-theme-picker.md) | VS Code-style `⌘K` Theme QuickPick with arrow preview, settings modal, preferences schema |
| · | [05 — Sandbox preview & console](ui-ux/05-sandbox-preview-and-console.md) | Client-side sandboxed iframe preview, 5s watchdog Web Worker runner, DevTools console UI |

## Locked decisions (2026-09-29)

| Topic | Decision |
|---|---|
| Core pitch | Zero-loss sync + measured latency, proven by chaos tests |
| Sync engine | Yjs (CRDT, **v13 pinned**) + **our own** WebSocket server on `y-protocols` |
| Identity | Guest display name + signed room session token (no accounts) |
| Database & Deployment v1 | SQLite (WAL mode, `better-sqlite3`) for POC/dev and single-node Docker Compose; PostgreSQL (AWS RDS) documented for multi-node production scale |
| Host handover | 5 s grace on abrupt disconnect (env-configurable), instant on clean leave |
| Editor scope | One shared doc per room, room-level language picker |
| Time budget | Plan for 2 weeks, week-3 stretch list kept in roadmap |
| Collaboration UX (v1) | Follow / jump-to-user, off-screen cursor chips, invite link, download / copy |
| Proof features | P1 "Verified in sync" badge + P2 bot storm adopted. P3 chaos report deferred to stretch |
| Feed delivery | Per-room gapless `seq`, pushed after commit, client dedupe + gap-fill (ADR-013) |
| UI/UX & Theme Architecture | "Quiet IDE" style, dark default + equivalent light mode, VS Code `⌘K` theme picker (ADR-016) |
| Preview & DevTools Console | Client-side isolated sandboxed iframe + 5s watchdog Web Worker (ADR-016) |
| Icon & Morphing System | Hugeicons stroke-rounded (zero emoji policy), `theSVG` brand logos, dual morphing via `morphicons` (SVG paths) + `torph` (animated text) |

## Rules for these docs

- Docs change **before** code when a design changes. PRs that change behavior update the relevant doc.
- Any number in docs (limits, timings) must match `packages/shared/src/constants.ts` once it exists.
- Open questions live at the bottom of the doc they belong to, never in chat only.
