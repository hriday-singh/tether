'use client';

import { AlertCircleIcon, Copy01Icon, Download04Icon, Home01Icon } from '@hugeicons/core-free-icons';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { SettingsDialog } from '@/components/settings-dialog';
import { Button } from '@/components/ui/button';
import { Kbd, Segmented, Skeleton } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ResizableGroup, ResizableHandle, ResizablePanel, useDefaultLayout, usePanelRef } from '@/components/ui/resizable';
import { toast } from '@/components/ui/toaster';
import { useMediaQuery, useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import type { RoomSession } from '@/lib/session';
import type { SyncClient } from '@/lib/sync';
import { cn, isMac } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { createWorkspace, useWorkspace, WorkspaceProvider } from './context';
import { DiagnosticsDrawer } from './drawer';
import { HostSheet } from './host-sheet';
import { FollowController, OffscreenCursors } from './presence-overlays';
import { PreviewPane } from './preview-pane';
import { Sidebar } from './sidebar';
import { StatusBar } from './status-bar';
import { TopBar } from './top-bar';

// Editor is client-only and code-split (docs/07).
const Editor = dynamic(() => import('./editor/editor'), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-2 p-4">
      {Array.from({ length: 8 }, (_, i) => (
        <Skeleton key={i} className="h-4" style={{ width: `${40 + ((i * 37) % 50)}%` }} />
      ))}
    </div>
  ),
});

const card = 'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card shadow-card';
const storage = typeof window === 'undefined' ? undefined : window.localStorage;

export function Workspace({ client, roomId, session }: { client: SyncClient; roomId: string; session: RoomSession }) {
  const ws = useMemo(() => createWorkspace(client, roomId, session), [client, roomId, session]);
  return (
    <WorkspaceProvider value={ws}>
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const ws = useWorkspace();
  const status = useStore(ws.client.status);
  const ui = useStore(ws.ui);
  const language = languageInfo(useStore(ws.client.room).room.language);
  const wide = useMediaQuery('(min-width: 1280px)');
  const kicked = status.connection === 'kicked';
  const showPreviewPane = wide && language.preview !== null;
  const drawer = usePanelRef();

  useGlobalShortcuts();

  // Sync the drawer panel with ui.drawerOpen, both ways.
  useEffect(() => {
    const p = drawer.current;
    if (!p) return;
    if (ui.drawerOpen && p.isCollapsed()) p.expand();
    if (!ui.drawerOpen && !p.isCollapsed()) p.collapse();
  }, [ui.drawerOpen, drawer]);

  const horizontalIds = showPreviewPane ? ['editor', 'preview', 'sidebar'] : ['editor', 'sidebar'];
  const hLayout = useDefaultLayout({ id: `tether:layout:h:${horizontalIds.length}`, panelIds: horizontalIds, storage });
  const vLayout = useDefaultLayout({ id: 'tether:layout:v', panelIds: ['main', 'drawer'], storage });

  return (
    <div className="flex h-dvh flex-col gap-2 bg-background p-2.5">
      <TopBar />
      {kicked && <KickedBanner />}
      <main className="min-h-0 flex-1">
        <ResizableGroup orientation="vertical" defaultLayout={vLayout.defaultLayout} onLayoutChanged={vLayout.onLayoutChanged}>
          <ResizablePanel id="main" minSize="30">
            <ResizableGroup key={horizontalIds.join()} orientation="horizontal" defaultLayout={hLayout.defaultLayout} onLayoutChanged={hLayout.onLayoutChanged}>
              <ResizablePanel id="editor" minSize={showPreviewPane ? '30' : 600} defaultSize={showPreviewPane ? '50' : '72'}>
                <section aria-label="Editor" className={cn(card, 'relative')}>
                  {!wide && language.preview && (
                    <div className="flex h-10 shrink-0 items-center border-b border-border/60 px-2">
                      <Segmented
                        aria-label="Editor or preview"
                        value={ui.editorView}
                        onValueChange={(v) => ws.ui.update((s) => ({ ...s, editorView: v }))}
                        options={[
                          { value: 'code', label: 'Code' },
                          { value: 'preview', label: 'Preview' },
                        ]}
                      />
                    </div>
                  )}
                  <div className={cn('relative min-h-0 flex-1', !wide && ui.editorView === 'preview' && language.preview && 'hidden')}>
                    <Editor readOnly={kicked} />
                    <OffscreenCursors />
                    <FollowController />
                  </div>
                  {!wide && ui.editorView === 'preview' && language.preview && (
                    <div className="min-h-0 flex-1">
                      <PreviewPane header={false} />
                    </div>
                  )}
                </section>
              </ResizablePanel>
              {showPreviewPane && (
                <>
                  <ResizableHandle />
                  <ResizablePanel id="preview" minSize="20" defaultSize="28" collapsible>
                    <section aria-label="Live preview" className={card}>
                      <PreviewPane />
                    </section>
                  </ResizablePanel>
                </>
              )}
              <ResizableHandle />
              <ResizablePanel id="sidebar" minSize={240} maxSize="40" defaultSize={showPreviewPane ? '22' : '28'}>
                <aside aria-label="People and activity" className={card}>
                  <Sidebar />
                </aside>
              </ResizablePanel>
            </ResizableGroup>
          </ResizablePanel>
          <ResizableHandle className={cn(!ui.drawerOpen && 'pointer-events-none')} />
          <ResizablePanel
            id="drawer"
            panelRef={drawer}
            collapsible
            collapsedSize={0}
            minSize={220}
            defaultSize={0}
            onResize={(size) => {
              const open = size.inPixels > 0;
              if (open !== ws.ui.get().drawerOpen) ws.ui.update((s) => ({ ...s, drawerOpen: open }));
            }}
          >
            <div className={card}>
              <DiagnosticsDrawer onCollapse={() => ws.ui.update((s) => ({ ...s, drawerOpen: false }))} />
            </div>
          </ResizablePanel>
        </ResizableGroup>
      </main>
      <StatusBar />

      <CommandPalette />
      <HostSheet />
      <SettingsDialog
        open={ui.settings}
        onOpenChange={(v) => ws.ui.update((s) => ({ ...s, settings: v }))}
        onLatencyChange={(ms) => ws.client.lab.setLatency(ms)}
      />
      <ShortcutsDialog />
    </div>
  );
}

function useGlobalShortcuts() {
  const ws = useWorkspace();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        ws.ui.update((s) => ({ ...s, palette: s.palette ? false : 'commands' }));
      } else if (mod && e.key === ',') {
        e.preventDefault();
        ws.ui.update((s) => ({ ...s, settings: true }));
      } else if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (ws.running.get()) ws.stop();
        else void ws.run();
      } else if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        ws.ui.update((s) => ({ ...s, drawerOpen: !s.drawerOpen }));
      } else if (e.key === '?' && !typing) {
        e.preventDefault();
        ws.ui.update((s) => ({ ...s, shortcuts: true }));
      } else if (e.key === 'Escape') {
        // Esc stops follow and returns focus to the editor (docs/07 a11y). Open dialogs handle their own Esc first.
        if (ws.follow.get()) ws.follow.set(null);
        const ui = ws.ui.get();
        if (!ui.palette && !ui.settings && !ui.shortcuts && !ui.hostSheet && !target?.closest('.cm-editor')) ws.focusEditor();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws]);
}

