'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Hold to confirm (React Bits pattern) for destructive host actions. Works with pointer and keyboard
 * (hold Space/Enter). Releasing early cancels. Progress is drawn with transform only.
 */
export function HoldButton({
  onConfirm,
  holdMs = 1200,
  children,
  holdingLabel = 'Keep holding…',
  className,
  disabled,
}: {
  onConfirm: () => void;
  holdMs?: number;
  children: ReactNode;
  holdingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef(0);
  const hintId = useId();

  const cancel = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setProgress(0);
  };
  const start = () => {
    if (disabled || raf.current) return;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / holdMs);
      setProgress(p);
      if (p >= 1) {
        raf.current = 0;
        setProgress(0);
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
      aria-describedby={hintId}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && cancel()}
      className={cn(
        'relative inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-lg border border-destructive/40 bg-destructive/10 px-2.5 text-caption font-medium text-destructive transition-ui select-none hover:bg-destructive/20 disabled:opacity-50',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-0 origin-left bg-destructive/30"
        style={{ transform: `scaleX(${progress})` }}
      />
      <span className="relative z-10 flex items-center gap-1.5">{progress > 0 ? holdingLabel : children}</span>
      <span id={hintId} className="sr-only">
        Press and hold to confirm
      </span>
    </button>
  );
}
