import { CHAT_MAX_CHARS } from '@tether/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/controls';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './chat-panel';

function setup(online = true) {
  const onSend = vi.fn();
  render(
    <TooltipProvider>
      <ChatComposer online={online} onSend={onSend} />
    </TooltipProvider>,
  );
  const box = screen.getByRole('textbox', { name: 'Chat message' });
  const button = screen.getByRole('button', { name: 'Send message' });
  return { onSend, box, button };
}

describe('ChatComposer', () => {
  it('sends trimmed text on Enter and clears the draft', () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: '  hello  ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('hello');
    expect(box).toHaveValue('');
  });

  it('does not send on Shift+Enter', () => {
    const { onSend, box } = setup();
    fireEvent.change(box, { target: { value: 'line one' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('blocks whitespace-only drafts', () => {
    const { onSend, box, button } = setup();
    fireEvent.change(box, { target: { value: '   \n ' } });
    expect(button).toBeDisabled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps the draft but blocks sending while offline', () => {
    const { onSend, box, button } = setup(false);
    fireEvent.change(box, { target: { value: 'later' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    expect(button).toBeDisabled();
    expect(box).toHaveValue('later');
  });

  it('shows the counter near the limit and caps input length', () => {
    const { box } = setup();
    expect(box).toHaveAttribute('maxLength', String(CHAT_MAX_CHARS));
    expect(screen.queryByText(/left$/)).toBeNull();
    fireEvent.change(box, { target: { value: 'a'.repeat(CHAT_MAX_CHARS - 10) } });
    expect(screen.getByText('10 left')).toBeInTheDocument();
  });
});
