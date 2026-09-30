'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

// Code-split: the canvas orb only loads when a connecting/storm state actually shows it (docs/ui-ux/02 §4).
const Orb = dynamic(() => import('thinking-orbs').then((m) => m.ThinkingOrb), {
  ssr: false,
  // bg-current: the placeholder takes the parent's text color, same as the orb it stands in for.
  loading: () => <span className="block size-5 rounded-full bg-current opacity-40 animate-pulse-soft" />,
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

/**
 * thinking-orbs only accepts #hex / rgb(), but our tokens are oklch. Resolve the variable through the DOM,
 * then let a 1px canvas convert whatever color space it is into sRGB bytes.
 */
function tokenToRgb(token: string): string | undefined {
  const el = document.createElement('span');
  el.style.color = token;
  document.body.appendChild(el);
  const css = window.getComputedStyle(el).color;
  el.remove();
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return undefined;
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

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
  const [computedToneColor, setComputedToneColor] = useState<string | undefined>();

  useEffect(() => {
    if (color || !tone) return;
    const resolve = () => setComputedToneColor(tokenToRgb(TONE_TOKENS[tone]));
    resolve();
    // Tokens change with the theme: re-resolve so the orb keeps matching the pill text.
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
    return () => observer.disconnect();
  }, [tone, color]);

  const resolvedColor = color ?? computedToneColor;

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
