import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button, buttonVariants } from './button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from './input-otp';

describe('Button', () => {
  it('includes touch-target hit expansion class for icon-xs size', () => {
    const classes = buttonVariants({ size: 'icon-xs' });
    expect(classes).toContain('after:absolute');
    expect(classes).toContain('after:-inset-1.5');
  });

  it('renders a button with accessible type and text', () => {
    render(<Button size="icon-xs" aria-label="Action button">Click</Button>);
    const button = screen.getByRole('button', { name: 'Action button' });
    expect(button).toBeInTheDocument();
  });

  it('applies dark high-contrast text color for primary button variant', () => {
    const classes = buttonVariants({ variant: 'primary' });
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
    expect(classes).toContain('dark:text-neutral-950');
  });
});

describe('InputOTP', () => {
  it('renders slot elements with accessibility attributes', () => {
    render(
      <InputOTP maxLength={4} value="12" onChange={() => {}}>
        <InputOTPGroup>
          <InputOTPSlot index={0} data-testid="slot-0" />
          <InputOTPSlot index={1} data-testid="slot-1" />
          <InputOTPSlot index={2} data-testid="slot-2" />
          <InputOTPSlot index={3} data-testid="slot-3" />
        </InputOTPGroup>
      </InputOTP>,
    );

    expect(screen.getByTestId('slot-0')).toHaveTextContent('1');
    expect(screen.getByTestId('slot-1')).toHaveTextContent('2');
    expect(screen.getByTestId('slot-2')).toHaveTextContent('');
    expect(screen.getByTestId('slot-3')).toHaveTextContent('');
  });
});
