'use client';

import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb as CanvasOrb } from 'thinking-orbs';
import { cn } from '@/lib/utils';

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
 * thinking-orbs requires #hex or rgb()/rgba().
 * Converts any CSS color (oklch, var(--...), hex, hsl, rgb) to an sRGB `rgb(r, g, b)` string.
 */
function toRgbColor(colorStr: string): string | undefined {
  if (!colorStr || colorStr === 'transparent') return undefined;
  const trimmed = colorStr.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) return trimmed;

  const rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (rgbMatch) {
    const r = Math.round(Number(rgbMatch[1]));
    const g = Math.round(Number(rgbMatch[2]));
    const b = Math.round(Number(rgbMatch[3]));
    return `rgb(${r}, ${g}, ${b})`;
  }

  if (typeof document === 'undefined') return undefined;

  let resolvedStr = trimmed;
  if (trimmed.includes('var(')) {
    const el = document.createElement('span');
    el.style.color = trimmed;
    document.body.appendChild(el);
    resolvedStr = window.getComputedStyle(el).color || trimmed;
    el.remove();
    const innerRgb = resolvedStr.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (innerRgb) {
      return `rgb(${Math.round(Number(innerRgb[1]))}, ${Math.round(Number(innerRgb[2]))}, ${Math.round(Number(innerRgb[3]))})`;
    }
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;
    ctx.fillStyle = resolvedStr;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
  } catch {
    return undefined;
  }
}

/**
 * ThinkingOrb displays an orbital thought-indicator for asynchronous / connecting states.
 * - Eagerly imported (no dynamic chunk delay or solid blue ball placeholder artifact).
 * - Inherits the computed text color of its container by default to match the text next to it.
 * - Pauses rendering when hidden or offscreen to avoid wasted RAM/CPU.
 * - Falls back to a lightweight CSS pulse dot when `animated=false`.
 */
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
  const containerRef = useRef<HTMLSpanElement>(null);
  const [resolvedColor, setResolvedColor] = useState<string | undefined>(() => {
    if (color && color !== 'currentColor') return toRgbColor(color);
    if (tone) return toRgbColor(TONE_TOKENS[tone]);
    return undefined;
  });

  useEffect(() => {
    const resolve = () => {
      // 1. Explicit color prop (other than 'currentColor') takes top priority
      if (color && color !== 'currentColor') {
        setResolvedColor(toRgbColor(color));
        return;
      }
      // 2. Resolve from the DOM container's computed text color (matches the text next to it)
      if (containerRef.current) {
        const computed = window.getComputedStyle(containerRef.current).color;
        if (computed && computed !== 'transparent' && computed !== 'rgba(0, 0, 0, 0)') {
          const rgb = toRgbColor(computed);
          if (rgb) {
            setResolvedColor(rgb);
            return;
          }
        }
      }
      // 3. Fallback to tone token if specified
      if (tone) {
        setResolvedColor(toRgbColor(TONE_TOKENS[tone]));
        return;
      }
    };

    resolve();
    // Re-resolve when the theme or container styles change so the orb stays synchronized with the text color.
    const observer = new MutationObserver(resolve);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
    return () => observer.disconnect();
  }, [color, tone]);

  if (!animated) {
    return (
      <span
        ref={containerRef}
        role="img"
        aria-label={label}
        className={cn(
          'inline-block rounded-full bg-current opacity-85 animate-pulse-soft',
          size === 64 ? 'size-4' : 'size-2',
          className,
        )}
      />
    );
  }

  return (
    <span
      ref={containerRef}
      className={cn(
        'inline-flex items-center justify-center shrink-0',
        size === 64 ? 'size-16' : 'size-5',
        className,
      )}
    >
      <CanvasOrb
        state={state}
        size={size}
        color={resolvedColor}
        aria-label={label}
        className="size-full"
        style={{ width: '100%', height: '100%' }}
      />
    </span>
  );
}
