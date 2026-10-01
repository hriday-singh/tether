'use client';

import {
  ArrowRight01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Delete02Icon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/controls';
import { HoldButton } from '@/components/ui/hold-button';
import { Icon } from '@/components/ui/icon';
import { MorphIcon } from '@/components/ui/motion';
import { toast } from '@/components/ui/toaster';
import { useFlag, useStore } from '@/lib/hooks';
import { diffText, exceedsEditLimit } from '@/lib/text-edit';
import { useWorkspace } from './context';

export function Scratchpad() {
  const ws = useWorkspace();
  const room = useStore(ws.client.room);
  const isHost = room.hostId === room.selfId;
  const scratchpad = ws.client.scratchpadText;

  const [text, setText] = useState(() => scratchpad.toString());
  const [copied, flashCopied] = useFlag(2000);
  const isLocalEdit = useRef(false);

  // Sync from remote Yjs updates
  useEffect(() => {
    const observer = () => {
      if (isLocalEdit.current) return;
      setText(scratchpad.toString());
    };
    scratchpad.observe(observer);
    return () => scratchpad.unobserve(observer);
  }, [scratchpad]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    // Only the changed span: rewriting the whole text duplicates concurrent edits and grows the doc per keystroke.
    const { index, deleteCount, insert } = diffText(scratchpad.toString(), next);
    if (exceedsEditLimit(insert)) {
      toast.error('Paste too large', { description: 'Edits over ~448 KB at once are rejected by the server.' });
      return;
    }
    isLocalEdit.current = true;
    setText(next);

    ws.client.doc.transact(() => {
      if (deleteCount > 0) scratchpad.delete(index, deleteCount);
      if (insert) scratchpad.insert(index, insert);
    });

    isLocalEdit.current = false;
  };

  const handleCopy = async () => {
    const val = scratchpad.toString();
    if (!val) {
      toast.info('Scratchpad is empty');
      return;
    }
    await navigator.clipboard.writeText(val);
    flashCopied();
    toast.success('Copied scratchpad contents');
  };

  const handleInsertIntoEditor = () => {
    const val = scratchpad.toString();
    if (!val) {
      toast.info('Scratchpad is empty');
      return;
    }
    ws.client.doc.transact(() => {
      const mainText = ws.client.text;
      const current = mainText.toString();
      const insertPos = current.length > 0 && !current.endsWith('\n') ? '\n\n' : '\n';
      mainText.insert(mainText.length, insertPos + val);
    });
    toast.success('Appended scratchpad into main document');
  };

  const handleClear = () => {
    if (scratchpad.length === 0) return;
    ws.client.doc.transact(() => {
      scratchpad.delete(0, scratchpad.length);
    });
    setText('');
    toast.success('Cleared scratchpad');
  };

  const lines = text.length > 0 ? text.split('\n').length : 0;
  const chars = text.length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Scratchpad Subheader */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/40 px-2 text-micro text-muted-foreground">
        <span className="font-mono tabular">
          {lines} {lines === 1 ? 'line' : 'lines'} · {chars} chars
        </span>
        <div className="flex items-center gap-1">
          <Tip label="Copy all">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Copy scratchpad contents"
              onClick={() => void handleCopy()}
            >
              <MorphIcon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={13} />
            </Button>
          </Tip>

          {isHost && (
            <>
              <Tip label="Append to main document">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Insert into main editor"
                  onClick={handleInsertIntoEditor}
                >
                  <Icon icon={ArrowRight01Icon} size={14} />
                </Button>
              </Tip>
              <Tip label="Hold to clear scratchpad">
                <HoldButton
                  disabled={!text}
                  onConfirm={handleClear}
                  holdMs={1000}
                  holdingLabel="Clearing…"
                  className="h-6 px-2 text-micro text-muted-foreground hover:text-destructive"
                >
                  <Icon icon={Delete02Icon} size={12} />
                  <span>Clear</span>
                </HoldButton>
              </Tip>
            </>
          )}
        </div>
      </div>

      {/* Real-time collaborative editor area */}
      <div className="relative min-h-0 flex-1 p-2">
        <textarea
          value={text}
          onChange={handleChange}
          placeholder="Shared scratchpad for auxiliary snippets, error logs, and test data. All keystrokes sync live with your team..."
          className="size-full resize-none rounded-lg border border-border/50 bg-background/50 p-2.5 font-mono text-caption leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none"
          spellCheck={false}
          aria-label="Shared scratchpad"
        />
      </div>
    </div>
  );
}
