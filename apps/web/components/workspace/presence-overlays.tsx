'use client';

import { ArrowDown01Icon, ArrowUp01Icon, ViewIcon } from '@hugeicons/core-free-icons';
import { EditorView } from '@codemirror/view';
import { useEffect } from 'react';
import { presenceClass } from '@/lib/presence';
import { Tip } from '@/components/ui/controls';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { toast } from '@/components/ui/toaster';
import { usePrefs } from '@/components/providers';
import { useStore } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useWorkspace } from './context';
import { remoteHead, type OffscreenCursor } from './editor/collab';

const MAX_PER_EDGE = 3;

/** Edge chips for remote cursors outside the viewport: "Alex L212". Click to jump; more than 3 per edge collapse to +n. */
export function OffscreenCursors() {
  const ws = useWorkspace();
  const { prefs } = usePrefs();
  const list = useStore(ws.offscreen);
  if (!prefs.offscreenCursorBadges || list.length === 0) return null;
  return (
    <>
      <Edge items={list.filter((c) => c.edge === 'top')} edge="top" />
      <Edge items={list.filter((c) => c.edge === 'bottom')} edge="bottom" />
    </>
  );
}

function Edge({ items, edge }: { items: OffscreenCursor[]; edge: 'top' | 'bottom' }) {
  const ws = useWorkspace();
  if (!items.length) return null;
  const shown = items.slice(0, MAX_PER_EDGE);
  const rest = items.slice(MAX_PER_EDGE);
  const jump = (c: OffscreenCursor) =>
    ws.view.current?.dispatch({ effects: EditorView.scrollIntoView(c.pos, { y: 'center' }) });
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 z-10 flex justify-end gap-1.5 px-3', edge === 'top' ? 'top-2' : 'bottom-2')}>
      {shown.map((c) => (
        <button
          key={c.clientId}
          type="button"
          onClick={() => jump(c)}
          className={cn(
            presenceClass(c.colorIndex),
            'pointer-events-auto inline-flex h-6 animate-fade-in items-center gap-1 rounded-full bg-(--p) px-2 text-micro font-medium text-presence-ink shadow-capsule transition-ui hover:scale-105 motion-reduce:animate-none',
          )}
          aria-label={`${c.name} is at line ${c.line}, ${edge === 'top' ? 'above' : 'below'}. Jump there`}
        >
          <Icon icon={edge === 'top' ? ArrowUp01Icon : ArrowDown01Icon} size={12} />
          {c.name} <span className="font-mono tabular">L{c.line}</span>
        </button>
      ))}
      {rest.length > 0 && (
        <Tip label={rest.map((c) => `${c.name} L${c.line}`).join(', ')}>
          <button
            type="button"
            onClick={() => jump(rest[0]!)}
            className="pointer-events-auto inline-flex h-6 items-center rounded-full border border-border bg-card px-2 text-micro font-medium shadow-capsule"
          >
            +{rest.length}
          </button>
        </Tip>
      )}
    </div>
  );
}

/**
 * Follow mode: keeps the target's cursor in view, one scroll per presence snapshot (already coalesced per frame).
 * Stops on own keypress/scroll (editor handlers), on Esc, or when the target leaves. For the same member in
 * two tabs, it follows the most recently active one.
 */
export function FollowController() {
  const ws = useWorkspace();
  const { client } = ws;
  const target = useStore(ws.follow);
  const presence = useStore(client.presence);
  const roster = useStore(client.roster);

  useEffect(() => {
    if (!target) return;
    const member = roster.find((m) => m.id === target);
    if (!member) {
      ws.follow.set(null);
      toast.info('Follow stopped: they left the room');
      return;
    }
    const entry = presence.get(target)?.find((e) => e.hasCursor);
    const view = ws.view.current;
    const pos = entry ? remoteHead(client.awareness, client.text, entry.clientId) : null;
    if (view && pos !== null) view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'nearest', yMargin: 80 }) });
  }, [target, presence, roster, client, ws]);

  if (!target) return null;
  const name = roster.find((m) => m.id === target)?.name ?? '';
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex justify-center">
      <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-primary/30 bg-card px-3 py-1 text-caption shadow-capsule">
        <Icon icon={ViewIcon} size={14} className="text-primary" />
        Following <strong className="font-medium">{name}</strong>
        <Button size="xs" variant="ghost" onClick={() => ws.follow.set(null)}>
          Stop <span className="text-muted-foreground">Esc</span>
        </Button>
      </div>
    </div>
  );
}
