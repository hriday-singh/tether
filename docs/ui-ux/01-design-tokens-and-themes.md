# 01 — Design Tokens and Dual-Theme System

This document specifies the global token hierarchy, semantic color scales, typography rules, zero-emoji policy, and dual-theme engine (Dark default + equivalent Light mode) for the collaborative workspace.

---

## 1. Global CSS Variable Architecture

All styling across the application is driven by CSS variables declared in `globals.css` and referenced through Tailwind CSS utility classes. **No component ever hardcodes hex codes, raw RGB values, or ad-hoc pixel values.**

### Color System (OKLCH)

We use OKLCH for predictable perceptual uniformity across luminance, chroma, and hue.

```css
:root {
  /* =======================================================================
     LIGHT THEME (Quiet Light) - Clean, warm paper aesthetic
     ======================================================================= */
  --background: oklch(0.985 0.002 240);
  --foreground: oklch(0.18 0.01 240);

  --card: oklch(0.995 0.001 240);
  --card-foreground: oklch(0.18 0.01 240);

  --popover: oklch(0.995 0.001 240);
  --popover-foreground: oklch(0.18 0.01 240);

  /* Primary Accent: Electric Sky */
  --primary: oklch(0.55 0.16 230);
  --primary-foreground: oklch(0.99 0 0);

  --secondary: oklch(0.94 0.005 240);
  --secondary-foreground: oklch(0.25 0.01 240);

  --muted: oklch(0.94 0.005 240);
  --muted-foreground: oklch(0.48 0.01 240);

  --accent: oklch(0.92 0.01 230);
  --accent-foreground: oklch(0.20 0.02 230);

  --destructive: oklch(0.58 0.22 25);
  --destructive-foreground: oklch(0.99 0 0);

  --success: oklch(0.60 0.18 145);
  --success-foreground: oklch(0.99 0 0);

  --warning: oklch(0.68 0.18 80);
  --warning-foreground: oklch(0.15 0.05 80);

  --border: oklch(0.88 0.005 240);
  --input: oklch(0.88 0.005 240);
  --ring: oklch(0.55 0.16 230);

  /* CodeMirror Editor Surface (Light) */
  --editor-bg: oklch(0.99 0.001 240);
  --editor-line-number: oklch(0.60 0.01 240);
  --editor-active-line: oklch(0.96 0.005 240);
  --editor-gutter-border: oklch(0.90 0.005 240);
  --editor-selection: oklch(0.88 0.04 230);

  --radius: 0.5rem;
}

.dark {
  /* =======================================================================
     DARK THEME (Quiet Dark) - Deep charcoal / near-black surfaces
     ======================================================================= */
  --background: oklch(0.14 0.01 260);
  --foreground: oklch(0.95 0.005 260);

  --card: oklch(0.17 0.01 260);
  --card-foreground: oklch(0.95 0.005 260);

  --popover: oklch(0.17 0.01 260);
  --popover-foreground: oklch(0.95 0.005 260);

  /* Primary Accent: Electric Sky */
  --primary: oklch(0.78 0.14 230);
  --primary-foreground: oklch(0.12 0.01 260);

  --secondary: oklch(0.22 0.01 260);
  --secondary-foreground: oklch(0.90 0.005 260);

  --muted: oklch(0.20 0.01 260);
  --muted-foreground: oklch(0.65 0.01 260);

  --accent: oklch(0.24 0.02 230);
  --accent-foreground: oklch(0.92 0.02 230);

  --destructive: oklch(0.62 0.22 25);
  --destructive-foreground: oklch(0.98 0 0);

  --success: oklch(0.72 0.18 145);
  --success-foreground: oklch(0.12 0.01 145);

  --warning: oklch(0.78 0.18 80);
  --warning-foreground: oklch(0.15 0.05 80);

  --border: oklch(0.24 0.01 260);
  --input: oklch(0.24 0.01 260);
  --ring: oklch(0.78 0.14 230);

  /* CodeMirror Editor Surface (Dark) */
  --editor-bg: oklch(0.12 0.01 260);
  --editor-line-number: oklch(0.45 0.01 260);
  --editor-active-line: oklch(0.16 0.01 260);
  --editor-gutter-border: oklch(0.20 0.01 260);
  --editor-selection: oklch(0.25 0.04 230);
}

.contrast-dark {
  /* High Contrast Dark */
  --background: oklch(0.08 0 0);
  --foreground: oklch(1 0 0);
  --card: oklch(0.10 0 0);
  --border: oklch(0.40 0 0);
  --primary: oklch(0.85 0.16 230);
}

.contrast-light {
  /* High Contrast Light */
  --background: oklch(1 0 0);
  --foreground: oklch(0 0 0);
  --card: oklch(0.98 0 0);
  --border: oklch(0.20 0 0);
  --primary: oklch(0.45 0.20 230);
}
```