function ShortcutsDialog() {
  const ws = useWorkspace();
  const open = useStore(ws.ui).shortcuts;
  const m = isMac() ? '⌘' : 'Ctrl';
  const rows: [string, string][] = [
    [`${m} K`, 'Command palette'],
    [`${m} K  ${m} T`, 'Color theme quick pick'],
    [`${m} ,`, 'Settings'],
    [`${m} Enter`, 'Run / stop code'],
    ['Alt H', 'Highlight current lines for everyone'],
    ['Ctrl `', 'Toggle diagnostics drawer'],
    ['Esc', 'Stop following, back to editor'],
    ['Esc then Tab', 'Move focus out of the editor'],
    [`${m} F`, 'Find in document'],
    [`${m} Z / ${m} Shift Z`, 'Undo / redo (your edits only)'],
    ['?', 'This list'],
  ];
  return (
    <Dialog open={open} onOpenChange={(v) => ws.ui.update((s) => ({ ...s, shortcuts: v }))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Every control is also reachable with Tab.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
          {rows.map(([k, label]) => (
            <div key={k} className="contents">
              <dt>
                <Kbd>{k}</Kbd>
              </dt>
              <dd className="text-body text-muted-foreground">{label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

/** Close 4003: the editor goes read-only and the local buffer is one click away (never lost). */
function KickedBanner() {
  const ws = useWorkspace();
  const unsaved = useStore(ws.client.status).unsavedAtClose;
  const text = () => ws.client.text.toString();
  const ext = languageInfo(ws.client.room.get().room.language).ext;
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-warning/50 bg-warning/10 px-3 py-2 text-body">
      <Icon icon={AlertCircleIcon} className="text-warning" />
      <p className="flex-1">
        The host removed you from this room.{' '}
        {unsaved > 0 ? (
          <strong className="font-medium">
            {unsaved} change{unsaved === 1 ? ' was' : 's were'} not saved.
          </strong>
        ) : (
          'Your document is read-only now.'
        )}
      </p>
      <Button size="sm" onClick={() => void navigator.clipboard.writeText(text()).then(() => toast.success('Your version is on the clipboard'))}>
        <Icon icon={Copy01Icon} size={14} /> Copy My Document
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }));
          Object.assign(document.createElement('a'), { href: url, download: `${ws.roomId}.${ext}` }).click();
          URL.revokeObjectURL(url);
        }}
      >
        <Icon icon={Download04Icon} size={14} /> Download File
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <Link href="/">
          <Icon icon={Home01Icon} size={14} /> Home
        </Link>
      </Button>
    </div>
  );
}
