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
      title="Desktop display required"
      actions={
        <>
          <Button asChild>
            <Link href="/">
              <Icon icon={Home01Icon} /> Return to Home
            </Link>
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            <Icon icon={ArrowReloadHorizontalIcon} /> Recheck Display
          </Button>
        </>
      }
    >
      <p>
        Tether&apos;s multi-pane workspace requires a screen at least 1024 px wide to host editor, presence,
        and diagnostics panels without collisions.
      </p>
      <p className="mt-3 text-caption">Expands automatically when the window is resized.</p>
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
