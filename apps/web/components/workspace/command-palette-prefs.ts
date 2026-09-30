import {
  KeyboardIcon,
  PaintBoardIcon,
  Settings01Icon,
  SlidersHorizontalIcon,
  UserGroupIcon,
  Wifi01Icon,
} from '@hugeicons/core-free-icons';
import { toast } from '@/components/ui/toaster';
import type { UIState } from './context';
import type { BuildPaletteCommandsArgs, PaletteCommand } from './command-palette-types';

export function buildPreferenceAndDiagnosticCommands(
  args: BuildPaletteCommandsArgs,
  act: (fn: () => void) => () => void,
  ui: (patch: Partial<UIState>) => void,
): PaletteCommand[] {
  const { prefs, setPrefs, mod } = args;

  const togglePref = <
    K extends
      | 'ambientAnimations'
      | 'reduceMotion'
      | 'wordWrap'
      | 'lineNumbers'
      | 'bracketColors'
      | 'followUnlockOnInput'
      | 'offscreenCursorBadges'
      | 'telemetrySampling',
  >(
    key: K,
    name: string,
  ) => {
    const next = !prefs[key];
    setPrefs({ [key]: next });
    toast.success(`${name}: ${next ? 'Enabled' : 'Disabled'}`);
  };

  return [
    // Preferences & Appearance
    {
      id: 'pref:theme-picker',
      category: 'Preferences & Appearance',
      icon: PaintBoardIcon,
      label: 'Preferences: Color Theme',
      shortcut: `${mod} K ${mod} T`,
      keywords: ['theme', 'color', 'dark', 'light', 'appearance', 'palette', 'settings'],
      priority: 96,
      settingsAction: { label: 'Settings', section: 'appearance' },
      onSelect: () => ui({ palette: 'theme' }),
    },
    {
      id: 'pref:theme-quiet-dark',
      category: 'Preferences & Appearance',
      icon: PaintBoardIcon,
      label: 'Theme: Quiet Dark (Default)',
      keywords: ['quiet dark', 'dark theme', 'theme', 'color', 'appearance'],
      priority: 76,
      onSelect: act(() => {
        setPrefs({ themeId: 'quiet-dark' });
        toast.success('Theme set to Quiet Dark');
      }),
    },
    {
      id: 'pref:theme-quiet-light',
      category: 'Preferences & Appearance',
      icon: PaintBoardIcon,
      label: 'Theme: Quiet Light',
      keywords: ['quiet light', 'light theme', 'theme', 'color', 'appearance'],
      priority: 76,
      onSelect: act(() => {
        setPrefs({ themeId: 'quiet-light' });
        toast.success('Theme set to Quiet Light');
      }),
    },
    {
      id: 'pref:theme-contrast-dark',
      category: 'Preferences & Appearance',
      icon: PaintBoardIcon,
      label: 'Theme: High Contrast Dark',
      keywords: ['contrast dark', 'high contrast', 'dark theme', 'theme', 'accessibility'],
      priority: 74,
      onSelect: act(() => {
        setPrefs({ themeId: 'contrast-dark' });
        toast.success('Theme set to High Contrast Dark');
      }),
    },
    {
      id: 'pref:theme-contrast-light',
      category: 'Preferences & Appearance',
      icon: PaintBoardIcon,
      label: 'Theme: High Contrast Light',
      keywords: ['contrast light', 'high contrast', 'light theme', 'theme', 'accessibility'],
      priority: 74,
      onSelect: act(() => {
        setPrefs({ themeId: 'contrast-light' });
        toast.success('Theme set to High Contrast Light');
      }),
    },
    {
      id: 'pref:ui-scale-sm',
      category: 'Preferences & Appearance',
      icon: SlidersHorizontalIcon,
      label: 'UI Font Scale: Small',
      keywords: ['ui scale', 'font scale', 'small', 'zoom', 'appearance', 'settings'],
      priority: 72,
      onSelect: act(() => {
        setPrefs({ uiScale: 'sm' });
        toast.success('UI scale set to Small');
      }),
    },
    {
      id: 'pref:ui-scale-md',
      category: 'Preferences & Appearance',
      icon: SlidersHorizontalIcon,
      label: 'UI Font Scale: Medium (Default)',
      keywords: ['ui scale', 'font scale', 'medium', 'zoom', 'appearance', 'settings'],
      priority: 72,
      onSelect: act(() => {
        setPrefs({ uiScale: 'md' });
        toast.success('UI scale set to Medium');
      }),
    },
    {
      id: 'pref:ui-scale-lg',
      category: 'Preferences & Appearance',
      icon: SlidersHorizontalIcon,
      label: 'UI Font Scale: Large',
      keywords: ['ui scale', 'font scale', 'large', 'zoom', 'appearance', 'settings'],
      priority: 72,
      onSelect: act(() => {
        setPrefs({ uiScale: 'lg' });
        toast.success('UI scale set to Large');
      }),
    },

    // Advanced & Diagnostics
    {
      id: 'pref:ambient',
      category: 'Advanced & Diagnostics',
      icon: SlidersHorizontalIcon,
      label: `Ambient Animations: ${prefs.ambientAnimations ? 'On' : 'Off'}`,
      keywords: ['ambient animations', 'canvas', 'orbs', 'effects', 'appearance', 'settings'],
      priority: 56,
      onSelect: act(() => togglePref('ambientAnimations', 'Ambient animations')),
    },
    {
      id: 'pref:reduce-motion',
      category: 'Advanced & Diagnostics',
      icon: SlidersHorizontalIcon,
      label: `Reduce Motion: ${prefs.reduceMotion ? 'On' : 'Off'}`,
      keywords: ['reduce motion', 'motion', 'animations', 'transitions', 'accessibility', 'settings'],
      priority: 56,
      onSelect: act(() => togglePref('reduceMotion', 'Reduce motion')),
    },
    {
      id: 'pref:follow-unlock',
      category: 'Advanced & Diagnostics',
      icon: UserGroupIcon,
      label: `Unlock Follow on Input: ${prefs.followUnlockOnInput ? 'On' : 'Off'}`,
      keywords: ['unlock follow on input', 'follow', 'typing', 'scroll', 'collaboration', 'settings'],
      priority: 52,
      onSelect: act(() => togglePref('followUnlockOnInput', 'Unlock follow on input')),
    },
    {
      id: 'pref:offscreen-badges',
      category: 'Advanced & Diagnostics',
      icon: UserGroupIcon,
      label: `Off-Screen Cursor Badges: ${prefs.offscreenCursorBadges ? 'On' : 'Off'}`,
      keywords: ['off-screen cursor badges', 'cursor', 'presence', 'badges', 'collaboration', 'settings'],
      priority: 52,
      onSelect: act(() => togglePref('offscreenCursorBadges', 'Off-screen cursor badges')),
    },
    {
      id: 'pref:cursor-fade',
      category: 'Advanced & Diagnostics',
      icon: UserGroupIcon,
      label: `Cursor Name Fade: ${prefs.cursorFlagFadeSeconds.toFixed(1)}s (Click to Cycle)`,
      keywords: ['cursor name fade', 'cursor', 'presence', 'flag', 'fade', 'duration', 'collaboration', 'settings'],
      priority: 52,
      onSelect: act(() => {
        const next = prefs.cursorFlagFadeSeconds >= 5 ? 1 : prefs.cursorFlagFadeSeconds + 1;
        setPrefs({ cursorFlagFadeSeconds: next });
        toast.success(`Cursor name fade: ${next}s`);
      }),
    },
    {
      id: 'net:telemetry',
      category: 'Advanced & Diagnostics',
      icon: Wifi01Icon,
      label: `Live Latency Sampling: ${prefs.telemetrySampling ? 'On' : 'Off'}`,
      keywords: ['live latency sampling', 'telemetry', 'sampling', 'rtt', 'ping', 'network', 'settings'],
      priority: 50,
      onSelect: act(() => togglePref('telemetrySampling', 'Live latency sampling')),
    },
    {
      id: 'net:latency-reset',
      category: 'Advanced & Diagnostics',
      icon: Wifi01Icon,
      label: `Reset Simulated Latency to 0 ms (Current: ${prefs.simulatedLatencyMs}ms)`,
      keywords: ['reset simulated latency', 'latency', 'network', 'delay', 'jitter', 'settings'],
      priority: 48,
      onSelect: act(() => {
        setPrefs({ simulatedLatencyMs: 0 });
        toast.success('Simulated latency reset to 0ms');
      }),
    },
    {
      id: 'net:latency-50',
      category: 'Advanced & Diagnostics',
      icon: Wifi01Icon,
      label: 'Simulated Latency: 50 ms (Mild jitter)',
      keywords: ['simulated latency 50ms', 'latency', 'network', 'delay', 'settings'],
      priority: 42,
      onSelect: act(() => {
        setPrefs({ simulatedLatencyMs: 50 });
        toast.success('Simulated latency set to 50ms');
      }),
    },
    {
      id: 'net:latency-150',
      category: 'Advanced & Diagnostics',
      icon: Wifi01Icon,
      label: 'Simulated Latency: 150 ms (Cross-region demo)',
      keywords: ['simulated latency 150ms', 'latency', 'network', 'delay', 'settings'],
      priority: 42,
      onSelect: act(() => {
        setPrefs({ simulatedLatencyMs: 150 });
        toast.success('Simulated latency set to 150ms');
      }),
    },

    // Settings & Shortcuts dialog openers
    {
      id: 'help:settings',
      category: 'Preferences & Appearance',
      icon: Settings01Icon,
      label: 'Open Settings Dialog',
      shortcut: `${mod} ,`,
      keywords: ['settings', 'preferences', 'dialog', 'modal', 'options', 'config'],
      priority: 95,
      onSelect: act(() => ui({ settings: true, settingsSection: 'appearance' })),
    },
    {
      id: 'help:shortcuts',
      category: 'Preferences & Appearance',
      icon: KeyboardIcon,
      label: 'Keyboard shortcuts',
      shortcut: '?',
      keywords: ['keyboard', 'shortcuts', 'help', 'hotkeys'],
      priority: 90,
      onSelect: act(() => ui({ shortcuts: true })),
    },
  ];
}
