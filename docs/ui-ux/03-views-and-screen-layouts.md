# 03 — Views and Screen Layouts

This document specifies the wireframes, view hierarchy, responsive layout systems, and panel coordination for all application views.

---

## 1. View Roster Overview

The application comprises five primary screen states and four interactive overlay modals:

1. **Landing Page (`/`)**: Product showcase, live animated mini-editor, quick room creator, and join-by-ID form with Lenis smooth scrolling.
2. **Join Gate (`/r/[id]`)**: Passcode & display name entry with live avatar presence stack and `thinking-orbs` connecting state.
3. **Desktop Workspace (`/r/[id]`)**: The "Quiet IDE" three-pane resizable workspace with collaborative CodeMirror editor, live sandboxed preview, sidebar, and diagnostics console.
4. **Mobile Workspace**: Fullscreen editor layout with fluid swipeable bottom sheets for People, Activity, Console, and Sync panels.
5. **Terminal / Edge States**: Kicked view (with instant "Copy My Version" button), Room Locked, Offline Reconnecting banner, and 404 Not Found.
6. **Modal Overlays**: `⌘K` Command Palette, VS Code-Style Settings Dialog, Host Controls Sheet, Keyboard Shortcuts Modal (`?`).

---

## 2. Desktop Workspace Wireframe & Resizable Panes

The desktop workspace uses `react-resizable-panels` (via `shadcn/ui` Resizable) with saved layout proportions stored in `localStorage('ide-layout-desktop')`.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [Logo] room-982 ⧉ · [HTML ▾] · Invite Link    [Avatars 4] · ✓ Verified · 24ms · ⌘K [⚙] │ TOP BAR (40px)
├───────────────────────────────────────────┬──────────────────┬─────────────────────────┤
│ CodeMirror 6 Editor                       │ Live Preview     │ Right Sidebar (Tabs):   │
│                                           │ (Collapsible)    │ [People (4)] [Activity] │
│ 1 <!DOCTYPE html>                         │                  ├─────────────────────────┤
│ 2 <html>                                  │                  │ • Sarah (Host)          │
│ 3   <body>                                │ Sandboxed        │ • Alex  [Follow]        │
│ 4     <h1>Collaborative IDE</h1>          │ <iframe>         │ • Ravi   (Typing...)    │
│ 5   </body>                               │                  │ • Elena  (Idle)         │
│ 6 </html>                                 │                  │                         │
│                                           │                  │ ─────────────────────── │
│ [Alex ↑ Ln 4] (Off-screen cursor chip)    │                  │ Feed:                   │
│                                           │                  │ 14:02 Alex joined       │
├───────────────────────────────────────────┴──────────────────┴─────────────────────────┤
│ Bottom Drawer (Collapsible & Resizable)                                                │
│ [Console]  [Sync Diagnostics & Latency Chart]  [Chaos Bot Storm Lab]          [—] [✕]  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ > console.log("Initialized room sync");                                                │
│   [p95: 28ms] [Pending: 0 ops] [Convergence Checksum: 0x8f2a1b9c] [Verified 2s ago]   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ● Online · Ln 4, Col 12 · UTF-8 · HTML5 · 4 Peers · Host: Sarah · 24 ms                │ STATUS BAR (24px)
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Pane Breakdown
* **Top Bar (40px height)**:
  * Brand icon + Room ID pill with copy trigger (`morphicons` + `<TextMorph>`).
  * Language selector dropdown with `theSVG` vector logo.
  * Share Invite button (opens dialog or copies URL).
  * Presence Avatar Stack (shows active collaborators with presence borders).
  * Real-time Sync Status Pill (`Verified in sync` / `Syncing...`).
  * Latency Ticker (`24 ms`).
  * `⌘K` Command Palette trigger & Settings gear icon.
* **Central Editor Pane**: CodeMirror 6 taking majority width (min 30%, default 50%).
* **Live Sandboxed Preview Pane (Collapsible)**:
  * Shown when language is HTML, CSS, or JavaScript.
  * Debounced re-render (300ms) with syntax error catching.
  * Header contains refresh button, zoom toggle, and external window popout.
* **Right Sidebar Pane (Collapsible)**:
  * Tab 1: **People**: Member list with host badges, follow toggles, mute/kick controls (host only).
  * Tab 2: **Activity**: Real-time event audit log (joins, leaves, language changes, snapshots).
