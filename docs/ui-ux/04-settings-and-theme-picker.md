# 04: Settings and Theme Quick-Picker

This document specifies the theme switching engine, the VS Code-style `⌘K` Theme QuickPick, and the comprehensive user settings modal.

---

## 1. Theme Engine & State Management

The workspace supports instantaneous, flicker-free theme switching across 4 curated themes using CSS class scoping on the `<html>` root element.

### Supported Themes

| Theme ID | Display Name | Root CSS Class | Background Surface | Text Foreground | Border Color |
|---|---|---|---|---|---|
| `quiet-dark` | **Quiet Dark (Default)** | `.dark` | `oklch(0.14 0.01 260)` | `oklch(0.95 0.005 260)` | `oklch(0.24 0.01 260)` |
| `quiet-light` | **Quiet Light** | `:root` (clean) | `oklch(0.985 0.002 240)`| `oklch(0.18 0.01 240)` | `oklch(0.88 0.005 240)` |
| `contrast-dark` | **High Contrast Dark** | `.dark .contrast-dark` | `oklch(0.08 0 0)` | `oklch(1 0 0)` | `oklch(0.40 0 0)` |
| `contrast-light` | **High Contrast Light** | `.contrast-light` | `oklch(1 0 0)` | `oklch(0 0 0)` | `oklch(0.20 0 0)` |

### Persistence & Storage
* Active theme is stored in `localStorage.getItem('ide-theme-id')`.
* An inline script in Next.js `<head>` reads `localStorage` before paint to eliminate flash of unstyled content (FOUC).

---

## 2. VS Code-Style Theme QuickPick (`⌘K ⌘T` / Command Palette)

![Command Palette and Preferences](../assets/command-palette.png)

To mimic the intuitive ergonomics of VS Code, developers can open the Theme QuickPick from the `⌘K` Command Palette or via direct shortcut `⌘K ⌘T`.

### Interactive Preview on Arrow Navigation

When the user moves the arrow keys up and down through the list of themes:
1. **Live Preview**: The document theme updates **immediately** as the item is highlighted, allowing the user to preview how their code looks under that theme without committing.
2. **Commit on Enter**: Pressing `Enter` commits the theme to `localStorage` and closes the palette.
3. **Revert on Esc**: Pressing `Escape` cancels the picker and reverts the theme back to what it was before opening the QuickPick.

### Implementation Blueprint (`cmdk` Integration)

```tsx
// packages/ui/components/theme-quick-pick.tsx
import * as React from 'react';
import { Command, CommandInput, CommandList, CommandItem } from './command';
import { CheckmarkCircle02Icon } from '@hugeicons/react';

interface ThemeOption {
  id: string;
  name: string;
  type: 'dark' | 'light';
}

const THEMES: ThemeOption[] = [
  { id: 'quiet-dark', name: 'Quiet Dark (Default)', type: 'dark' },
  { id: 'quiet-light', name: 'Quiet Light', type: 'light' },
  { id: 'contrast-dark', name: 'High Contrast Dark', type: 'dark' },
  { id: 'contrast-light', name: 'High Contrast Light', type: 'light' },
];

export function ThemeQuickPick({
  currentTheme,
  onSelectTheme,
  onClose,
}: {
  currentTheme: string;
  onSelectTheme: (themeId: string) => void;
  onClose: () => void;
}) {
  const initialTheme = React.useRef(currentTheme);
  const [activePreview, setActivePreview] = React.useState(currentTheme);

  // Apply preview to DOM immediately on highlight
  React.useEffect(() => {
    document.documentElement.dataset.theme = activePreview;
  }, [activePreview]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      document.documentElement.dataset.theme = initialTheme.current;
      onClose();
    }
  };

  return (
    <Command onKeyDown={handleKeyDown} className="max-w-md border border-border bg-popover">
      <CommandInput placeholder="Select Color Theme (Up/Down to preview, Enter to select)..." />
      <CommandList>
        {THEMES.map((theme) => (
          <CommandItem
            key={theme.id}
            value={theme.id}
            onSelect={() => {
              onSelectTheme(theme.id);
              onClose();
            }}
            onFocus={() => setActivePreview(theme.id)}
            className="flex items-center justify-between text-xs font-mono"
          >
            <span>{theme.name}</span>
            {theme.id === currentTheme && (
              <CheckmarkCircle02Icon size={14} className="text-primary" />
            )}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
```

---

## 3. Settings Dialog (`⌘,` / Gear Icon)

The Settings dialog provides a centered, tabbed modal to configure editor preferences, display ergonomics, and telemetry collection.

### Tab 1: Appearance & Themes
* **Color Theme**: Dropdown selecting between Quiet Dark, Quiet Light, High Contrast Dark, High Contrast Light.
* **UI Font Scale**: Slider / segmented control: Small (`12px`), Medium (`13px`, default), Large (`14px`).
* **Motion & Animations**: Toggle to enable/disable ambient canvas animations (`thinking-orbs`).

### Tab 2: Editor Preferences
* **Code Font Size**: Number input / slider from `11px` to `18px` (default `13px`).
* **Tab Size**: Segmented toggle: `2 Spaces` (default) vs `4 Spaces`.
* **Word Wrapping**: Toggle: `Wrap at viewport boundary` vs `Horizontal scroll`.
* **Line Numbers**: Toggle: `Show line numbers` (default `true`).
* **Bracket Pair Colorization**: Toggle (default `true`).

### Tab 3: Collaboration & Follow Mode
* **Follow Mode Behavior**: Option to auto-unlock follow mode when local user types or scrolls.
* **Cursor Flag Idle Timeout**: Slider: `1.0s` to `5.0s` (default `2.0s`) before remote cursor name tags fade out.
* **Off-Screen Cursor Badges**: Toggle to pin collaborator pointers to the top/bottom editor margins.

### Tab 4: Network & Telemetry Lab
* **Live Latency Sampling**: Toggle to plot RTT live in the bottom diagnostics drawer (default `true`).
* **Simulated Network Latency (Demo Tool)**: Slider to artificially inject 50ms-500ms delay into WebSocket transmission to demonstrate convergence and honest connection UI.

---

## 4. Preference Storage Schema

All user preferences serialize into a single schema stored under `localStorage.getItem('ide-preferences')`:

```typescript
export interface UserPreferences {
  themeId: 'quiet-dark' | 'quiet-light' | 'contrast-dark' | 'contrast-light';
  editorFontSize: number;      // 11 - 18
  tabSize: 2 | 4;
  wordWrap: boolean;
  lineNumbers: boolean;
  reduceMotion: boolean;
  cursorFlagFadeSeconds: number;
  telemetrySampling: boolean;
  simulatedLatencyMs: number;  // 0 = off
}
```
