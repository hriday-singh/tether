import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniEditor, demoFrame } from './mini-editor';

let reducedMotion = true;
vi.mock('@/lib/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks')>();
  return {
    ...actual,
    useMediaQuery: (query: string) => (query.includes('prefers-reduced-motion') ? reducedMotion : false),
  };
});

afterEach(() => {
  reducedMotion = true;
  vi.useRealTimers();
});

describe('demoFrame', () => {
  it('starts empty and unsynced', () => {
    const f = demoFrame(0);
    expect(f.lines[3]).toBe('  ');
    expect(f.lines[6]).toBe('');
    expect(f).toMatchObject({ synced: false, commented: false, running: false, output: false, selectedLine: null, ping: 11 });
  });

  it('types both lines in full, then syncs, comments, runs and prints', () => {
    const f = demoFrame(1000);
    expect(f.lines[3]).toBe('  return `Welcome, ${name}!`;');
    expect(f.lines[6]).toBe('console.log(team.map(greet));');
    expect(f).toMatchObject({ synced: true, commented: true, running: false, output: true, selectedLine: 3 });
  });

  it('never has both cursors on the same spot', () => {
    for (let t = 0; t < 200; t++) {
      const [a, r] = demoFrame(t).cursors;
      expect(a!.line === r!.line && a!.col === r!.col).toBe(false);
    }
  });
});

describe('MiniEditor', () => {
  it('shows the finished story when motion is reduced', () => {
    render(<MiniEditor />);
    expect(screen.getByText('greet.ts')).toBeInTheDocument();
    expect(screen.getByLabelText(/Ping \d+ milliseconds/)).toBeInTheDocument();
    expect(screen.getByText('In sync')).toBeInTheDocument();
    expect(screen.getByText('Nice. Run it?')).toBeInTheDocument();
    expect(screen.getByText("'Welcome, Laasya!'")).toBeInTheDocument();
  });

  it('Run jumps the story to running, then prints the output', () => {
    reducedMotion = false;
    vi.useFakeTimers();
    render(<MiniEditor />);
    expect(screen.getByText('Press Run to see the output')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run/i }));
    expect(screen.getByText('Running greet.ts…')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText("'Welcome, Hriday!'")).toBeInTheDocument();
  });
});
