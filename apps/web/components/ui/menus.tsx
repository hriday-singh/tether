'use client';

import { ArrowDown01Icon, ArrowUp01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { DropdownMenu as DM, Popover as P, Select as S } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from './icon';

const surface =
  'z-[1100] min-w-40 overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none';
const item =
  'relative flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 text-body outline-none select-none transition-ui data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground';

// ---- Popover
export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export function PopoverContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content data-lenis-prevent sideOffset={sideOffset} className={cn(surface, 'p-3', className)} {...props} />
    </P.Portal>
  );
}

// ---- Dropdown menu
export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;
export const DropdownMenuGroup = DM.Group;
export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content data-lenis-prevent sideOffset={sideOffset} className={cn(surface, className)} {...props} />
    </DM.Portal>
  );
}
export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof DM.Item> & { destructive?: boolean }) {
  return (
    <DM.Item
      className={cn(item, destructive && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive', className)}
      {...props}
    />
  );
}
export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('px-2 py-1 text-micro font-medium text-muted-foreground', className)} {...props} />;
}
export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

// ---- Select
export function Select({
  value,
  onValueChange,
  children,
  placeholder,
  className,
  id,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          'inline-flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-body transition-ui outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50 data-[placeholder]:text-muted-foreground',
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon>
          <Icon icon={ArrowDown01Icon} size={14} className="text-muted-foreground" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          data-lenis-prevent
          className={cn(surface, 'max-h-72 w-(--radix-select-trigger-width) overflow-hidden')}
        >
          <S.ScrollUpButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground transition-ui hover:text-foreground">
            <Icon icon={ArrowUp01Icon} size={14} />
          </S.ScrollUpButton>
          <S.Viewport
            data-lenis-prevent
            className="max-h-60 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]"
          >
            {children}
          </S.Viewport>
          <S.ScrollDownButton className="flex cursor-default items-center justify-center py-1 text-muted-foreground transition-ui hover:text-foreground">
            <Icon icon={ArrowDown01Icon} size={14} />
          </S.ScrollDownButton>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
export function SelectItem({ className, children, ...props }: ComponentProps<typeof S.Item>) {
  return (
    <S.Item className={cn(item, 'pr-8', className)} {...props}>
      <S.ItemText asChild>
        <span className="flex items-center gap-2">{children}</span>
      </S.ItemText>
      <S.ItemIndicator className="absolute right-2">
        <Icon icon={Tick02Icon} size={14} className="text-primary" />
      </S.ItemIndicator>
    </S.Item>
  );
}
