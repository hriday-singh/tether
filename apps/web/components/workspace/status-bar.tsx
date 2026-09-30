'use client';

import { CrownIcon } from '@hugeicons/core-free-icons';
import { Icon } from '@/components/ui/icon';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { cn } from '@/lib/utils';
import { useWorkspace } from './context';

const DOT: Record<string, string> = {
  online: 'bg-success',
  reconnecting: 'bg-warning animate-pulse-soft',
  connecting: 'bg-primary animate-pulse-soft',
  restoring: 'bg-primary animate-pulse-soft',
  offline: 'bg-destructive',
};

import { Tip } from '@/components/ui/controls';

/** Bottom status capsule (docs/ui-ux/03): health dot, cursor, encoding, language, peers, host, ping. */
export function StatusBar() {
  const ws = useWorkspace();
  const { client, cursorPos } = ws;
  const status = useStore(client.status);
  const pos = useStore(cursorPos);
  const room = useStore(client.room);
  const roster = useStore(client.roster);
  const stats = useStore(client.stats);
  const unread = useStore(ws.chatUnread);
  const host = roster.find((m) => m.id === room.hostId);
  const label = status.connection === 'online' ? 'Online' : status.connection[0]!.toUpperCase() + status.connection.slice(1);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-3 font-mono text-micro text-muted-foreground shadow-capsule backdrop-blur-md">
      <Tip label="Click to view connection & sync diagnostics">
        <button
          type="button"
          onClick={() => ws.openDrawerTab('sync')}
          className="inline-flex items-center gap-1.5 transition-ui hover:text-foreground cursor-pointer"
          aria-label="Open sync statistics"
        >
          <span aria-hidden className={cn('size-1.5 rounded-full', DOT[status.connection] ?? 'bg-muted-foreground')} />
          {label}
        </button>
      </Tip>
      <Sep />
      <span className="tabular">
        Ln {pos.line}, Col {pos.col}
        {pos.selected > 0 && ` (${pos.selected} selected)`}
      </span>
      <Sep />
      <span>UTF-8</span>
      <Sep />
      <span>{languageInfo(room.room.language).label}</span>
      {status.throttled && (
        <>
          <Sep />
          <span className="text-warning">Batching (5/s)</span>
        </>
      )}
      {unread > 0 && (
        <Tip label="Open chat">
          <button
            type="button"
            onClick={() => ws.ui.update((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'chat' }))}
            className="ml-auto inline-flex items-center gap-1 tabular text-primary transition-ui hover:text-foreground cursor-pointer"
            aria-label={`Open chat, ${unread} unread`}
          >
            <span aria-hidden className="size-1.5 rounded-full bg-primary animate-pulse-soft" />
            {unread > 99 ? '99+' : unread} new
          </button>
        </Tip>
      )}
      {unread > 0 && <Sep />}
      <Tip label="Click to view member roster">
        <button
          type="button"
          onClick={() => ws.ui.update((s) => ({ ...s, sidebarOpen: true, sidebarTab: 'people' }))}
          className={cn('tabular transition-ui hover:text-foreground cursor-pointer', unread === 0 && 'ml-auto')}
          aria-label="Open member roster"
        >
          {roster.length} {roster.length === 1 ? 'Peer' : 'Peers'}
        </button>
      </Tip>
      <Sep />
      <span className="inline-flex items-center gap-1">
        <Icon icon={CrownIcon} size={11} className="text-warning" />
        Host: {host?.name ?? '—'}
      </span>
      <Sep />
      <Tip label="Click to view live latency and throughput statistics">
        <button
          type="button"
          onClick={() => ws.openDrawerTab('sync')}
          className="tabular transition-ui hover:text-foreground cursor-pointer"
          aria-label="Open latency statistics"
        >
          Ping: {stats.rtt ?? '--'} ms
        </button>
      </Tip>
    </footer>
  );
}

const Sep = () => <span aria-hidden className="h-3 w-px bg-border" />;