---

## 2. Accessible Presence Palette (Remote Cursors & Selections)

Each user joining a room is assigned one of 8 deterministic presence colors based on their session index. Each token provides guaranteed WCAG AA contrast (≥ 4.5:1) for flag text and smooth selection backgrounds in both light and dark modes:

| Slot | Color Name | Dark Mode Value | Light Mode Value | Usage |
|---|---|---|---|---|
| `p1` | Azure | `oklch(0.78 0.14 230)` | `oklch(0.55 0.16 230)` | Cursor flag, caret, selection tint |
| `p2` | Emerald | `oklch(0.78 0.15 150)` | `oklch(0.52 0.16 150)` | Cursor flag, caret, selection tint |
| `p3` | Amber | `oklch(0.80 0.15 75)` | `oklch(0.48 0.16 75)` | Cursor flag, caret, selection tint (darkened for AA ≥ 5:1 contrast against light surface) |
| `p4` | Violet | `oklch(0.76 0.15 290)` | `oklch(0.54 0.16 290)` | Cursor flag, caret, selection tint |
| `p5` | Rose | `oklch(0.75 0.16 10)` | `oklch(0.55 0.17 10)` | Cursor flag, caret, selection tint |
| `p6` | Cyan | `oklch(0.80 0.13 200)` | `oklch(0.53 0.14 200)` | Cursor flag, caret, selection tint |
| `p7` | Orange | `oklch(0.78 0.16 50)` | `oklch(0.54 0.17 50)` | Cursor flag, caret, selection tint |
| `p8` | Lime | `oklch(0.82 0.16 125)` | `oklch(0.52 0.16 125)` | Cursor flag, caret, selection tint |

Selection tints render at `0.18` opacity in dark mode and `0.22` opacity in light mode to prevent masking underlying syntax highlighting. Remote cursor flags render with a solid presence pill background paired with high-contrast text ink (`oklch(0.99 0 0)` or `oklch(0.18 0.01 240)`), guaranteeing WCAG AA compliance across all 8 slots.

---

## 3. Typography Scale & Font Pairing

We use self-hosted fonts packaged via `next/font/local` to guarantee privacy, deterministic metrics, and zero layout shift.

```typescript
// apps/web/app/fonts.ts
import localFont from 'next/font/local';

export const fontSans = localFont({
  src: [
    { path: '../public/fonts/Geist-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/Geist-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../public/fonts/Geist-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-sans',
  display: 'swap',
});

export const fontMono = localFont({
  src: [
    { path: '../public/fonts/GeistMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/GeistMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-mono',
  display: 'swap',
});
```

### Scale & Application

* **UI Labels & Body**: `Geist Sans`
  * Micro (Status bar, badges): `11px / 1.3`, weight `500`
  * Caption (Secondary labels, breadcrumbs): `12px / 1.4`, weight `400`
  * Body (Buttons, dialog text, tabs): `13px / 1.5`, weight `400` & `500`
  * Title (Dialog titles, section headers): `15px / 1.4`, weight `600`
