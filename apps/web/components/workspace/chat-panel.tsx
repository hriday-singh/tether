'use client';

import { Alert02Icon, BubbleChatIcon, Cancel01Icon, SentIcon } from '@hugeicons/core-free-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CHAT_MAX_CHARS, type ChatCodeRef, type ChatMessage } from '@tether/shared';
import { memo, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton, Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { FormattedTime } from '@/components/ui/formatted-time';
import { Textarea } from '@/components/ui/input';
import { api } from '@/lib/api';
import { codeRefLabel } from '@/lib/code-ref';
import { buildChatRows, CHAT_COUNTER_FROM, type ChatRowView, type PendingChat } from '@/lib/chat';
import { FeedStore, fillGaps } from '@/lib/feed-store';
import { useStore } from '@/lib/hooks';
import { CommandError } from '@/lib/sync';
import { cn } from '@/lib/utils';
import { useWorkspace } from './context';

const PAGE = 50;
const LOAD_OLDER_PX = 80;

const FAIL_TEXT: Record<string, string> = {
  rate_limited: 'Sending too fast',
  offline: 'You are offline',
};

/**
 * Room chat (ADR-017). Same delivery rules as the activity feed: REST history + live pushes merged by seq,
 * gap-filled after reconnect. Never touches the Yjs doc.
 * ponytail: not virtualized. `flex-col-reverse` gives bottom anchoring and stable prepends for free.
 * Virtualize if rooms keep more than ~1k loaded messages.
 */
export function ChatPanel({ active }: { active: boolean }) {
  const ws = useWorkspace();
  const { client, roomId, session } = ws;
  const feed = useMemo(() => new FeedStore<ChatMessage>(), []);
  const { items } = useStore(feed.snapshot);
  const room = useStore(client.room);
  const roster = useStore(client.roster);
  const connection = useStore(client.status).connection;
  const attachment = useStore(ws.chatRef);
  const [pending, setPending] = useState<readonly PendingChat[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  const selfMember = roster.find((m) => m.id === room.selfId);
  const self = { id: room.selfId, name: selfMember?.name ?? 'You', colorIndex: selfMember?.colorIndex ?? 0 };

  const history = useInfiniteQuery({
    queryKey: ['chat', roomId, session.token],
    queryFn: ({ pageParam }) => api.chat(roomId, session.token, { before: pageParam ?? undefined, limit: PAGE }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  useEffect(() => {
    history.data?.pages.forEach((p) => feed.add(p.items));
  }, [history.data, feed]);

  useEffect(
    () =>
      client.onChat((m) => {
        feed.add([m]);
        if (m.memberId !== client.room.get().selfId) setAnnouncement(`${m.name}: ${m.text.slice(0, 140)}`);
      }),
    [client, feed],
  );

  // Gap-fill after welcome/reconnect or a skipped live seq (docs/04, same as the activity feed).
  useEffect(() => {
    if (connection !== 'online' || !history.isSuccess) return;
    let cancelled = false;
    const fill = async () => {
      if (feed.shouldResetFor(room.chatSeq)) {
        feed.reset();
        void history.refetch();
        return;
      }
      await fillGaps(feed, room.chatSeq, (after, limit) => api.chat(roomId, session.token, { after, limit }).catch(() => null), () => cancelled);
    };
    void fill();
    return () => {
      cancelled = true;
    };
  }, [room.chatSeq, connection, history.isSuccess, feed, roomId, session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (active) ws.chatUnread.set(0);
  }, [active, items.length, ws.chatUnread]);

  const rows = useMemo(() => buildChatRows(items, pending, self), [items, pending, self.id, self.name, self.colorIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const discard = (clientMsgId: string) => setPending((p) => p.filter((x) => x.clientMsgId !== clientMsgId));
  const send = async (text: string, ref: ChatCodeRef | null, clientMsgId: string = crypto.randomUUID()) => {
    const createdAt = new Date().toISOString();
    setPending((p) => [...p.filter((x) => x.clientMsgId !== clientMsgId), { clientMsgId, text, ref, createdAt, state: 'sending' }]);
    scroller.current?.scrollTo({ top: 0 });
    try {
      await client.sendChat(clientMsgId, text, ref ?? undefined);
      // chat.msg lands before ok, so the confirmed row already replaced this one.
      discard(clientMsgId);
    } catch (e) {
      const error = e instanceof CommandError ? e.code : 'error';
      setPending((p) => p.map((x) => (x.clientMsgId === clientMsgId ? { ...x, state: 'failed', error } : x)));
    }
  };

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !history.hasNextPage || history.isFetchingNextPage) return;
    // Column-reverse: scrollTop is 0 at the bottom and grows negative upwards.
    if (el.scrollHeight - el.clientHeight - Math.abs(el.scrollTop) < LOAD_OLDER_PX) void history.fetchNextPage();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {history.isPending ? (
        <div className="flex flex-1 flex-col justify-end gap-2 p-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain p-1.5"
          aria-label="Chat messages"
        >
          {rows.length === 0 ? (
            <div className="m-auto flex max-w-56 flex-col items-center gap-2 p-4 text-center">
              <Icon icon={BubbleChatIcon} size={20} className="text-muted-foreground" />
              <p className="text-caption text-muted-foreground">
                No messages yet. Chat stays in this room and never touches the code.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col-reverse">
              {rows.map((row) => (
                <ChatRow
                  key={row.clientMsgId}
                  row={row}
                  isSelf={row.memberId === self.id}
                  onRetry={() => void send(row.text, row.ref, row.clientMsgId)}
                  onOpenRef={ws.revealCodeRef}
                  onDiscard={() => discard(row.clientMsgId)}
                />
              ))}
            </ol>
          )}
          {history.isFetchingNextPage && <p className="p-2 text-center text-micro text-muted-foreground">Loading older…</p>}
        </div>
      )}
      <ChatComposer
        online={connection === 'online'}
        attachment={attachment}
        onClearAttachment={() => ws.chatRef.set(null)}
        onSend={(text) => {
          ws.chatRef.set(null);
          void send(text, attachment);
        }}
      />
    </div>
  );
}

const ChatRow = memo(function ChatRow({
  row,
  isSelf,
  onRetry,
  onDiscard,
  onOpenRef,
}: {
  row: ChatRowView;
  isSelf: boolean;
  onRetry: () => void;
  onDiscard: () => void;
  onOpenRef: (ref: ChatCodeRef) => boolean;
}) {
  return (
    <li className={cn('flex gap-2.5 rounded-lg px-2 py-0.5 transition-ui hover:bg-accent/40', row.head && 'mt-2')}>
      <span className="w-6 shrink-0 pt-0.5">{row.head && <Avatar name={row.name} colorIndex={row.colorIndex} size="sm" />}</span>
      <div className="min-w-0 flex-1">
        {row.head && (
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-caption font-medium text-foreground">{row.name}</span>
            {isSelf && <span className="text-micro text-muted-foreground">(you)</span>}
            <FormattedTime date={row.createdAt} className="ml-auto shrink-0 font-mono text-micro text-muted-foreground tabular" />
          </div>
        )}
        {row.ref && <CodeQuote codeRef={row.ref} onOpen={onOpenRef} />}
        {/* Plain text only: React escapes it, and chat never renders HTML. */}
        {row.text.startsWith('```') && row.text.endsWith('```') ? (
          <pre className="rounded-lg border border-border/60 bg-card/80 p-2 font-mono text-micro overflow-x-auto whitespace-pre-wrap text-foreground">
            {row.text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '')}
          </pre>
        ) : (
          <p
            className={cn(
              'whitespace-pre-wrap break-words text-body text-foreground transition-ui',
              row.state === 'sending' && 'opacity-60',
              row.state === 'failed' && 'text-destructive',
            )}
          >
            {row.text}
          </p>
        )}
        {row.state === 'failed' && (
          <div className="flex items-center gap-1 text-micro text-destructive">
            <Icon icon={Alert02Icon} size={12} />
            <span>Not sent. {FAIL_TEXT[row.error ?? ''] ?? 'Something went wrong'}.</span>
            <Button size="xs" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
            <Button size="xs" variant="ghost" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        )}
      </div>
    </li>
  );
});

/** Quoted code in a message. Click selects that code in the editor (following later edits). */
function CodeQuote({ codeRef, onOpen }: { codeRef: ChatCodeRef; onOpen: (ref: ChatCodeRef) => boolean }) {
  const label = codeRefLabel(codeRef);
  return (
    <button
      type="button"
      onClick={() => onOpen(codeRef)}
      aria-label={`Show ${label} in the editor`}
      className="my-1 block w-full overflow-hidden rounded-lg border border-border/60 bg-card/80 text-left transition-ui hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="block border-b border-border/60 px-2 py-0.5 font-mono text-micro text-primary">{label}</span>
      <pre className="line-clamp-6 whitespace-pre-wrap break-words p-2 font-mono text-micro text-muted-foreground">{codeRef.snippet}</pre>
    </button>
  );
}

/** Enter sends, Shift+Enter adds a line. The draft survives going offline; only sending waits. */
export function ChatComposer({
  online,
  onSend,
  attachment = null,
  onClearAttachment,
}: {
  online: boolean;
  onSend: (text: string) => void;
  /** Code quoted from the editor, sent along with the next message. */
  attachment?: ChatCodeRef | null;
  onClearAttachment?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // Quoting code is a "start typing about this" gesture: put the caret in the box.
  useEffect(() => {
    if (attachment) input.current?.focus();
  }, [attachment]);
  const text = draft.trim();
  const remaining = CHAT_MAX_CHARS - draft.length;
  const canSend = online && text.length > 0 && remaining >= 0;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    onSend(text);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1 border-t border-border/60 p-2">
      {attachment && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 py-0.5 pl-2 pr-0.5 animate-fade-in">
          <span className="shrink-0 font-mono text-micro text-primary">{codeRefLabel(attachment)}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted-foreground">{attachment.snippet.trim().split('\n')[0]}</span>
          <Button type="button" size="icon-xs" variant="ghost" aria-label="Remove quoted code" onClick={onClearAttachment}>
            <Icon icon={Cancel01Icon} size={12} />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <Textarea
          ref={input}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && attachment && !draft) onClearAttachment?.();
            onKeyDown(e);
          }}
          maxLength={CHAT_MAX_CHARS}
          placeholder={online ? (attachment ? 'Say something about this code' : 'Message the room') : 'Reconnecting… your draft is kept'}
          aria-label="Chat message"
          aria-describedby="chat-hint"
        />
        <Tip label="Send (Enter)">
          <Button type="submit" size="icon" variant="primary" aria-label="Send message" disabled={!canSend}>
            <Icon icon={SentIcon} size={16} />
          </Button>
        </Tip>
      </div>
      <p id="chat-hint" className="flex h-4 items-center justify-between px-1 text-micro text-muted-foreground">
        <span>Shift+Enter for a new line</span>
        {remaining <= CHAT_COUNTER_FROM && (
          <span className={cn('tabular', remaining <= 20 && 'text-warning')} aria-live="polite">
            {remaining} left
          </span>
        )}
      </p>
    </form>
  );
}
