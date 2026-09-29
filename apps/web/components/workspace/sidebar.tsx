'use client';

import {
  BotIcon,
  CrownIcon,
  MoreHorizontalIcon,
  UserRemove01Icon,
  UserSwitchIcon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons/core-free-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { AuditEvent, Member } from '@tether/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, Tip } from '@/components/ui/controls';
import { HoldButton } from '@/components/ui/hold-button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { toast } from '@/components/ui/toaster';
import { api } from '@/lib/api';
import { FeedStore } from '@/lib/feed-store';
import { useStore } from '@/lib/hooks';
import { CommandError, type PresenceEntry } from '@/lib/sync';
import { cn } from '@/lib/utils';
import { useWorkspace } from './context';
import { describeEvent } from './events';

export function Sidebar() {
  const ws = useWorkspace();
  const tab = useStore(ws.ui).sidebarTab;
  const count = useStore(ws.client.roster).length;
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => ws.ui.update((s) => ({ ...s, sidebarTab: v as 'people' | 'activity' }))}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="flex items-center border-b border-border/60 p-2">
        <TabsList aria-label="Sidebar">
          <TabsTrigger value="people">
            People <span className="tabular text-muted-foreground">{count}</span>
          </TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="people" className="min-h-0 flex-1 overflow-y-auto p-1.5" forceMount hidden={tab !== 'people'}>
        <Roster />
      </TabsContent>
      <TabsContent value="activity" className="min-h-0 flex-1" forceMount hidden={tab !== 'activity'}>
        <ActivityFeed />
      </TabsContent>
    </Tabs>
  );
}

// ------------------------------------------------------------------ Roster

function Roster() {
  const ws = useWorkspace();
  const roster = useStore(ws.client.roster);
  const presence = useStore(ws.client.presence);
  const room = useStore(ws.client.room);
  const following = useStore(ws.follow);
  const isHost = room.hostId === room.selfId;
  return (
    <ul className="flex flex-col gap-0.5" aria-label="People in this room">
      {roster.map((m) => (
        <RosterRow
          key={m.id}
          member={m}
          presence={presence.get(m.id)}
          isSelf={m.id === room.selfId}
          viewerIsHost={isHost}
          following={following === m.id}
        />
      ))}
    </ul>
  );
}

const RosterRow = memo(function RosterRow({
  member: m,
  presence,
  isSelf,
  viewerIsHost,
  following,
}: {
  member: Member;
  presence: readonly PresenceEntry[] | undefined;
  isSelf: boolean;
  viewerIsHost: boolean;
  following: boolean;
}) {
  const ws = useWorkspace();
  const typing = presence?.some((p) => p.typing) ?? false;
  const reconnecting = m.status === 'reconnecting';
  const hasCursor = presence?.some((p) => p.hasCursor) ?? false;
  const statusText = reconnecting ? 'reconnecting…' : typing ? 'typing' : m.status === 'active' ? '' : m.status;

  const jump = () => {
    if (isSelf) return ws.focusEditor();
    if (!ws.jumpTo(m.id)) toast.info(`${m.name} has no cursor in the document yet`);
  };

  return (
    <li
      className={cn(
        'group flex items-center gap-2 rounded-xl px-2 py-1.5 transition-ui hover:bg-accent/60',
        following && 'bg-primary/10 ring-1 ring-primary/30',
      )}
    >
      <button
        type="button"
        onClick={jump}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${m.name}${isSelf ? ' (you)' : ''}${m.isHost ? ', host' : ''}${statusText ? `, ${statusText}` : ''}. ${isSelf ? 'Focus editor' : 'Jump to cursor'}`}
      >
        <Avatar name={m.name} colorIndex={m.colorIndex} isBot={m.isBot} dimmed={reconnecting} />
        <span className={cn('flex min-w-0 flex-col', reconnecting && 'opacity-60')}>
          <span className="flex items-center gap-1.5 text-body font-medium">
            <span className="truncate">{m.name}</span>
            {isSelf && <span className="text-caption font-normal text-muted-foreground">(you)</span>}
            {m.isHost && (
              <span className="inline-flex items-center gap-0.5 text-micro font-medium text-warning">
                <Icon icon={CrownIcon} size={12} /> Host
              </span>
            )}
            {m.isBot && (
              <Badge>
                <Icon icon={BotIcon} size={10} /> bot
              </Badge>
            )}
          </span>
          <span className="flex h-4 items-center gap-1.5 text-caption text-muted-foreground">
            {typing && !reconnecting && <TypingDots />}
            {statusText}
          </span>
        </span>
      </button>
      {!isSelf && hasCursor && (
        <Tip label={following ? 'Stop following (Esc)' : `Follow ${m.name}`}>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-pressed={following}
            aria-label={following ? `Stop following ${m.name}` : `Follow ${m.name}`}
            onClick={() => ws.follow.set(following ? null : m.id)}
            className={cn(!following && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
          >
            <Icon icon={following ? ViewOffIcon : ViewIcon} size={14} className={following ? 'text-primary' : undefined} />
          </Button>
        </Tip>
      )}
      {viewerIsHost && !isSelf && !m.isBot && <HostRowActions member={m} />}
    </li>
  );
});

function TypingDots() {
  return (
    <span aria-hidden className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1 rounded-full bg-primary animate-pulse-soft" style={{ animationDelay: `${i * 160}ms` }} />
      ))}
    </span>
  );
}

function HostRowActions({ member }: { member: Member }) {
  const { client } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(`${label} failed`, { description: e instanceof CommandError ? e.code : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Host actions for ${member.name}`} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
          <Icon icon={MoreHorizontalIcon} size={14} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-56 flex-col gap-2">
        <p className="text-caption font-medium text-muted-foreground">{member.name}</p>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || member.status === 'reconnecting'}
          onClick={() => void run('Transfer', () => client.command({ t: 'host.transfer', memberId: member.id }))}
        >
          <Icon icon={UserSwitchIcon} size={14} /> Make host
        </Button>
        <HoldButton disabled={busy} onConfirm={() => void run('Kick', () => client.command({ t: 'host.kick', memberId: member.id }))}>
          <Icon icon={UserRemove01Icon} size={14} /> Hold to remove
        </HoldButton>
      </PopoverContent>
    </Popover>
  );
}

