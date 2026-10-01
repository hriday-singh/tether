# 03: Views and Screen Layouts

This document specifies the wireframes, view hierarchy, responsive layout systems, and panel coordination for all application views.

---

## 1. View Roster Overview

The application comprises five primary screen states and four interactive overlay modals:

1. **Landing Page (`/`)**: Product preview, live animated mini-editor, quick room creator, and join-by-ID form with Lenis smooth scrolling.
2. **Join Gate (`/r/[id]`)**: Passcode & display name entry with live avatar presence stack and `thinking-orbs` connecting state.
3. **Desktop Workspace (`/r/[id]`)**: The "Quiet IDE" three-pane resizable workspace with collaborative CodeMirror editor, live sandboxed preview, sidebar, and diagnostics console (for viewports ≥ 1024px).
4. **Small Screen Viewport Barrier (`<ScreenTooSmallGate />`)**: Protective gate screen when accessed on viewports < 1024px, informing users that the collaborative engineering environment works on bigger screens only with dynamic resize auto-unblocking.
5. **Terminal / Edge States**: Kicked view (with instant "Copy My Version" button), Room Locked, Offline Reconnecting banner, and 404 Not Found.
6. **Modal Overlays**: Command Palette (`⌘K`), VS Code-Style Settings Dialog (`⌘,`), Host Controls Sheet, Keyboard Shortcuts Modal (`⌘?` / `?`).

---

## 2. Desktop Workspace Wireframe & Inset Card Architecture

![Desktop Workspace Layout](../assets/workspace-preview.png)

The desktop workspace uses an **Inset Floating Card Layout** with `react-resizable-panels`. Instead of rigid, edge-to-edge square panels, the workspace sits inside a subtle padded background canvas (`p-2.5 gap-2.5`), with each pane encapsulated in a floating card with continuous rounded corners (`rounded-2xl`).

```
╭─ Floating Top Capsule Bar (h-10, rounded-xl, px-3, bg-card/80 backdrop-blur) ───────────────────────╮
│ [Tether] ( room-982 ⧉ ) · [HTML ▾] · ( Share )     [Avatars 4] · ( ✓ Verified ) · ( 24ms ) · ( ⌘K ) [⚙] │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ▼ 8px gap
╭─ Floating Editor Card (rounded-2xl) ───╮ ╭─ Floating Preview (rounded-2xl) ─╮ ╭─ Floating Sidebar (rounded-2xl) ─╮
│ 1 <!DOCTYPE html>                      │ │                                  │ │ ( People 4 )   Activity          │
│ 2 <html>                               │ │ Sandboxed Live HTML Preview      │ ├──────────────────────────────────┤
│ 3   <body>                             │ │ [Rendered DOM Output]            │ │ • Sarah [Host]                   │
│ 4     <h1>Tether</h1>                  │ │                                  │ │ • Alex  ( Follow )               │
│ 5   </body>                            │ │                                  │ │ • Hriday  (Typing...)            │
│ 6 </html>                              │ │                                  │ │ • Elena (Idle)                   │
│                                        │ │                                  │ │ ──────────────────────────────── │
│ ( Alex ↑ Ln 4 ) [Pill Chip]            │ │                                  │ │ 14:02 Alex joined room           │
╰────────────────────────────────────────╯ ╰──────────────────────────────────╯ ╰──────────────────────────────────╯
  ▼ 8px gap
╭─ Floating Diagnostics Drawer Card (rounded-2xl, collapsible) ────────────────────────────────────────╮
│ ( Console )   ( Sync & Latency Chart )   ( Chaos Lab )                                         [-] [✕] │
├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ > console.log("Tether room sync initialized");                                                       │
│   ( RTT p95: 28ms ) · ( Pending: 0 ops ) · ( Checksum: 0x8f2a1b9c ) · ( Verified 2s ago )           │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ▼ 6px gap
╭─ Floating Bottom Status Capsule (h-7, rounded-xl, px-3, font-mono text-xs) ──────────────────────────╮
│ ● Online · Ln 4, Col 12 · UTF-8 · HTML5                    4 Peers · Host: Sarah · Ping: 24 ms        │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────╯
```

