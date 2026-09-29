# 07 — Frontend

## Routes

| Route | Purpose |
|-------|---------|
| `/` | Create room (name, optional custom ID, optional passcode, language) or join by ID |
| `/r/[roomId]` | Join gate (name + passcode if needed) if no valid token in storage, otherwise workspace |

Token + memberId live in `localStorage` keyed by room (`collab:session:<roomId>`). On a 401 at upgrade
the client drops the token and shows the join gate prefilled with the name.

## Workspace layout

```
Desktop (≥ 1024px)
┌──────────────────────────────────────────────────────────────┐
│ room-id · 🔒 · [JavaScript ▾]   ● Saved · 24 ms    [Host ▾]  │  top bar
├─────────────────────────────────────────┬────────────────────┤
│                                         │ People (4)         │
│                                         │ ● Asha  host typing│
│            CodeMirror editor            │ ● Ravi  idle       │
│   remote cursors + name labels          │ ◌ Meera reconnect… │
│   line highlights in gutter             ├────────────────────┤
│                                         │ Activity           │
│                                         │ Ravi edited L12–18 │
│                                         │ Asha is now host   │
└─────────────────────────────────────────┴────────────────────┘

Mobile (< 1024px)
┌──────────────────────┐
│ room-id   ● Saved  ☰ │
├──────────────────────┤
│   editor (full)      │
├──────────────────────┤
│ [People 4][Activity] │  bottom tabs → sheet
└──────────────────────┘
```

Tablet (768–1023) uses the mobile structure with a wider sheet. Right column on desktop is resizable
(persisted in localStorage).

## Components

Shared primitives in `components/ui/` (Radix + tokens, built once): `Button`, `IconButton`, `Input`,
`Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `Select`, `Tabs`, `Tooltip`, `Toast`, `Badge`,
`Avatar`, `Switch`, `Skeleton`.

Workspace components in `components/workspace/`:

| Component | Data source | Notes |
|-----------|-------------|-------|
| `Editor` | Y.Text + awareness via `yCollab` | Lazy-loaded, `ssr:false`. Language extension loaded on demand per language |
| `StatusPill` | `SyncClient` status + pending count | Saved / Saving (n) / Reconnecting / Offline, n unsent |
| `LatencyHud` | `SyncClient` stats | RTT p50/p95, ack p50/p95, popover with sparkline |
| `Roster` | server roster + awareness (typing/status) | Host crown, typing dots, status badge, host actions menu per row. `reconnecting` rows dimmed, bot badge, duplicate names suffixed `(2)` |
| `ActivityFeed` | TanStack `useInfiniteQuery` (history) + live `event` messages, merged into one store keyed by `seq` (dedupe + gap-fill, [04](04-protocol.md#activity-feed-delivery-no-duplicates-no-gaps)) | Virtualized, `aria-live="polite"` on a throttled announcer |
| `HostMenu` | control messages | Lock, passcode, transfer; only rendered for host, still enforced server-side. Each action stays pending until `ok`/`error` with its `rid` |
| `LineHighlight` | awareness `highlight` | `Alt+H` or gutter click to flag the current line range; colored gutter band per user |
| `NetworkLab` | `SyncClient` test hooks | Demo mode only (`NEXT_PUBLIC_DEMO_MODE=true`): add latency, go offline, kill socket |
| `FollowControl` (in `Roster`) | awareness cursor of target | Click a row: jump to their cursor. Eye toggle: follow (scroll batched per animation frame). Stops on own keypress, scroll, `Esc`, or when they leave (toast). Same member in 2 tabs: follow the most recently active one |
| `OffscreenCursors` | CodeMirror `ViewPlugin` + awareness | Edge chips "Alex ↑ L212" for remote cursors outside the viewport. Click to jump. More than 3 per edge collapse to "+n" |
| `InviteButton` | room id | Copies `/r/<roomId>` (never the passcode). `navigator.share` on mobile when available, clipboard otherwise |
| `ExportMenu` | `Y.Text` | Download `<roomId>.<ext>` (Blob) or copy all |
| `SyncBadge` (in `StatusPill`) | `checksum` messages + stats store | Verified · Ns ago / Syncing. Never Verified while pending > 0 or offline |
| `KickedScreen` | close `4003` + pending count | "N changes were not saved" + **Copy my version** |
| `StormPanel` | `demo.storm` | Demo mode, host only: bot count, duration, faults toggle. Shows live bots and the final verification result |

## Render strategy (no UI freeze)

- The document never goes into React state. CodeMirror owns rendering, Yjs owns data.
- `SyncClient` exposes small external stores (`status`, `stats`, `roster`, `presence`). Components read
  them with `useSyncExternalStore`. Store snapshots are immutable and only replaced when the value changes.
- Awareness changes arrive up to 5/s per peer. Presence store coalesces to **one snapshot per animation
  frame** (`requestAnimationFrame`) before notifying React.
- Roster rows and feed items are memoized. The feed is virtualized.
- Activity announcements to screen readers are throttled to 1 per 2 s so they don't spam.
- Budget: no long task > 50 ms while 5 peers type (verified in the Performance panel, screenshot in README).

## Design tokens

Single file `apps/web/styles/globals.css` (Tailwind v4 `@theme` referencing CSS variables). No component
hardcodes a color, size, radius, or duration.

- **Semantic colors:** `background`, `foreground`, `muted`, `muted-foreground`, `border`, `primary`,
  `primary-foreground`, `destructive`, `success`, `warning`, `focus-ring`.
- **Presence palette:** `presence-1` … `presence-8`, each with `-fg` (cursor/label, AA on the editor
  background) and `-bg` (selection/highlight tint). Assigned by `colorIndex` from the server.
- **Status colors:** `status-saved`, `status-saving`, `status-offline` map onto semantic tokens.
- **Scales:** type (xs–2xl), spacing (4 px base), radius (`sm`, `md`, `lg`, `full`, rounded by default),
  shadow (`sm`, `md`), motion (`duration-fast` 120 ms, `duration-base` 200 ms, `ease-standard`).
- Light mode only, semantic names so dark mode drops in later.
- Motion: CSS transitions on `opacity`/`transform` only. `prefers-reduced-motion` disables them.

## Accessibility

- Semantic landmarks: `header`, `main` (editor), `aside` (people, activity).
- Keyboard: every control reachable. `Esc` returns focus to the editor. The editor keeps CodeMirror's
  a11y (screen reader mode, `Tab` escape via `Esc` then `Tab`).
- Status pill and host changes announced via `aria-live`.
- Color is never the only signal: typing = dots + text, host = crown icon + label, status = icon + text.
- Touch targets ≥ 44 px on mobile.

## Open questions

- Visual design direction (fonts, primary color) to be set in the UI milestone with a design skill; tokens make it swappable.