* **Bottom Diagnostics Drawer (Collapsible, default collapsed or 160px height)**:
  * Tab 1: **Console**: Logs captured from sandboxed iframe + Web Worker evaluations.
  * Tab 2: **Sync Diagnostics**: `bklit-ui` real-time RTT latency chart, SHA-256 state checksum, token-bucket throttle counter.
  * Tab 3: **Chaos Lab**: Bot Storm trigger button (spawns 8 headless peers typing under latency).
* **Bottom Status Bar (24px height)**:
  * Connection health dot (`●` emerald/amber/crimson).
  * Cursor position (`Ln 4, Col 12`).
  * Encoding & Language format.
  * Active peer count.
  * Current room host display name.
  * Round-trip ping.

---

## 3. Mobile Workspace Layout

On mobile viewports (`< 768px`), horizontal splitting is disabled:

```
┌────────────────────────────────────────────────────────┐
│ [Logo] room-982 ⧉ · [HTML ▾]    [Avatars 3] · ⌘K [⚙]   │ TOP BAR
├────────────────────────────────────────────────────────┤
│ CodeMirror 6 Editor (Fullscreen 100vh - 84px)          │
│                                                        │
│ 1 <!DOCTYPE html>                                      │
│ 2 <html>                                               │
│ 3   <body>                                             │
│ 4     <h1>Collaborative IDE</h1>                       │
│ 5   </body>                                            │
│ 6 </html>                                              │
├────────────────────────────────────────────────────────┤
│ [People (3)]  [Preview]  [Console]  [Sync Lab]         │ BOTTOM TABS BAR (44px)
└────────────────────────────────────────────────────────┘
```

* Clicking any bottom tab opens a smooth swipeable drawer (**Vaul / Radix Sheet**).
* Cursors and selections adapt to touch gestures with floating action pill for undo/redo.
* Virtual keyboard resize handled using `viewport: interactive-widget=resizes-content`.

---

## 4. Landing Page (`/`) Layout & Proof Strip

The landing page introduces the product with clean typography, restrained dark styling, and `Lenis` smooth scroll:

1. **Header**: Logo, GitHub link, theme quick-toggle.
2. **Hero Section**:
   * Headline: *"Real-Time Collaborative Coding with Mathematical Convergence."*
   * Looping Mini-Editor: Two simulated automated cursors typing and refactoring code simultaneously with live "Verified in sync" badge updates.
3. **Action Cards (Two-Column Grid)**:
   * **Create Room Card**: Display name input, language selector (with vector logos), optional passcode input, and primary "Create Room" button.
   * **Join by ID Card**: Room ID input, passcode input, and "Enter Room" button.
4. **Proof Strip**:
   * 4-stat proof grid: `0 lost edits under network partition` · `p95 ack < 40ms` · `Lossless 5 op/s token-bucket throttling` · `Chaos tested in CI`.
5. **Minimal Footer**: Clean credits, documentation links, zero clutter.

---

## 5. Join Gate Screen (`/r/[id]`)

When a user navigates directly to a room link, they are held in the Join Gate before socket establishment:

* Center card (`max-w-md`) with room language SVG badge.
* Live presence indicator: *"3 developers currently editing"*.
* Avatar preview ring.
* Display Name input (autofilled from `localStorage` if previously set).
* Passcode input (uses `InputOTP` if the room has security enabled).
* "Join Room" button: Triggers `thinking-orbs` animation during the REST validation handshake.
* On HTTP 200: Receives signed room token, mounts workspace, and transitions cleanly.

---

## 6. Edge & Terminal States

| State | Visual Treatment | Recovery Action |
|---|---|---|
| **Kicked by Host** | Amber border banner; editor transitions to read-only. | Prominent **"Copy My Document"** button + **"Download File"** action. User never loses their local buffer. |
| **Room Locked** | Lock icon badge on Join Gate; prevents new admissions. | Displays message: *"The host has locked this room. Please request access from the host."* |
| **Connection Dropped** | Yellow warning pill in status bar: *"Reconnecting in 2s (Attempt 3/5)..."* | Local edits continue buffering to IndexedDB without blocking the user. |
| **Room Not Found (404)** | Centered card: *"Room `r-xyz` does not exist or has expired."* | Button: *"Return to Home"* or *"Create This Room"*. |