### Inset Card & Pill Geometry Breakdown
* **Floating Capsule Bars (Top & Status)**: `rounded-xl` or `rounded-full` island bars with backdrop blur (`backdrop-blur-md bg-card/80 border border-border/50`).
* **Major Floating Cards (Editor, Preview, Sidebar, Bottom Drawer)**:
  * Wrapped in `rounded-2xl` (16px radius) with `overflow-hidden` and `border border-border/40`.
  * Separated by fluid 8px gaps instead of harsh 0px dividers.
* **Pills & Status Indicators**:
  * All status badges ("Verified in sync", "24 ms", room ID pill, off-screen cursor chips) use `rounded-full` capsules with subtle border glows.
* **Interactive Buttons & Inputs**:
  * Form inputs, action buttons, and dropdown selectors use `rounded-xl` (10px-12px) for comfortable click targets and visual warmth.
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

  ![Diagnostics Drawer and Sync Latency](../assets/network-lab.png)
* **Bottom Status Bar (24px height)**:
  * Connection health dot (`●` emerald/amber/crimson).
  * Cursor position (`Ln 4, Col 12`).
  * Encoding & Language format.
  * Active peer count.
  * Current room host display name.
  * Round-trip ping.

### Responsive Viewport Strategy (Desktop & Laptops)
To prevent code view cramping on laptops and smaller desktop displays:
* **Large Desktop Viewports (≥ 1280px / `xl`)**: Full 3-pane split (CodeMirror Editor + Live Sandboxed Preview + Sidebar) mounted simultaneously using `react-resizable-panels`.
* **Medium Desktop & Laptops (1024px - 1279px / `lg`)**: 2-pane priority layout (CodeMirror Editor taking ≥ 65% width + Sidebar). The Live Preview pane transforms into a collapsible side-drawer or segmented toggle inside the editor pane, guaranteeing CodeMirror maintains a minimum width of at least `600px` without horizontal line crowding.
* **Small Screens & Mobile Viewports (< 1024px)**: The collaborative IDE experience requires a larger display to prevent UI collisions and cursor disorientation. The app mounts `<ScreenTooSmallGate />` informing the user that Tether's workspace works on bigger screens only (auto-unblocks upon resizing window).

---

## 3. Small Screen Viewport Barrier (`<ScreenTooSmallGate />`)

To prevent fragmented code layouts, cursor disorientation, accidental mobile keystrokes, and poor collaborative typing ergonomics, Tether presents a focused display barrier for screens under 1024px:

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│                     [ Monitor01Icon ]                      │
│                                                            │
│                 Desktop display required                   │
│                                                            │
│   Tether's multi-pane workspace requires a screen at least │
│   1024 px wide to host editor, presence, and diagnostics   │
│   panels without collisions.                               │
│                                                            │
│             ╭──────────────────╮  ╭────────────────╮       │
│             │ ⟳ Recheck Display│  │ Return to Home │       │
│             ╰──────────────────╯  ╰────────────────╯       │
│                                                            │
│           (Expands automatically when resized)             │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Technical Implementation & UX Safeguards
* **Mounting Hook**: Evaluates `window.matchMedia('(min-width: 1024px)')`.
* **Sync Client Lifecycle**: When `<ScreenTooSmallGate />` is mounted, `ws.client.pause()` pauses WebSocket traffic while retaining local document state.
* **Dynamic Auto-Unlock**: Expanding the window or rotating to a display ($\ge 1024\text{px}$) unmounts the barrier, calls `ws.client.resume()`, and immediately restores the 3-pane workspace without state loss.

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
4. **Technical Benchmark Matrix (Zero-SaaS-Cliché Proof Bar)**:
   * Rendered as an authentic engineering spec strip (monospace data labels, quiet borders, zero glowing gradients or oversized vanity counters): `0 lost edits under network partition` · `p95 ack < 40ms` · `Lossless 5 op/s token-bucket throttling` · `50+ seed chaos tested in CI`.
5. **Minimal Footer**: Clean repository credits, architecture doc links, zero marketing fluff.

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

---

