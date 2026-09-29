'use client';

import { MorphIcon as Morph } from 'morphicons/react';
import { useEffect, useRef, useState } from 'react';
import { TextMorph as Torph } from 'torph/react';
import { cn } from '@/lib/utils';
import type { IconData } from './icon';

/**
 * Dual morphing (docs/ui-ux/02 §2): morphicons for icon paths, torph for text.
 * Hugeicons stroke data has the same [tag, attrs][] shape morphicons consumes, so no adapter is needed.
 */
export function MorphIcon({ icon, size = 16, className }: { icon: IconData; size?: number; className?: string }) {
  return (
    <Morph
      icon={icon as unknown as Parameters<typeof Morph>[0]['icon']}
      size={size}
      strokeWidth={1.5}
      reducedMotion="user"
      className={cn('shrink-0', className)}
    />
  );
}

export function TextMorph({ children, className }: { children: string; className?: string }) {
  return (
    <Torph className={className} respectReducedMotion>
      {children}
    </Torph>
  );
}

/** Latency ticker count-up (React Bits pattern) on rAF, transform-free and tabular. Jumps when reduced motion is set. */
export function CountUp({ value, durationMs = 400, className }: { value: number; durationMs?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = reduce ? 1 : Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(origin + (value - origin) * eased);
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);
  return <span className={cn('tabular', className)}>{shown}</span>;
}
