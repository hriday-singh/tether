import { applyTheme, DEFAULT_PREFERENCES, loadPreferences, PREFS_KEY, savePreferences } from './prefs';

describe('preferences', () => {
  beforeEach(() => localStorage.clear());

  it('falls back to defaults on corrupt or out-of-range storage', () => {
    localStorage.setItem(PREFS_KEY, '{not json');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    localStorage.setItem(PREFS_KEY, JSON.stringify({ editorFontSize: 99 }));
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('round-trips and merges new defaults into old saved prefs', () => {
    savePreferences({ ...DEFAULT_PREFERENCES, tabSize: 4 });
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY)!);
    delete stored.bracketColors;
    localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
    expect(loadPreferences()).toEqual({ ...DEFAULT_PREFERENCES, tabSize: 4 });
  });

  it('swaps theme classes without leaving stale ones', () => {
    const el = document.createElement('html');
    applyTheme('contrast-dark', el);
    expect([...el.classList]).toEqual(['dark', 'contrast-dark']);
    applyTheme('quiet-light', el);
    expect([...el.classList]).toEqual([]);
  });
});
