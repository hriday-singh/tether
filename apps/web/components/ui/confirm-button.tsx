'use client';

import { useState, type ReactNode } from 'react';
import type { ButtonVariantProps } from './button-variants';
import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

/** Click, then confirm in a dialog. For destructive actions that should be one deliberate step, not a hold. */
export function ConfirmButton({
  onConfirm,
  title,
  description,
  confirmLabel = 'Yes',
  children,
  size = 'sm',
  variant = 'outline',
  className,
  disabled,
}: {
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  children: ReactNode;
  size?: ButtonVariantProps['size'];
  variant?: ButtonVariantProps['variant'];
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size={size} variant={variant} className={className} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <DialogContent className="max-w-sm" hideClose>
        <DialogHeader className="pr-0">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button size="sm" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            size="sm"
            variant="destructive"
            autoFocus
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
