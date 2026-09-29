# 02 — Component Library Specifications

This document specifies the exact third-party libraries, UI primitives, icon families, micro-interaction components, and dual-morphing tools used to build Tether.

---

## 1. Verified Library Matrix

| Category | Library | Package / Source | Purpose & Usage Bounds |
|---|---|---|---|
| **Primitives** | Radix UI via `shadcn/ui` | `@radix-ui/*`, `shadcn` CLI | Accessible foundations for Dialog, Sheet, DropdownMenu, Tooltip, Sonner, Command (`cmdk`), Resizable, and InputOTP. |
| **UI Iconography** | `Hugeicons stroke-rounded` | `@hugeicons/react`, `@hugeicons/core-free-icons` | Single UI icon family. 24×24 stroke-rounded icons for all controls, navigation, and feedback. Zero Lucide mixing. |
| **Language Logos** | `theSVG` | Raw SVGs in `components/icons/brands/` | Authentic language badges for TypeScript, JavaScript, Python, HTML5, CSS3, Go, Rust, Markdown, and SQL. |
| **Icon Path Morphs** | `morphicons` | `morphicons` (6 kB) | Smooth SVG morphs between icon pairs: Copy ➔ Check, Play ➔ Stop, Lock ➔ Unlock, Menu ➔ Close. |
| **Text Continuity** | `torph` | `torph/react` (`<TextMorph />`) | Dependency-free animated text continuity component. Character-level morphing for state labels and tickers. |
| **Live Metrics & Charts**| `bklit-ui` | `@bklit/line-chart`, `@bklit/gauge` | Real-time RTT latency & propagation line charts in the Sync Diagnostics drawer; gauge for chaos storm convergence. |
| **Thinking Animation** | `thinking-orbs` | Canvas utility in `components/ui/thinking-orb.tsx` | Lightweight 2D canvas orb for room connection, reconnecting, and bot storm simulation states. |
| **Micro-Interactions** | `React Bits` | Verified OSS snippets in `components/ui/` | Count Up (latency millisecond counter), Hold Button (host kick confirmation). Scrambled text effects are strictly omitted in favor of instant `<TextMorph>` copy feedback. |
| **Smooth Scroll** | `Lenis` | `@darkroom.engineering/lenis` | **Landing page only (`/`)**. Strictly disabled inside the workspace to prevent hijacking CodeMirror scroll events. |
| **Layout Motion** | `motion` | `framer-motion` (`LazyMotion` + `domAnimation`) | Presence avatar entry/exit and panel transitions only. All standard hover/focus states use CSS transitions. |
| **Code Editor** | `CodeMirror 6` | `@codemirror/*`, `y-codemirror.next` | Core real-time CRDT editor with syntax highlighting, remote presence flags, active line highlight, and bracket matching. |

---

## 2. Dual Morphing Architecture (`morphicons` + `torph`)

To achieve maximum visual polish without abrupt layout jumps, dynamic status badges and interactive buttons combine **vector path morphing** with **text character morphing**.

```
┌─────────────────────────────────────────────────────────────┐
│  [ CopyIcon ➔ CheckmarkIcon ]   "Copy Room ID" ➔ "Copied!"  │
│         (morphicons)                (torph / TextMorph)      │
└─────────────────────────────────────────────────────────────┘
```

### Morphing Action Button Example

```tsx
// packages/ui/components/morphing-action.tsx
import * as React from 'react';
import { TextMorph } from 'torph/react';
import { MorphIcon } from 'morphicons';
import { Button } from './button';

interface MorphingActionProps {
  iconBefore: string; // SVG path data
  iconAfter: string;  // SVG path data
  textBefore: string;
  textAfter: string;
  isTriggered: boolean;
  onAction?: () => void;
}

export function MorphingAction({
  iconBefore,
  iconAfter,
  textBefore,
  textAfter,
  isTriggered,
  onAction,
}: MorphingActionProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onAction}
      className="inline-flex items-center gap-1.5 font-mono text-xs"
    >
      <MorphIcon
        from={iconBefore}
        to={iconAfter}
        progress={isTriggered ? 1 : 0}
        size={14}
        strokeWidth={1.5}
      />
      <TextMorph>{isTriggered ? textAfter : textBefore}</TextMorph>
    </Button>
  );
}
```

