'use client';

import { useMounted } from '@/lib/hooks';

/**
 * Renders a post-mount localized time string to prevent SSR hydration mismatches
 * while respecting the user's local browser timezone and locale.
 */
export function FormattedTime({
  date,
  className,
}: {
  date: string | number | Date;
  className?: string;
}) {
  const mounted = useMounted();
  const d = typeof date === 'object' ? date : new Date(date);
  const iso =
    typeof date === 'string'
      ? date
      : typeof date === 'number'
        ? new Date(date).toISOString()
        : date.toISOString();

  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {mounted ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
    </time>
  );
}
