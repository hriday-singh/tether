'use client';

import { Search01Icon } from '@hugeicons/core-free-icons';
import { Command as C } from 'cmdk';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

export function Command({ className, ...props }: ComponentProps<typeof C>) {
  return <C className={cn('flex w-full flex-col overflow-hidden text-popover-foreground', className)} {...props} />;
}

export function CommandInput({ className, ...props }: ComponentProps<typeof C.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Icon icon={Search01Icon} size={16} className="text-muted-foreground" />
      <C.Input
        className={cn(
          'h-11 w-full bg-transparent text-body outline-none placeholder:text-muted-foreground/70',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: ComponentProps<typeof C.List>) {
  return <C.List className={cn('max-h-80 overflow-y-auto overscroll-contain p-1', className)} {...props} />;
}

export function CommandEmpty(props: ComponentProps<typeof C.Empty>) {
  return <C.Empty className="py-8 text-center text-body text-muted-foreground" {...props} />;
}

export function CommandGroup({ className, ...props }: ComponentProps<typeof C.Group>) {
  return (
    <C.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof C.Item>) {
  return (
    <C.Item
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-lg px-2 py-2 text-body outline-none select-none transition-ui data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}

export const CommandSeparator = (props: ComponentProps<typeof C.Separator>) => (
  <C.Separator className="-mx-1 my-1 h-px bg-border" {...props} />
);
