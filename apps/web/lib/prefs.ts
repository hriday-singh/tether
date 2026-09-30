import { z } from 'zod';

export const THEMES = [
  { id: 'quiet-dark', name: 'Quiet Dark (Default)', type: 'dark' },
  { id: 'quiet-light', name: 'Quiet Light', type: 'light' },
  { id: 'contrast-dark', name: 'High Contrast Dark', type: 'dark' },
  { id: 'contrast-light', name: 'High Contrast Light', type: 'light' },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

export const PreferencesSchema = z.object({
  themeId: z.enum(['quiet-dark', 'quiet-light', 'contrast-dark', 'contrast-light']),
  uiScale: z.enum(['sm', 'md', 'lg']),
  editorFontSize: z.number().int().min(11).max(18),
  tabSize: z.union([z.literal(2), z.literal(4)]),
  wordWrap: z.boolean(),
  lineNumbers: z.boolean(),
  bracketColors: z.boolean(),
  reduceMotion: z.boolean(),
  ambientAnimations: z.boolean(),
  followUnlockOnInput: z.boolean(),
  cursorFlagFadeSeconds: z.number().min(1).max(5),
  offscreenCursorBadges: z.boolean(),
  telemetrySampling: z.boolean(),
  simulatedLatencyMs: z.number().int().min(0).max(500),
});
export type UserPreferences = z.infer<typeof PreferencesSchema>;

export const DEFAULT_PREFERENCES: UserPreferences = {
  themeId: 'quiet-dark',
  uiScale: 'md',
  editorFontSize: 13,
  tabSize: 2,
  wordWrap: false,
  lineNumbers: true,
  bracketColors: true,
  reduceMotion: false,
  ambientAnimations: true,
  followUnlockOnInput: true,
  cursorFlagFadeSeconds: 2,
  offscreenCursorBadges: true,
  telemetrySampling: true,
  simulatedLatencyMs: 0,
};

export const PREFS_KEY = 'ide-preferences';
export const THEME_KEY = 'ide-theme-id';

export function loadPreferences(): UserPreferences {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const merged = { ...DEFAULT_PREFERENCES, ...(raw ? (JSON.parse(raw) as object) : {}) };
    const parsed = PreferencesSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_PREFERENCES;
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: UserPreferences): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    localStorage.setItem(THEME_KEY, p.themeId);
  } catch {
    // storage full or blocked: preferences stay in memory for this tab
  }
}

export const THEME_CLASSES: Record<ThemeId, string[]> = {
  'quiet-dark': ['dark'],
  'quiet-light': [],
  'contrast-dark': ['dark', 'contrast-dark'],
  'contrast-light': ['contrast-light'],
};
const ALL_THEME_CLASSES = ['dark', 'contrast-dark', 'contrast-light'];

/** Applies a theme to <html> instantly (used for commit and for QuickPick live preview). */
export function applyTheme(themeId: ThemeId, root: HTMLElement = document.documentElement): void {
  root.classList.remove(...ALL_THEME_CLASSES);
  root.classList.add(...THEME_CLASSES[themeId]);
}

export function applyDocumentPrefs(p: UserPreferences, root: HTMLElement = document.documentElement): void {
  applyTheme(p.themeId, root);
  root.classList.remove('ui-scale-sm', 'ui-scale-lg');
  if (p.uiScale !== 'md') root.classList.add(`ui-scale-${p.uiScale}`);
  root.classList.toggle('reduce-motion', p.reduceMotion);
}

/** Inline <head> script: applies the stored theme before first paint (no flash). Kept dependency-free. */
export const THEME_BOOT_SCRIPT = `(function(){try{var m=${JSON.stringify(THEME_CLASSES)};var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}');var t=p.themeId||localStorage.getItem('${THEME_KEY}')||'quiet-dark';var c=m[t]||m['quiet-dark'];var r=document.documentElement;r.classList.remove('dark','contrast-dark','contrast-light');for(var i=0;i<c.length;i++)r.classList.add(c[i]);if(p.uiScale==='sm'||p.uiScale==='lg')r.classList.add('ui-scale-'+p.uiScale);if(p.reduceMotion)r.classList.add('reduce-motion');}catch(e){}})();`;
