'use client';

import {
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons';
import { Toaster as Sonner } from 'sonner';
import { Icon } from './icon';

export { toast } from 'sonner';

/** Sonner themed through tokens. Icons are SVG only (zero-emoji rule). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      icons={{
        success: <Icon icon={CheckmarkCircle02Icon} className="text-success" />,
        error: <Icon icon={CancelCircleIcon} className="text-destructive" />,
        warning: <Icon icon={AlertCircleIcon} className="text-warning" />,
        info: <Icon icon={InformationCircleIcon} className="text-primary" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex w-(--width) items-start gap-3 rounded-xl border border-border bg-popover p-3 text-body text-popover-foreground shadow-overlay',
          icon: 'flex size-5 shrink-0 items-center justify-center',
          content: 'flex flex-col gap-0.5 flex-1 min-w-0',
          title: 'font-medium leading-5',
          description: 'text-caption text-muted-foreground leading-normal',
          actionButton:
            'ml-auto h-7 shrink-0 rounded-lg bg-primary px-2.5 text-caption font-medium text-primary-foreground',
          cancelButton: 'h-7 shrink-0 rounded-lg bg-muted px-2.5 text-caption',
        },
      }}
    />
  );
}
