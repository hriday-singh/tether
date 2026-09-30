'use client';

import { Slider as SL, Switch as SW, Tabs as T, ToggleGroup as TG, Tooltip as TT } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// ---- Tooltip
export const TooltipProvider = TT.Provider;
export function Tip({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: ReactNode;
  shortcut?: string;
  side?: ComponentProps<typeof TT.Content>['side'];
  children: ReactNode;
}) {
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          className="z-[1100] flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-caption text-popover-foreground shadow-capsule data-[state=delayed-open]:animate-fade-in motion-reduce:animate-none"
        >
          {label}
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  );
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-muted px-1 font-mono text-micro text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

// ---- Tabs (pill segmented)
export const Tabs = T.Root;
export const TabsContent = T.Content;
export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn('inline-flex items-center gap-1 rounded-full bg-muted p-0.5', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-caption font-medium text-muted-foreground transition-ui outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card',
        className,
      )}
      {...props}
    />
  );
}

// ---- Segmented control (single choice)
export function Segmented<V extends string>({
  value,
  onValueChange,
  options,
  'aria-label': ariaLabel,
}: {
  value: V;
  onValueChange: (v: V) => void;
  options: readonly { value: V; label: ReactNode }[];
  'aria-label': string;
}) {
  return (
    <TG.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v as V)}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5"
    >
      {options.map((o) => (
        <TG.Item
          key={o.value}
          value={o.value}
          className="h-7 rounded-full px-3 text-caption font-medium text-muted-foreground transition-ui outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-card"
        >
          {o.label}
        </TG.Item>
      ))}
    </TG.Root>
  );
}

// ---- Switch
export function Switch({ className, ...props }: ComponentProps<typeof SW.Root>) {
  return (
    <SW.Root
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-input transition-ui outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SW.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow-card transition-transform duration-(--duration-fast) ease-standard data-[state=checked]:translate-x-4" />
    </SW.Root>
  );
}

// ---- Slider
export function Slider({ className, ...props }: ComponentProps<typeof SL.Root>) {
  return (
    <SL.Root className={cn('relative flex h-5 w-full touch-none items-center select-none', className)} {...props}>
      <SL.Track className="relative h-1 grow overflow-hidden rounded-full bg-muted">
        <SL.Range className="absolute h-full bg-primary" />
      </SL.Track>
      <SL.Thumb className="block size-4 rounded-full border border-primary bg-background shadow-card transition-ui outline-none focus-visible:ring-2 focus-visible:ring-ring" />
    </SL.Root>
  );
}

// ---- Badge / pill
export function Badge({
  className,
  tone = 'neutral',
  ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'destructive' }) {
  const tones = {
    neutral: 'border-border bg-muted text-muted-foreground',
    primary: 'border-primary/30 bg-primary/10 text-primary',
    success: 'border-success/30 bg-success/10 text-success',
    warning: 'border-warning/30 bg-warning/10 text-warning',
    destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-micro font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-lg bg-muted motion-reduce:animate-none', className)} {...props} />;
}
