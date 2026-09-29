# 05 — Sandboxed Live Preview and DevTools Console

This document specifies the client-side sandboxed execution architecture, secure iframe live preview, infinite-loop watchdog protection, and DevTools console panel.

---

## 1. Security Architecture & Threat Model

To provide a safe, responsive coding and preview experience without exposing backend infrastructure or user credentials to arbitrary code execution, **all code execution is 100% client-side**.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Main Application Window (localhost:3000 / app.domain.com)              │
│ - Houses CRDT sync, WebSocket connections, Room Token, LocalStorage    │
├────────────────────────────────────────────────────────────────────────┤
│                               ▲ postMessage (structured clone)         │
│                               ▼                                        │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ Sandboxed Preview Frame                                            │ │
│ │ <iframe sandbox="allow-scripts" srcdoc="...">                      │ │
│ │ - Origin is "null" (opaque)                                        │ │
│ │ - CANNOT access parent window.localStorage or document.cookie      │ │
│ │ - CANNOT make authenticated same-origin API requests               │ │
│ │ - Injected postMessage interceptor captures console.* and errors   │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Sandbox Attribute Constraints
* `sandbox="allow-scripts"`: Permits JavaScript execution inside the iframe.
* **Excluded Attributes**:
  * `allow-same-origin` is **STRICTLY OMITTED**. This forces the browser to treat the iframe as having a unique opaque origin (`null`), preventing scripts in the iframe from reading the main application's cookies, session tokens, or `localStorage`.
  * `allow-top-navigation` is omitted (cannot redirect the parent window).
  * `allow-popups` is omitted.

---

## 2. Live HTML/CSS Preview Architecture

When a room's language is set to **HTML**, **CSS**, or **JavaScript**, an optional resizable preview pane mounts alongside the editor.

### Debounced Rendering Pipeline

```
CodeMirror Edit Event
       │
       ▼
300ms Debounce Timer (resets on typing)
       │
       ▼
Syntax Validation Check (basic HTML parsing)
       │
       ▼
Inject Console Interceptor Wrapper
       │
       ▼
Update <iframe srcdoc={compiledHtml}>
```

### Injected Interceptor Script

Before writing the user's code into `srcdoc`, the host prepends a minimal, non-blocking telemetry script that intercepts all console outputs and uncaught runtime errors:

```html
<script>
(function() {
  const origin = window.location.origin;
  function emit(type, args) {
    try {
      window.parent.postMessage({
        source: 'sandboxed-console',
        type: type,
        timestamp: Date.now(),
        payload: args.map(arg => {
          if (typeof arg === 'object' && arg !== null) {
            try { return JSON.parse(JSON.stringify(arg)); }
            catch(e) { return String(arg); }
          }
          return String(arg);
        })
      }, '*');
    } catch(err) {}
  }

  ['log', 'warn', 'error', 'info'].forEach(method => {
    const original = console[method];
    console[method] = function(...args) {
      emit(method, args);
      if (original) original.apply(console, args);
    };
  });

  window.onerror = function(message, source, lineno, colno, error) {
    emit('error', [message + ' (Line ' + lineno + ')']);
  };
})();
</script>
```

---

## 3. Web Worker Script Runner (JS/TS Mode)

For standalone JavaScript and TypeScript rooms, running full page reloads is noisy. Instead, code execution occurs inside an ephemeral Web Worker.

### 5-Second Watchdog Timer (Infinite Loop Guard)

To prevent browser tab freezes caused by `while(true) {}` loops, the runner spawns a worker with a strict 5000ms execution timeout:

```typescript
// packages/ui/lib/worker-runner.ts
export class SandboxedWorkerRunner {
  private activeWorker: Worker | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;

  public execute(code: string, onMessage: (log: any) => void, onComplete: () => void) {
    this.terminate();

    const workerScript = `
      self.onmessage = function(e) {
        const emit = (type, args) => self.postMessage({ type, args });
        console.log = (...args) => emit('log', args);
        console.warn = (...args) => emit('warn', args);
        console.error = (...args) => emit('error', args);

        try {
          const fn = new Function(e.data);
          fn();
        } catch(err) {
          emit('error', [err.message]);
        } finally {
          self.postMessage({ type: 'done' });
        }
      };
    `;

    const blob = new Blob([workerScript], { type: 'application/javascript' });
    this.activeWorker = new Worker(URL.createObjectURL(blob));

    // 5-second watchdog
    this.watchdogTimer = setTimeout(() => {
      this.terminate();
      onMessage({
        type: 'error',
        args: ['Execution timed out after 5000ms (potential infinite loop terminated).'],
      });
      onComplete();
    }, 5000);

    this.activeWorker.onmessage = (event) => {
      if (event.data.type === 'done') {
        this.terminate();
        onComplete();
      } else {
        onMessage(event.data);
      }
    };

    this.activeWorker.postMessage(code);
  }

  public terminate() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.activeWorker) {
      this.activeWorker.terminate();
      this.activeWorker = null;
    }
  }
}
```

---

## 4. DevTools Console UI Specification

The DevTools Console occupies a tab in the bottom resizable drawer, presenting a dark terminal-styled output interface:

* **Header Controls**:
  * Clear Console icon button (`Delete02Icon`).
  * Filter search input (filters logs by substring or regex).
  * Severity filters: `All`, `Errors`, `Warnings`, `Logs`.
* **Output Stream**:
  * Rendered with `Geist Mono` at `12px / 1.5`.
  * Severity color-coding:
    * `log`: `var(--foreground)`
    * `warn`: `var(--warning)` (`oklch(0.78 0.18 80)`) with `AlertCircleIcon`
    * `error`: `var(--destructive)` (`oklch(0.62 0.22 25)`) with `CancelCircleIcon`
  * Timestamps formatted as `HH:mm:ss.SSS` in `var(--muted-foreground)`.
* **Interactive REPL Input**:
  * An active prompt line at the bottom (`> `) allowing developers to type single-line expressions (e.g. `2 + 2` or `document.title`) and press Enter to evaluate inside the running context.
