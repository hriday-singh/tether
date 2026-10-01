import { CHAT_MAX_CHARS, type ChatCodeRef } from '@tether/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/controls';
import { describe, expect, it, vi } from 'vitest';
import { ChatComposer } from './chat-panel';

function setup(online = true, attachment: ChatCodeRef | null = null) {
  const onSend = vi.fn();
  const onClearAttachment = vi.fn();
  render(
    <TooltipProvider>
      <ChatComposer online={online} onSend={onSend} attachment={attachment} onClearAttachment={onClearAttachment} />
    </TooltipProvider>,
  );
  const box = screen.getByRole('textbox', { name: 'Chat message' });
  const button = screen.getByRole('button', { name: 'Send message' });
  return { onSend, onClearAttachment, box, button };
}

describe('ChatComposer', () => {
  it('shows quoted code, focuses the box, and lets you drop the quote', () => {
    const ref = { from: 'AQ==', to: 'Ag==', line: 3, endLine: 5, snippet: '  const x = 1;\nreturn x;' };
    const { box, onClearAttachment } = setup(true, ref);
    expect(screen.getByText('L3–5')).toBeInTheDocument();
    expect(screen.getByText('const x = 1;')).toBeInTheDocument();
    expect(box).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove quoted code' }));
    expect(onClearAttachment).toHaveBeenCalledTimes(1);
  });

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
