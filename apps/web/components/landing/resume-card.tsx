'use client';

import { ArrowRight01Icon, Delete02Icon, UserIcon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useMounted } from '@/lib/hooks';
import { sessions, type RecentSession } from '@/lib/session';

export function ResumeCard() {
  const mounted = useMounted();
  const [recent, setRecent] = useState<RecentSession[]>(() => (mounted ? sessions.recent() : []));

  // Sync state once mounted
  if (mounted && recent.length === 0) {
    const list = sessions.recent();
    if (list.length > 0) {
      setRecent(list);
    }
  }

  if (!mounted || recent.length === 0) return null;

  const current = recent[0];
  if (!current) return null;

  const forget = (roomId: string) => {
    sessions.forgetRecent(roomId);
    setRecent(sessions.recent());
  };

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-5 shadow-card transition-ui sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-start gap-3.5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
          <Icon icon={UserIcon} size={20} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-2 rounded-full bg-success animate-pulse-soft" aria-hidden />
            <h3 className="text-body font-semibold tracking-tight text-foreground">
              Resume your session as <span className="text-primary font-bold">{current.name || 'Member'}</span>
            </h3>
          </div>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Previous room:{' '}
            <span className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-micro text-foreground">
              {current.roomId}
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Forget saved session"
          onClick={() => forget(current.roomId)}
          className="text-muted-foreground hover:text-destructive"
        >
          <Icon icon={Delete02Icon} size={15} />
          <span className="hidden sm:inline">Forget</span>
        </Button>
        <Button size="md" asChild>
          <Link href={`/r/${current.roomId}`}>
            Rejoin {current.roomId} <Icon icon={ArrowRight01Icon} size={16} />
          </Link>
        </Button>
      </div>
    </div>
  );
}
