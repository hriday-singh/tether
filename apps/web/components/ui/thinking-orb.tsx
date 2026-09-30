'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// Code-split: the canvas orb only loads when a connecting/storm state actually shows it (docs/ui-ux/02 §4).
const Orb = dynamic(() => import('thinking-orbs').then((m) => m.ThinkingOrb), {
  ssr: false,
  loading: () => <span className="block size-5 rounded-full bg-primary/40 animate-pulse-soft" />,
});

export type OrbState = 'connecting' | 'working' | 'breathing' | 'searching' | 'weaving';
export type OrbTone = 'primary' | 'warning' | 'success' | 'destructive' | 'neutral';

const TONE_TOKENS: Record<OrbTone, string> = {
  primary: 'var(--primary)',
  warning: 'var(--warning)',
  success: 'var(--success)',
  destructive: 'var(--destructive)',
  neutral: 'var(--muted-foreground)',
};

/** `animated=false` (ambient animations off) falls back to a CSS pulse dot with zero JS. */
export function ThinkingOrb({
  state,
  tone,
  color,
  size = 20,
  animated = true,
  label,
  className,
}: {
  state: OrbState;
  tone?: OrbTone;
  color?: string;
  size?: 20 | 64;
  animated?: boolean;
  label: string;
  className?: string;
}) {
  const [resolvedColor, setResolvedColor] = useState<string | undefined>(color);

  useEffect(() => {
    if (color) {
      setResolvedColor(color);
      return;
    }
    const token = tone ? TONE_TOKENS[tone] : undefined;
    if (!token || typeof document === 'undefined') {
      setResolvedColor(undefined);
      return;
    }
    // Resolve computed color from CSS token so the canvas receives the theme-accurate RGB
    const el = document.createElement('span');
    el.style.color = token;
    document.body.appendChild(el);
    const computed = window.getComputedStyle(el).color;
    document.body.removeChild(el);
    setResolvedColor(computed);
  }, [tone, color]);

  if (!animated) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-block rounded-full bg-current opacity-85 animate-pulse-soft', size === 64 ? 'size-4' : 'size-2', className)}
      />
    );
  }
  return <Orb state={state} size={size} color={resolvedColor} aria-label={label} className={className} />;
}
