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

/** Bottom status capsule (docs/ui-ux/03): health dot, cursor, encoding, language, peers, host, ping. */
export function StatusBar() {
  const { client, cursorPos } = useWorkspace();
  const status = useStore(client.status);
  const pos = useStore(cursorPos);
  const room = useStore(client.room);
  const roster = useStore(client.roster);
  const stats = useStore(client.stats);
  const host = roster.find((m) => m.id === room.hostId);
  const label = status.connection === 'online' ? 'Online' : status.connection[0]!.toUpperCase() + status.connection.slice(1);

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-3 font-mono text-micro text-muted-foreground shadow-capsule backdrop-blur-md">
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn('size-1.5 rounded-full', DOT[status.connection] ?? 'bg-muted-foreground')} />
        {label}
      </span>
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
      <span className="ml-auto tabular">{roster.length} {roster.length === 1 ? 'Peer' : 'Peers'}</span>
      <Sep />
      <span className="inline-flex items-center gap-1">
        <Icon icon={CrownIcon} size={11} className="text-warning" />
        Host: {host?.name ?? '—'}
      </span>
      <Sep />
      <span className="tabular">Ping: {stats.rtt ?? '--'} ms</span>
    </footer>
  );
}

const Sep = () => <span aria-hidden className="h-3 w-px bg-border" />;
