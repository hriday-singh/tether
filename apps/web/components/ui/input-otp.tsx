'use client';

import { OTPInput, OTPInputContext } from 'input-otp';
import { ComponentProps, useContext } from 'react';
import { cn } from '@/lib/utils';

export function InputOTP({
  className,
  containerClassName,
  ...props
}: ComponentProps<typeof OTPInput>) {
  return (
    <OTPInput
      containerClassName={cn('flex items-center gap-2 has-disabled:opacity-50', containerClassName)}
      className={cn('disabled:cursor-not-allowed', className)}
      {...props}
    />
  );
}

export function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-1.5', className)} {...props} />;
}

export function InputOTPSlot({
  index,
  className,
  ...props
}: ComponentProps<'div'> & { index: number }) {
  const inputOTPContext = useContext(OTPInputContext);
  const slot = inputOTPContext?.slots[index];

  return (
    <div
      className={cn(
        'relative flex size-10 items-center justify-center rounded-xl border border-border bg-card font-mono text-body font-medium shadow-card transition-ui',
        slot?.isActive && 'border-ring ring-2 ring-ring ring-offset-2 ring-offset-background',
        className,
      )}
      {...props}
    >
      {slot?.char}
      {slot?.hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-4 w-px bg-foreground animate-pulse-soft" />
        </div>
      )}
    </div>
  );
}

export function InputOTPSeparator({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div role="separator" className={cn('text-muted-foreground', className)} {...props}>
      -
    </div>
  );
}
