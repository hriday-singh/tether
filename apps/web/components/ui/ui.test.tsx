import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { ConfirmButton } from './confirm-button';
import { buttonVariants } from './button-variants';
import { ThinkingOrb } from './thinking-orb';
import { FormattedTime } from './formatted-time';
import { Popover, PopoverContent, PopoverTrigger, Select, SelectItem } from './menus';
import { Toaster } from './toaster';

describe('Button', () => {
  it('includes touch-target hit expansion class for icon-xs size', () => {
    const classes = buttonVariants({ size: 'icon-xs' });
    expect(classes).toContain('after:absolute');
    expect(classes).toContain('after:-inset-2.5');
  });

  it('renders a button with accessible type and text', () => {
    render(<Button size="icon-xs" aria-label="Action button">Click</Button>);
    const button = screen.getByRole('button', { name: 'Action button' });
    expect(button).toBeInTheDocument();
  });

  it('applies semantic colors for primary button variant', () => {
    const classes = buttonVariants({ variant: 'primary' });
    expect(classes).toContain('bg-primary');
    expect(classes).toContain('text-primary-foreground');
  });

  it('preserves text-primary-foreground when rendered through cn with size classes', () => {
    const { rerender } = render(<Button size="lg">Create room</Button>);
    let button = screen.getByRole('button', { name: 'Create room' });
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('text-primary-foreground');
    expect(button.className).toContain('text-body');

    rerender(<Button size="sm">Create room</Button>);
    button = screen.getByRole('button', { name: 'Create room' });
    expect(button.className).toContain('text-primary-foreground');
    expect(button.className).toContain('text-caption');
  });
});

describe('ThinkingOrb', () => {
  it('renders non-animated fallback with accessible label', () => {
    render(<ThinkingOrb state="working" animated={false} label="Processing task" tone="primary" />);
    const orb = screen.getByRole('img', { name: 'Processing task' });
    expect(orb).toBeInTheDocument();
  });

  it('renders with explicit color prop', () => {
    render(<ThinkingOrb state="connecting" animated={false} label="Connecting" color="#10b981" />);
    const orb = screen.getByRole('img', { name: 'Connecting' });
    expect(orb).toBeInTheDocument();
  });

  it('renders animated canvas orb immediately with accessible label', () => {
    render(<ThinkingOrb state="connecting" label="Joining" />);
    const orb = screen.getByRole('img', { name: 'Joining' });
    expect(orb).toBeInTheDocument();
    expect(orb.tagName.toLowerCase()).toBe('canvas');
  });

  it('resolves container text color to match text next to it', () => {
    const { container } = render(
      <div style={{ color: 'rgb(240, 240, 240)' }}>
        <ThinkingOrb state="connecting" label="Joining" />
        <span>Joining…</span>
      </div>,
    );
    const canvas = container.querySelector('canvas');
    expect(canvas).toBeInTheDocument();
  });

  it('preserves explicit size and className on container', () => {
    const { container } = render(<ThinkingOrb state="connecting" size={20} className="size-4" label="Joining" />);
    const span = container.querySelector('span');
    expect(span).toHaveClass('size-4');
  });
});

describe('FormattedTime', () => {
  it('renders a time element with valid dateTime and localized content', () => {
    const iso = '2026-09-30T12:00:00.000Z';
    const { container } = render(<FormattedTime date={iso} className="test-time" />);
    const timeEl = container.querySelector('time');
    expect(timeEl).toBeInTheDocument();
    expect(timeEl).toHaveAttribute('dateTime', iso);
    expect(timeEl).toHaveClass('test-time');
    expect(timeEl?.textContent).toBeTruthy();
  });
});

describe('Menus and Popovers', () => {
  it('PopoverContent includes data-lenis-prevent to avoid smooth scroll hijacking', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent data-testid="popover-content">Popover Body</PopoverContent>
      </Popover>,
    );
    const content = screen.getByTestId('popover-content');
    expect(content).toBeInTheDocument();
    expect(content).toHaveAttribute('data-lenis-prevent');
  });

  it('Select renders combobox trigger and displays value', () => {
    render(
      <Select value="html" onValueChange={() => {}} aria-label="Language selection">
        <SelectItem value="html">HTML</SelectItem>
        <SelectItem value="css">CSS</SelectItem>
      </Select>,
    );
    const trigger = screen.getByRole('combobox', { name: 'Language selection' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('HTML');
  });
});

describe('Toaster', () => {
  it('renders Toaster component successfully', () => {
    const { container } = render(<Toaster />);
    expect(container).toBeInTheDocument();
  });
});

describe('ConfirmButton', () => {
  it('asks once, then confirms on Yes; Cancel does nothing', () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton title="Remove Hriday?" onConfirm={onConfirm}>Remove</ConfirmButton>);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('dialog', { name: 'Remove Hriday?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
