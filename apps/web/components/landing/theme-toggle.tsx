'use client';

import { Moon02Icon, Sun03Icon } from '@hugeicons/core-free-icons';
import { usePrefs } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { MorphIcon } from '@/components/ui/motion';
import { THEMES } from '@/lib/prefs';

/** Header quick toggle: dark and light variant of the current theme family. */
export function ThemeToggle() {
  const { prefs, setPrefs } = usePrefs();
  const dark = THEMES.find((t) => t.id === prefs.themeId)?.type === 'dark';
  const contrast = prefs.themeId.startsWith('contrast');
  const next = contrast ? (dark ? 'contrast-light' : 'contrast-dark') : dark ? 'quiet-light' : 'quiet-dark';
  return (
    <Button size="icon-sm" variant="ghost" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={() => setPrefs({ themeId: next })}>
      <MorphIcon icon={dark ? Sun03Icon : Moon02Icon} />
    </Button>
  );
}
