import { cn } from '@/lib/utils';

/** Tether mark: two nodes joined by a line. It inherits text color, with the accent on one node. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('shrink-0', className)}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="6" className="fill-primary/15 stroke-primary/40" strokeWidth="1" />
      <path d="M8 16 16 8" className="stroke-foreground" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="7.5" cy="16.5" r="2.25" className="fill-foreground" />
      <circle cx="16.5" cy="7.5" r="2.25" className="fill-primary" />
    </svg>
  );
}
