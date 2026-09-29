'use client';

import { AlertCircleIcon, ArrowReloadHorizontalIcon, Home01Icon, MonitorIcon, PlusSignIcon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Icon, type IconData } from '@/components/ui/icon';

export function CenterCard({ icon, title, children, actions }: { icon: IconData; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <section className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center shadow-card">
        <span className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Icon icon={icon} size={24} />
        </span>
        <h1 className="text-display font-semibold tracking-tight">{title}</h1>
        {children && <div className="text-body text-muted-foreground">{children}</div>}
        {actions && <div className="flex flex-wrap justify-center gap-2 pt-2">{actions}</div>}
      </section>
    </main>
  );
}

/** Workspace barrier below 1024px (docs/ui-ux/03 §3). The SyncClient is paused while this is shown, and widening restores the workspace. */
export function ScreenTooSmallGate() {
  return (
    <CenterCard
      icon={MonitorIcon}
      title="Please try on a bigger screen or refresh"
      actions={
        <>
          <Button onClick={() => window.location.reload()}>
            <Icon icon={ArrowReloadHorizontalIcon} /> Refresh Screen
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">
              <Icon icon={Home01Icon} /> Return to Home
            </Link>
          </Button>
        </>
      }
    >
      <p>
        Tether is a collaborative workspace designed for desktop screens (1024px and wider). Split code editing, presence
        and diagnostics need the room to avoid collisions.
      </p>
      <p className="mt-3 text-caption">Auto-unlocks when the window is expanded.</p>
    </CenterCard>
  );
}

export function RoomNotFound({ roomId }: { roomId: string }) {
  return (
    <CenterCard
      icon={AlertCircleIcon}
      title="Room not found"
      actions={
        <>
          <Button variant="outline" asChild>
            <Link href="/">
              <Icon icon={Home01Icon} /> Return to Home
            </Link>
          </Button>
          <Button asChild>
            <Link href={`/?room=${encodeURIComponent(roomId)}#create`}>
              <Icon icon={PlusSignIcon} /> Create This Room
            </Link>
          </Button>
        </>
      }
    >
      Room <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-caption text-foreground">{roomId}</code> does not exist
      or has expired.
    </CenterCard>
  );
}
