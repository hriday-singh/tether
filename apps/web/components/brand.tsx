import { cn } from '@/lib/utils';

/** Tether mark: two nodes joined by a line on a tinted tile. Inherits text color; the far node carries the accent. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" className="fill-primary/15 stroke-primary/40" strokeWidth="1" />
      <path d="M8.5 15.5 15.5 8.5" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
      <circle cx="8" cy="16" r="2.75" className="fill-foreground" />
      <circle cx="16" cy="8" r="2.75" className="fill-primary" />
    </svg>
  );
}
