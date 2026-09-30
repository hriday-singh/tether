import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { TooltipProvider } from '@/components/ui/controls';
import { JsonPreview } from './json-preview';

function renderWithProviders(ui: ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

describe('JsonPreview', () => {
  it('renders placeholder when empty', () => {
    renderWithProviders(<JsonPreview content="" />);
    expect(screen.getByText('JSON Tree Viewer')).toBeInTheDocument();
  });

  it('renders object keys and values', () => {
    const json = JSON.stringify({
      name: 'Tether',
      version: 1,
      active: true,
      data: null,
    });
    renderWithProviders(<JsonPreview content={json} />);
    expect(screen.getByText('name:')).toBeInTheDocument();
    expect(screen.getByText('"Tether"')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });

  it('renders syntax error banner when JSON is invalid', () => {
    renderWithProviders(<JsonPreview content="invalid { json" />);
    expect(screen.getByText('Invalid JSON Syntax')).toBeInTheDocument();
  });

  it('filters nodes based on search input', () => {
    const json = JSON.stringify({
      username: 'alice',
      email: 'alice@example.com',
      score: 100,
    });
    renderWithProviders(<JsonPreview content={json} />);
    expect(screen.getByText('username:')).toBeInTheDocument();
    expect(screen.getByText('score:')).toBeInTheDocument();

    const input = screen.getByLabelText('Filter JSON keys and values');
    fireEvent.change(input, { target: { value: 'email' } });

    expect(screen.getByText('email:')).toBeInTheDocument();
    expect(screen.queryByText('score:')).not.toBeInTheDocument();
  });
});
