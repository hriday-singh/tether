'use client';

import type { ComponentProps } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { cn } from '@/lib/utils';

export { Panel as ResizablePanel, useDefaultLayout, usePanelRef } from 'react-resizable-panels';

export function ResizableGroup({ className, ...props }: ComponentProps<typeof Group>) {
  return <Group className={cn('h-full w-full', className)} {...props} />;
}

/** Invisible 8 px gutter between floating cards, with a hairline grip on hover and focus. */
export function ResizableHandle({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      className={cn(
        'group relative flex w-2 shrink-0 items-center justify-center outline-none aria-[orientation=horizontal]:h-2 aria-[orientation=horizontal]:w-full',
        className,
      )}
      {...props}
    >
      <span className="h-8 w-0.5 rounded-full bg-border opacity-0 transition-ui group-hover:opacity-100 group-focus-visible:bg-ring group-focus-visible:opacity-100 group-data-[separator=active]:bg-primary group-data-[separator=active]:opacity-100 group-aria-[orientation=horizontal]:h-0.5 group-aria-[orientation=horizontal]:w-8" />
    </Separator>
  );
}

// ponytail: re-exported so callers import one module
export { Panel };
