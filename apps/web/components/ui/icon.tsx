import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { cn } from '@/lib/utils';

export type IconData = IconSvgElement;

/** The single UI icon family: Hugeicons stroke-rounded (ADR-016). Decorative by default; pass `label` for meaning. */
export function Icon({
  icon,
  size = 16,
  label,
  className,
}: {
  icon: IconData;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={1.5}
      className={cn('shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
