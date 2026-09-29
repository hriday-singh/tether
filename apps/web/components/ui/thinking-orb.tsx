'use client';

import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

// Code-split: the canvas orb only loads when a connecting/storm state actually shows it (docs/ui-ux/02 §4).
const Orb = dynamic(() => import('thinking-orbs').then((m) => m.ThinkingOrb), {
  ssr: false,
  loading: () => <span className="block size-5 rounded-full bg-primary/40 animate-pulse-soft" />,
});

export type OrbState = 'connecting' | 'working' | 'breathing' | 'searching' | 'weaving';

/** `animated=false` (ambient animations off) falls back to a CSS pulse dot with zero JS. */
export function ThinkingOrb({
  state,
  size = 20,
  animated = true,
  label,
  className,
}: {
  state: OrbState;
  size?: 20 | 64;
  animated?: boolean;
  label: string;
  className?: string;
}) {
  if (!animated) {
    return (
      <span
        role="img"
        aria-label={label}
        className={cn('inline-block rounded-full bg-primary animate-pulse-soft', size === 64 ? 'size-4' : 'size-2', className)}
      />
    );
  }
  return <Orb state={state} size={size} aria-label={label} className={className} />;
}