* **Code & Tabular Numbers**: `Geist Mono`
  * CodeMirror Editor: `13px / 1.6` (`font-mono`, `font-feature-settings: 'tnum', 'zero'`)
  * Latency Ticker / Op Counters: `12px / 1.4` with `font-variant-numeric: tabular-nums`
  * DevTools Console: `12px / 1.5`

---

## 4. Strict Zero-Emoji Standard

**Rule**: No Unicode emojis may be used anywhere in the product UI, toast messages, error banners, avatar placeholders, or empty states.

### Rationale
1. Emojis look drastically different across operating systems (macOS vs Windows vs Android).
2. Emojis clash with the minimal, premium "Quiet IDE" aesthetic.
3. Accessible vector SVGs with semantic stroke weights convey status crisply and professionally.

### Replacements Table

| Previous Thought | Approved SVG Replacement | Library & Component |
|---|---|---|
| Hand wave "👋 Hriday joined" | `UserAdd01Icon` | `Hugeicons stroke-rounded` |
| Lightning "⚡ Reconnected" | `FlashIcon` | `Hugeicons stroke-rounded` |
| Checkmark "✓ Verified" | `CheckmarkCircle02Icon` | `Hugeicons stroke-rounded` |
| Warning "⚠️ Throttled" | `AlertCircleIcon` | `Hugeicons stroke-rounded` |
| Lock "🔒 Passcode set" | `LockKeyIcon` | `Hugeicons stroke-rounded` |
| Robot "🤖 Bot Storm" | `CpuIcon` or `AiBotIcon` | `Hugeicons stroke-rounded` |
| Bug / Error "❌ Sync error" | `CancelCircleIcon` | `Hugeicons stroke-rounded` |
| File / Code types | Language Vector Logos | `theSVG` brand SVGs |

---

## 5. Border Radius & Inset Panel Geometry

To avoid the boxy, sharp-edged feel of legacy editors while maintaining architectural precision, Tether uses an **Inset Floating Card Layout** with balanced, continuous corner curves (squircle-like feel).

### Radius Scale

| Token | Pixels | Usage |
|---|---|---|
| `rounded-sm` | `4px` | Small tooltips, sub-pixel indicator dots |
| `rounded-md` | `6px` | Inline code chips, context menu items, gutter fold markers |
| `rounded-lg` | `8px` | Secondary buttons, dropdown triggers, segmented tab options |
| `rounded-xl` | `12px` | Primary buttons, text inputs, search fields, top & status capsule bars |
| `rounded-2xl` | `16px` | **Major Floating Panes**: CodeMirror editor card, Live Preview panel, Sidebar card, Bottom Drawer card, `⌘K` Palette, Settings Modal |
| `rounded-full` | `9999px` | **All Status Badges & Pills**: "Verified in sync", "24 ms", Room ID pill, avatar circles, presence badges, segmented pill sliders |

### Inset Well Architecture
Instead of rigid 0px edge-to-edge square panels touching the browser frame:
- The outer viewport provides a `p-2` to `p-2.5` padded background well (`bg-background`).
- Each workspace pane (Editor, Preview, Sidebar, Bottom Drawer) is rendered as a distinct **floating card** (`bg-card rounded-2xl border border-border/50 overflow-hidden`).
- Top Bar and Status Bar render as floating capsule containers (`rounded-xl` or `rounded-full`).

### Elevation & Borders (Strict Ghost-Card Prevention)
Surfaces use crisp architectural borders paired with tight, defined elevations (blur ≤ 6px, strictly avoiding wide ≥ 16px blur drop-shadow anti-patterns):
- **Default Card Elevation**: `box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.08); border: 1px solid var(--border);`
- **Floating Capsule Bars**: `box-shadow: 0 2px 6px -1px rgba(0, 0, 0, 0.12); border: 1px solid var(--border);`
- **Modal Overlays & Popovers**: `box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.20); border: 1px solid var(--border);`
