import type { Icon } from '@/components/ui/icon';
import type { UserPreferences } from '@/lib/prefs';
import type { Workspace, UIState } from './context';

export const CATEGORIES = [
  'Editor & Actions',
  'Navigation & Views',
  'Room & Collaboration',
  'Preferences & Appearance',
  'Advanced & Diagnostics',
] as const;

export type PaletteCategory = (typeof CATEGORIES)[number];

export interface PaletteCommand {
  id: string;
  category: PaletteCategory;
  icon: Parameters<typeof Icon>[0]['icon'];
  label: string;
  shortcut?: string;
  keywords: string[];
  priority: number;
  onSelect: () => void;
  settingsAction?: {
    label: string;
    section: 'editor' | 'appearance' | 'collab' | 'network';
  };
}

export interface BuildPaletteCommandsArgs {
  ws: Workspace;
  uiState: UIState;
  prefs: UserPreferences;
  setPrefs: (patch: Partial<UserPreferences>) => void;
  roster: ReturnType<Workspace['client']['roster']['get']>;
  room: ReturnType<Workspace['client']['room']['get']>;
  mod: string;
  onClose: () => void;
  routerPush: (path: string) => void;
}

export function scoreCommand(cmd: PaletteCommand, search: string): number {
  if (!search) return cmd.priority;

  const label = cmd.label.toLowerCase();
  const q = search.toLowerCase();

  // 1. Exact match on label
  if (label === q) {
    return 2000 + cmd.priority;
  }

  // 2. Exact match on any keyword
  if (cmd.keywords.some((kw) => kw.toLowerCase() === q)) {
    return 1800 + cmd.priority;
  }

  // 3. Label starts with search query (prefix)
  if (label.startsWith(q)) {
    return 1500 + cmd.priority;
  }

  // 4. Any word in label starts with query
  const words = label.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) {
    return 1200 + cmd.priority;
  }

  // 5. Any keyword starts with query
  if (cmd.keywords.some((kw) => kw.toLowerCase().startsWith(q))) {
    return 1000 + cmd.priority;
  }

  // 6. Label contains query
  const labelIndex = label.indexOf(q);
  if (labelIndex !== -1) {
    return 800 - labelIndex * 10 + cmd.priority;
  }

  // 7. Any keyword contains query
  const kwMatch = cmd.keywords.find((kw) => kw.toLowerCase().includes(q));
  if (kwMatch) {
    return 500 + cmd.priority;
  }

  // 8. Multi-token match: all tokens in search are present in label or keywords
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const combined = `${label} ${cmd.keywords.join(' ')}`.toLowerCase();
    const allMatch = tokens.every((token) => combined.includes(token));
    if (allMatch) {
      return 600 + cmd.priority;
    }
  }

  return 0;
}
