import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { NavStartButton, StartPanel } from './start-panel';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const joinRoom = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, joinRoom: (...args: unknown[]) => joinRoom(...args) } };
});

beforeEach(() => {
  localStorage.clear();
  joinRoom.mockReset();
  push.mockReset();
});

describe('StartPanel', () => {
  it('prefills the remembered display name as a real value', () => {
    localStorage.setItem('tether:display-name', 'Hriday');
    render(<StartPanel />);
    expect(screen.getByLabelText('Your name')).toHaveValue('Hriday');
  });

  it('keeps the typed name when switching from create to join', async () => {
    const user = userEvent.setup();
    joinRoom.mockResolvedValue({ token: 't', memberId: 'm', room: { epoch: 'e' } });
    render(<StartPanel />);
    await user.type(screen.getByLabelText('Your name'), 'John');
    await user.click(screen.getByRole('button', { name: /join one instead/i }));
    expect(screen.getByRole('heading', { name: 'Join a room' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your name')).toHaveValue('John');
    await user.type(screen.getByLabelText('Room ID'), 'team-standup');
    await user.click(screen.getByRole('button', { name: /join room/i }));
    expect(joinRoom).toHaveBeenCalledWith('team-standup', { name: 'John', passcode: undefined });
    expect(push).toHaveBeenCalledWith('/r/team-standup');
  });

  it('sends the passcode and flags a missing one', async () => {
    const user = userEvent.setup();
    joinRoom.mockRejectedValue(new ApiError(403, 'bad_passcode', 'Wrong passcode'));
    localStorage.setItem('tether:display-name', 'Hriday');
    render(<StartPanel />);
    await user.click(screen.getByRole('button', { name: /join one instead/i }));
    await user.type(screen.getByLabelText('Room ID'), 'locked-room');
    await user.click(screen.getByRole('button', { name: /join room/i }));
    expect(await screen.findByText('This room needs a passcode')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Passcode'), 'secret');
    await user.click(screen.getByRole('button', { name: /join room/i }));
    expect(joinRoom).toHaveBeenLastCalledWith('locked-room', { name: 'Hriday', passcode: 'secret' });
    expect(await screen.findByText('Wrong passcode')).toBeInTheDocument();
  });

  it('shows a resume row that can forget the session', async () => {
    const user = userEvent.setup();
    localStorage.setItem('tether:recent-rooms', JSON.stringify([{ roomId: 'team-standup', name: 'Hriday', lastActive: 1 }]));
    render(
      <>
        <NavStartButton />
        <StartPanel />
      </>,
    );
    expect(screen.getByText(/continue in/i)).toHaveTextContent('Continue in team-standup as Hriday');
    expect(screen.getByRole('link', { name: /resume/i })).toHaveAttribute('href', '/r/team-standup');
    await user.click(screen.getByRole('button', { name: 'Forget' }));
    expect(screen.queryByText(/continue in/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start' })).toHaveAttribute('href', '#start');
  });
});
