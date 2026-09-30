import { BotIcon } from '@hugeicons/core-free-icons';
import { presenceClass } from '@/lib/presence';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

function initials(name: string): string {
  const parts = name.replace(/\(\d+\)$/, '').trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/** Initials on the member's presence color. Bots get a bot glyph, never an emoji. */
export function Avatar({
  name,
  colorIndex,
  isBot,
  size = 'md',
  dimmed,
  className,
}: {
  name: string;
  colorIndex: number;
  isBot?: boolean;
  size?: 'sm' | 'md';
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        presenceClass(colorIndex),
        'inline-grid shrink-0 place-items-center rounded-full bg-(--p) font-semibold text-presence-ink ring-2 ring-card transition-ui',
        size === 'sm' ? 'size-6 text-micro' : 'size-8 text-caption',
        dimmed && 'opacity-45',
        className,
      )}
    >
      {isBot ? <Icon icon={BotIcon} size={size === 'sm' ? 12 : 14} /> : initials(name)}
    </span>
  );
}
