# 12 — UI / UX Direction

Status: **locked & approved** (2026-09-29 via ADR-016). Complete modular specifications are detailed in [`docs/ui-ux/`](ui-ux/).

---

## 1. Style: "Quiet IDE"

The interface borrows VS Code's intuitive layout (central editor, collapsible panels, bottom status bar, `⌘K` command palette) and merges it with the sleek, high-signal polish of Linear, Zed, and transitions.dev: neutral near-black surfaces, one primary accent, pill status controls, rounded cards, thin borders, and very little chrome. It is not a VS Code clone: no file tree or extension drawer clutter, because each room is a focused collaborative session.

- **Theme Engine:** Dark workspace default (`oklch(0.14 0.01 260)`), with an equivalent Light theme (`oklch(0.985 0.002 240)`) and High Contrast variants driven by semantic CSS variables. Instant switching via VS Code-style `⌘K` Theme QuickPick.
- **Fonts:** Geist Sans for the UI and Geist Mono for code, latency numbers, and the console. Self-hosted locally with `next/font/local`.
- **Accent:** Electric Sky (`oklch(0.78 0.14 230)`). `success` (Verified sync), `warning`, and `destructive` remain distinct.
- **Presence Colors:** 8 accessible pastel tokens tuned for WCAG AA contrast against both dark and light editor surfaces.
- **Zero-Emoji Policy:** Strictly zero Unicode emojis across all UI controls, toasts, and status indicators. All visual cues use vector SVGs.

---

## 2. Verified Library Matrix

| Need | Pick | Package / Reference | Role |
|------|------|---------------------|------|
| Primitives | **shadcn/ui** (Radix) | `@radix-ui/*` | Base for Dialog, Sheet, DropdownMenu, Tooltip, Sonner, Command (`cmdk`), Resizable, InputOTP |
| UI Icons | **Hugeicons stroke-rounded** | `@hugeicons/react` | Single UI icon family across the entire workspace. Zero Lucide mixing |
| Language Logos | **theSVG** | Raw SVGs in `components/icons/brands/` | Authentic language badges (JS, TS, Python, HTML5, CSS3, Go, Rust, Markdown, SQL) |
| Icon Path Morphs | **morphicons** | `morphicons` (6 kB) | Vector SVG path morphing for stateful transitions (Copy ➔ Check, Play ➔ Stop, Lock ➔ Unlock) |
| Text Continuity | **torph** | `torph/react` (`<TextMorph />`) | Dependency-free animated text morphing for labels, status pills, and buttons |
| Charts & Gauges | **bklit-ui** | `@bklit/line-chart`, `@bklit/gauge` | Live Line Chart for RTT latency and sync propagation; Gauge for chaos storm results |
| Loading / Chaos | **thinking-orbs** | 2D Canvas in `components/ui/` | Ambient orbital canvas animation for connecting, reconnecting, and storm states |
| Motion | **motion** | `framer-motion` (`LazyMotion`) | Layout & presence transitions only. All standard hover/focus states use pure CSS transitions |
| Micro-Interactions | **React Bits** | Verified OSS components | Count Up (latency ticker), Hold Button (hold to kick confirmation). Direct instant `<TextMorph>` for copy |
| Smooth Scroll | **Lenis** | `@darkroom.engineering/lenis` | **Landing page only (`/`)**. Strictly disabled in workspace to protect editor wheel events |
| Landing Blocks | **Tailark OSS** | `components/landing/` | Restyled with design tokens; collectui footers for layout reference |
| Editor | **CodeMirror 6** | `@codemirror/*`, `y-codemirror.next` | CRDT collaborative editor with syntax highlighting, remote cursors, and line highlights |

---

## 3. Detailed Specification Suite

For full implementation blueprints, wireframes, and schemas, refer to the dedicated specification documents in [`docs/ui-ux/`](ui-ux/):

1. **[01 — Design Tokens and Dual-Theme System](ui-ux/01-design-tokens-and-themes.md)**: Semantic OKLCH scales, light/dark variables, presence palette, typography hierarchy, and zero-emoji standard.
2. **[02 — Component Library Specifications](ui-ux/02-component-library-specs.md)**: Deep integration specs for Radix, Hugeicons, theSVG, morphicons, torph (`<TextMorph />`), bklit-ui, thinking-orbs, and React Bits.
3. **[03 — Views and Screen Layouts](ui-ux/03-views-and-screen-layouts.md)**: Desktop resizable 3-pane workspace, small screen viewport barrier (`<ScreenTooSmallGate />`), landing hero, join gate, overlays, and edge states.
4. **[04 — Settings and Theme Quick-Picker](ui-ux/04-settings-and-theme-picker.md)**: VS Code-style `⌘K` Theme QuickPick with live keyboard preview, modal tabs, and preference schema.
5. **[05 — Sandboxed Live Preview and DevTools Console](ui-ux/05-sandbox-preview-and-console.md)**: Client-side sandboxed iframe (`sandbox="allow-scripts"` with opaque origin), Web Worker JS/TS runner with 5-second infinite-loop watchdog, and DevTools console UI.

---

## 4. Locked Decisions (ADR-016)

1. **Dark Default with Full Semantic Light Mode**: Default is Quiet Dark, with equal-citizen Quiet Light and High Contrast themes selectable via the theme switcher.
2. **Client-Side Live Preview + DevTools Console**: Sandboxed iframe preview for HTML/CSS/JS and Web Worker execution with a 5-second watchdog timer. Absolutely zero server-side shell or code execution.
3. **Exclusive Icon Family**: Hugeicons stroke-rounded replaces Lucide entirely. Brand logos use theSVG.
4. **Dual Morphing System**: `morphicons` handles vector path morphs while `torph` (`<TextMorph />`) handles character-level text transitions.
