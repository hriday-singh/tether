import { Label as LabelPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-body text-foreground transition-ui placeholder:text-muted-foreground/70',
        'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

/** Same look as Input. Grows with its content natively (`field-sizing: content`) up to max-h, then scrolls. */
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      className={cn(
        'field-sizing-content max-h-40 min-h-9 w-full min-w-0 resize-none rounded-xl border border-input bg-background px-3 py-2 text-body text-foreground transition-ui placeholder:text-muted-foreground/70',
        'outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-caption font-medium text-muted-foreground select-none', className)}
      {...props}
    />
  );
}

/** Label + control + hint/error, wired for screen readers. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