## 7. Modal Overlays & Keyboard Shortcuts

Tether provides keyboard-first navigation modeled after IDE conventions while preserving browser accessibility.

### 7.1 Command Palette (`Ctrl/Cmd + K`)

The Command Palette overlay (`cmdk`) allows keyboard-driven execution of all workspace capabilities:
- **Navigation**: Switch between Sidebar tabs (People, Chat, Activity, Scratchpad), toggle panels, or trigger Zen Mode (`Ctrl/Cmd + Shift + F` / `F11`).
- **Editor Actions**: Format code (`Shift + Alt + F`), trigger find panel (`Ctrl/Cmd + F`), change language, adjust font size or tab size.
- **Theme QuickPick (`Ctrl/Cmd + K Ctrl/Cmd + T`)**: Instant preview on arrow navigation, Enter to commit, Esc to cancel.
- **Room Controls**: Invite peers, lock/unlock room, run bot storms, or export state snapshots.

### 7.2 Settings Modal (`Ctrl/Cmd + ,`)

A tabbed dialog dividing preferences into four functional categories:
1. **Appearance**: Theme selection (`quiet-dark`, `quiet-light`, `contrast-dark`, `contrast-light`), font size, caret blinking.
2. **Editor**: Tab size (2 or 4 spaces), line wrapping, bracket pairing, line numbers.
3. **Collaboration**: Presence cursors, selection highlights, follow unblocking on input.
4. **Diagnostics**: Throttle indicator visibility, RTT sparklines, checksum logging.

### 7.3 Keyboard Shortcuts Cheatsheet Modal (`Ctrl/Cmd + ?` or `?`)

Pressing `Ctrl/Cmd + ?` (or `?` when outside text inputs) opens a modal listing all active workspace shortcuts.

### 7.4 Comprehensive Keyboard Shortcuts Matrix

| Category | Shortcut (Mac / Linux & Win) | Action | Target / Context |
|---|---|---|---|
| **Command & Search** | `⌘K` / `Ctrl+K` | Open Command Palette | Global |
| **Command & Search** | `⌘K ⌘T` / `Ctrl+K Ctrl+T` | Open Theme QuickPick | Global |
| **Command & Search** | `⌘F` / `Ctrl+F` | Open Search / Replace panel | Editor |
| **Execution** | `⌘Enter` / `Ctrl+Enter` | Run code or refresh live preview | Global |
| **Code Formatting** | `⇧⌥F` / `Shift+Alt+F` | Format active document | Editor |
| **View Navigation** | `⌘⇧F` / `Ctrl+Shift+F` (or `F11`) | Toggle Zen Mode (Editor & Preview only) | Global |
| **View Navigation** | `⌘B` / `Ctrl+B` | Toggle Sidebar | Global |
| **View Navigation** | `⌘J` / `Ctrl+J` (or `Ctrl+\``) | Toggle Diagnostics Drawer | Global |
| **Collaboration** | `⌘⇧M` / `Ctrl+Shift+M` | Quote editor selection into room chat | Editor |
| **Collaboration** | `⌥H` / `Alt+H` | Highlight current line for all peers | Editor |
| **Preferences** | `⌘,` / `Ctrl+,` | Open Settings Dialog | Global |
| **Help** | `⌘?` / `Ctrl+?` (or `?`) | Open Keyboard Shortcuts Cheatsheet | Global |
| **Focus & Dismiss** | `Escape` | Dismiss modal/drawer, exit Zen mode, or focus editor | Global |
| **Accessibility** | `Escape` then `Tab` | Release focus trap from CodeMirror to UI | Editor |

### 7.5 Accessibility and Focus Management

- **Typing Isolation**: Shortcuts like `?` are suppressed when focus resides within text inputs, textareas, or contentEditable elements (`!typing`).
- **Focus Restoration**: Pressing `Escape` closes the topmost modal/drawer and returns focus to the CodeMirror editor surface.
- **Tab Trap Exit**: Following WCAG keyboard trapping guidelines, pressing `Escape` followed by `Tab` inside the CodeMirror editor moves tab focus to the next interactive UI element rather than inserting tab spaces into the document.

