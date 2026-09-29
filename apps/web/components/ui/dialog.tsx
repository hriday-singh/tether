'use client';

import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { Dialog as D } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay =
  'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none';

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: ComponentProps<typeof D.Content> & { hideClose?: boolean }) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-overlay outline-none',
          'data-[state=open]:animate-fade-in motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <D.Close
            className="absolute top-3.5 right-3.5 grid size-7 place-items-center rounded-lg text-muted-foreground transition-ui hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <Icon icon={Cancel01Icon} size={16} />
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1 pr-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof D.Title>) {
  return <D.Title className={cn('text-title font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof D.Description>) {
  return <D.Description className={cn('text-body text-muted-foreground', className)} {...props} />;
}

/** Right-side sheet (host controls). Same Radix Dialog underneath. */
export function SheetContent({ className, children, ...props }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className={overlay} />
      <D.Content
        className={cn(
          'fixed inset-y-2.5 right-2.5 z-50 flex w-[min(24rem,calc(100vw-1.25rem))] flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-overlay outline-none',
          'transition-transform duration-(--duration-base) ease-standard data-[state=open]:animate-fade-in motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          className="absolute top-3.5 right-3.5 grid size-7 place-items-center rounded-lg text-muted-foreground transition-ui hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <Icon icon={Cancel01Icon} size={16} />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