### Key Use Cases
1. **Room ID Copy**: `Copy01Icon` + "Copy ID" ➔ `Tick01Icon` + "Copied!" (reverts after 2000ms).
2. **Sync Status Pill**: `RefreshIcon` + "Syncing..." ➔ `CheckmarkCircle02Icon` + "Verified in sync".
3. **Throttled State**: `Pulse01Icon` + "5 ops/s" ➔ `AlertCircleIcon` + "Throttled (5/5)".
4. **Code Execution**: `PlayIcon` + "Run Code" ➔ `StopIcon` + "Executing...".
5. **Chaos Storm**: `CpuIcon` + "Launch Storm" ➔ `AiBotIcon` + "8 Bots Active".

---

## 3. Real-Time Telemetry & Charts (`bklit-ui` + React Bits)

The Sync Diagnostics panel displays live connection health, round-trip time (RTT), and CRDT update propagation delay.

### Live Line Chart Component

```tsx
// packages/ui/components/charts/latency-chart.tsx
import * as React from 'react';
import { LineChart } from '@bklit/line-chart';
import { CountUp } from '../react-bits/count-up';

interface LatencyChartProps {
  samples: Array<{ timestamp: number; rttMs: number; propagationMs: number }>;
  currentRtt: number;
}

export function LatencyChart({ samples, currentRtt }: LatencyChartProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Round-Trip Time (p95)</span>
        <span className="font-mono font-medium text-foreground">
          <CountUp to={currentRtt} duration={0.4} /> ms
        </span>
      </div>
      <div className="h-28 w-full">
        <LineChart
          data={samples}
          xKey="timestamp"
          series={[
            { key: 'rttMs', color: 'var(--primary)', label: 'RTT' },
            { key: 'propagationMs', color: 'var(--success)', label: 'Sync Delay' },
          ]}
          grid={false}
          tooltip
        />
      </div>
    </div>
  );
}
```

---

## 4. Connection & Chaos State Canvas (`thinking-orbs`)

A 2D HTML5 canvas component simulates fluid, glowing orbs representing background activity without taxing GPU resources or triggering layout re-renders:

* **States**:
  * `idle`: Low pulse frequency, opacity `0.4`, accent tint.
  * `connecting` / `reconnecting`: Dual spinning orbits with smooth easing.
  * `storm-active`: Turbulent multi-particle pulse during bot storm execution.
* **Performance & Bundle Discipline**:
  * Pauses rendering via `requestAnimationFrame` when tab is in background or element is off-screen (`IntersectionObserver`). Respects `prefers-reduced-motion`.
  * **Strict Code-Splitting**: Both `thinking-orbs` and `@bklit/*` chart packages are dynamically imported via `next/dynamic({ ssr: false })` and only mounted when their respective diagnostics drawer or storm modal is opened.
  * **Zero-JS Fallback**: Default status pills use a hardware-accelerated CSS keyframe pulse (`opacity` / `transform` only) to ensure zero bundle penalty for everyday editing sessions.

---

## 5. Destructive Confirmations (React Bits Hold Button)

To prevent accidental room moderation mistakes, dangerous host actions (kicking a member, resetting room state, rotating room passcode) use the **Hold to Confirm** interaction pattern.

```tsx
// packages/ui/components/react-bits/hold-button.tsx
import * as React from 'react';
import { UserMinus01Icon } from '@hugeicons/react';

interface HoldButtonProps {
  onConfirm: () => void;
  holdDurationMs?: number;
  label: string;
}

export function HoldToKickButton({ onConfirm, holdDurationMs = 1200, label }: HoldButtonProps) {
  const [progress, setProgress] = React.useState(0);
  // ... timer logic handles mouse/touch down and triggers onConfirm at progress === 1
  return (
    <button
      className="relative overflow-hidden rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20"
    >
      <div
        className="absolute inset-y-0 left-0 bg-destructive/30 transition-all duration-75"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative z-10 flex items-center gap-1.5">
        <UserMinus01Icon size={14} />
        {progress > 0 ? 'Hold to Kick...' : label}
      </span>
    </button>
  );
}
```

---

## 6. Icon System Architecture

All icons import strictly from `@hugeicons/react`:

```typescript
// Good - Uniform design system
import {
  Code01Icon,
  PlayIcon,
  Settings01Icon,
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  UserGroupIcon,
  TerminalIcon,
} from '@hugeicons/react';

// Disallowed: Lucide or emoji
// import { Check, AlertTriangle } from 'lucide-react'; // FORBIDDEN
// <span>✅</span> // FORBIDDEN
```