// ------------------------------------------------------------------ Activity feed

const PAGE = 50;

function ActivityFeed() {
  const ws = useWorkspace();
  const { client, roomId, session } = ws;
  const feed = useMemo(() => new FeedStore(), []);
  const { items } = useStore(feed.snapshot);
  const eventSeq = useStore(client.room).eventSeq;
  const connection = useStore(client.status).connection;
  const [announcement, setAnnouncement] = useState('');

  // History pages (newest first), scrolled into view lazily.
  const history = useInfiniteQuery({
    queryKey: ['events', roomId, session.token],
    queryFn: ({ pageParam }) => api.events(roomId, session.token, { before: pageParam ?? undefined, limit: PAGE }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  useEffect(() => {
    history.data?.pages.forEach((p) => feed.add(p.items));
  }, [history.data, feed]);

  // Live pushes land in the same seq map (deduped). Announce at most one every 2 s.
  useEffect(() => {
    let pending: AuditEvent | null = null;
    const timer = setInterval(() => {
      if (pending) setAnnouncement(describeEvent(pending).text);
      pending = null;
    }, 2000);
    const off = client.onEvent((e) => {
      feed.add([e]);
      pending = e;
    });
    return () => {
      off();
      clearInterval(timer);
    };
  }, [client, feed]);

  // Gap-fill after welcome/reconnect or a skipped live seq (docs/04).
  useEffect(() => {
    if (connection !== 'online' || !history.isSuccess) return;
    let cancelled = false;
    const fill = async () => {
      if (feed.shouldResetFor(eventSeq)) {
        feed.reset();
        void history.refetch();
        return;
      }
      for (let after = feed.gapAfter(eventSeq); after !== null && !cancelled; after = feed.gapAfter(eventSeq)) {
        const page = await api.events(roomId, session.token, { after, limit: 100 }).catch(() => null);
        if (!page || page.items.length === 0) break;
        feed.add(page.items);
      }
    };
    void fill();
    return () => {
      cancelled = true;
    };
  }, [eventSeq, connection, history.isSuccess, feed, roomId, session.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const scroller = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns fresh functions by design
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 44,
    overscan: 8,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.at(-1)?.index ?? 0;
  useEffect(() => {
    if (lastIndex >= items.length - 5 && history.hasNextPage && !history.isFetchingNextPage) void history.fetchNextPage();
  }, [lastIndex, items.length, history]);

  if (history.isPending) {
    return (
      <div className="flex flex-col gap-2 p-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }

  return (
    <div ref={scroller} className="h-full overflow-y-auto overscroll-contain p-1.5" aria-label="Activity feed">
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      {items.length === 0 && <p className="p-4 text-center text-caption text-muted-foreground">No activity yet.</p>}
      <ol className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((row) => {
          const e = items[row.index]!;
          return (
            <li
              key={e.seq}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <FeedItem event={e} />
            </li>
          );
        })}
      </ol>
      {history.isFetchingNextPage && <p className="p-2 text-center text-micro text-muted-foreground">Loading older…</p>}
    </div>
  );
}

const TONE = {
  neutral: 'text-muted-foreground',
  primary: 'text-primary',
  warning: 'text-warning',
  destructive: 'text-destructive',
  success: 'text-success',
} as const;

const FeedItem = memo(function FeedItem({ event }: { event: AuditEvent }) {
  const view = describeEvent(event);
  const time = new Date(event.createdAt);
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-caption">
      <Icon icon={view.icon} size={14} className={cn('mt-0.5', TONE[view.tone])} />
      <span className="min-w-0 flex-1 text-foreground">{view.text}</span>
      <time dateTime={event.createdAt} className="shrink-0 font-mono text-micro text-muted-foreground tabular">
        {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </time>
    </div>
  );
});
