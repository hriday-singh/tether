'use client';

import {
  AlertCircleIcon,
  Cancel01Icon,
  CodeIcon,
  Copy01Icon,
  Download04Icon,
  Home01Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
} from '@hugeicons/core-free-icons';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useEffect, useMemo, useRef } from 'react';
import { SettingsDialog } from '@/components/settings-dialog';
import { Button } from '@/components/ui/button';
import { Kbd, Segmented, Skeleton, Tip } from '@/components/ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ResizableGroup, ResizableHandle, ResizablePanel, useDefaultLayout, usePanelRef } from '@/components/ui/resizable';
import { toast } from '@/components/ui/toaster';
import { formatCode } from '@/lib/formatter';
import { useMediaQuery, useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import type { RoomSession } from '@/lib/session';
import type { SyncClient } from '@/lib/sync';
import { cn, isMac, randomId } from '@/lib/utils';
import { CommandPalette } from './command-palette';
import { createWorkspace, useWorkspace, WorkspaceProvider } from './context';
import { DiagnosticsDrawer } from './drawer';
import { DropZoneOverlay } from './drop-zone';
import { ScreenTooSmallGate } from './gates';
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
  const room = useStore(ws.client.room);
  const language = languageInfo(room.room.language);
  const wide = useMediaQuery('(min-width: 1280px)');
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const kicked = status.connection === 'kicked';
  const hasPreview = language.preview !== null;
  const showPreviewPane = ui.zenMode ? hasPreview : wide && hasPreview && ui.previewOpen;
  const showSidebar = !ui.zenMode && ui.sidebarOpen;
  const drawer = usePanelRef();

  useGlobalShortcuts();

  // Automatically activate preview when switching to a previewable language (e.g. HTML, CSS, Markdown, JSON).
  const prevLangRef = useRef(room.room.language);
  useEffect(() => {
    const prev = prevLangRef.current;
    const current = room.room.language;
    if (prev !== current) {
      prevLangRef.current = current;
      const currInfo = languageInfo(current);
      if (currInfo.preview !== null) {
        ws.ui.update((s) => ({
          ...s,
          previewOpen: true,
          editorView: 'preview',
        }));
        ws.preview.set({ runId: randomId(4), scripts: false });
      }
    }
  }, [room.room.language, ws]);

  // Sync the drawer panel with ui.drawerOpen, both ways.
  useEffect(() => {
    const p = drawer.current;
    if (!p) return;
    if (!ui.zenMode && ui.drawerOpen && p.isCollapsed()) p.expand();
    if ((ui.zenMode || !ui.drawerOpen) && !p.isCollapsed()) p.collapse();
  }, [ui.zenMode, ui.drawerOpen, drawer]);

  const horizontalIds = ['editor'];
  if (showPreviewPane) horizontalIds.push('preview');
  if (showSidebar) horizontalIds.push('sidebar');

  useEffect(() => {
    if (!isDesktop) {
      ws.client.pause();
    } else {
      ws.client.resume();
    }
  }, [isDesktop, ws.client]);

  if (!isDesktop) {
    return <ScreenTooSmallGate />;
  }

  return (
    <div className={cn('flex h-dvh flex-col gap-2 bg-background p-2.5', ui.zenMode && 'p-0')}>
      <DropZoneOverlay />

      {/* Zen Mode Exit Pill */}
      {ui.zenMode && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-full border border-border/80 bg-card/90 px-3 py-1 text-caption text-foreground shadow-card backdrop-blur-md">
          <span className="font-medium">Zen Mode</span>
          <span className="text-muted-foreground text-micro">(Esc to exit)</span>
          <Button size="icon-xs" variant="ghost" onClick={() => ws.ui.update((s) => ({ ...s, zenMode: false }))}>
            <Icon icon={Cancel01Icon} size={13} />
          </Button>
        </div>
      )}

      {!ui.zenMode && <TopBar />}
      {kicked && <KickedBanner />}

      <main className="min-h-0 flex-1 relative">
        {ui.zenMode ? (
          <DesktopResizableLayout
            kicked={kicked}
            wide={wide}
            showPreviewPane={showPreviewPane}
            showSidebar={showSidebar}
            horizontalIds={horizontalIds}
            languagePreview={language.preview !== null}
            drawer={drawer}
          />
        ) : ui.maximizedPanel ? (
          <MaximizedPanelView
            kicked={kicked}
            onRestore={() => ws.maximizePanel(null)}
          />
        ) : (
          <DesktopResizableLayout
            kicked={kicked}
            wide={wide}
            showPreviewPane={showPreviewPane}
            showSidebar={showSidebar}
            horizontalIds={horizontalIds}
            languagePreview={language.preview !== null}
            drawer={drawer}
          />
        )}
      </main>
      {!ui.zenMode && <StatusBar />}

      <CommandPalette />
      <HostSheet />
      <SettingsDialog
        open={ui.settings}
        section={ui.settingsSection ?? 'appearance'}
        onSectionChange={(sec) => ws.ui.update((s) => ({ ...s, settingsSection: sec }))}
        onOpenChange={(v) => ws.ui.update((s) => ({ ...s, settings: v }))}
        onLatencyChange={(ms) => ws.client.lab.setLatency(ms)}
      />
      <ShortcutsDialog />
    </div>
  );
}

function MaximizedPanelView({
  kicked,
  onRestore,
}: {
  kicked: boolean;
  onRestore: () => void;
}) {
  return (
    <section aria-label="Editor" className={cn(card, 'relative flex size-full min-h-0 flex-col')}>
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-2.5">
        <div className="flex items-center gap-1.5 text-caption font-medium">
          <Icon icon={CodeIcon} size={14} className="text-muted-foreground" />
          <span>Editor</span>
          <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-micro font-medium text-primary">
            Maximized
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Tip label="Restore editor">
            <Button size="icon-xs" variant="ghost" onClick={onRestore} aria-label="Restore editor">
              <Icon icon={MinimizeScreenIcon} size={14} />
            </Button>
          </Tip>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Editor readOnly={kicked} />
        <OffscreenCursors />
        <FollowController />
      </div>
    </section>
  );
}

function DesktopEditorPanel({
  kicked,
  wide,
  languagePreview,
  showPreviewPane,
  showSidebar,
}: {
  kicked: boolean;
  wide: boolean;
  languagePreview: boolean;
  showPreviewPane: boolean;
  showSidebar: boolean;
}) {
  const ws = useWorkspace();
  const ui = useStore(ws.ui);

  return (
    <ResizablePanel id="editor" minSize={showPreviewPane || showSidebar ? '30' : 600} defaultSize={showPreviewPane ? '50' : '72'}>
      <section aria-label="Editor" className={cn(card, 'relative flex h-full min-h-0 flex-col')}>
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-2.5">
          {!wide && languagePreview ? (
            <Segmented
              aria-label="Editor or preview"
              value={ui.editorView}
              onValueChange={(v) => ws.ui.update((s) => ({ ...s, editorView: v }))}
              options={[
                { value: 'code', label: 'Code' },
                { value: 'preview', label: 'Preview' },
              ]}
            />
          ) : (
            <div className="flex items-center gap-1.5 text-caption font-medium">
              <Icon icon={CodeIcon} size={14} className="text-muted-foreground" />
              <span>Editor</span>
            </div>
          )}
          {!ui.zenMode && (
            <div className="ml-auto flex items-center gap-1">
              <Tip label="Maximize editor">
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => ws.maximizePanel('editor')}
                  aria-label="Maximize editor"
                >
                  <Icon icon={MaximizeScreenIcon} size={14} />
                </Button>
              </Tip>
            </div>
          )}
        </div>

        <div className={cn('relative min-h-0 flex-1', !wide && ui.editorView === 'preview' && languagePreview && 'hidden')}>
          <Editor readOnly={kicked} />
          <OffscreenCursors />
          <FollowController />
        </div>
        {!wide && ui.editorView === 'preview' && languagePreview && (
          <div className="min-h-0 flex-1">
            <PreviewPane header={false} />
          </div>
        )}
      </section>
    </ResizablePanel>
  );
}

function DesktopResizableLayout({
  kicked,
  wide,
  showPreviewPane,
  showSidebar,
  horizontalIds,
  languagePreview,
  drawer,
}: {
  kicked: boolean;
  wide: boolean;
  showPreviewPane: boolean;
  showSidebar: boolean;
  horizontalIds: string[];
  languagePreview: boolean;
  drawer: ReturnType<typeof usePanelRef>;
}) {
  const ws = useWorkspace();
  const ui = useStore(ws.ui);
  const hLayout = useDefaultLayout({ id: `tether:layout:h:${horizontalIds.join('-')}`, panelIds: horizontalIds, storage });
  const vLayout = useDefaultLayout({ id: 'tether:layout:v', panelIds: ['main', 'drawer'], storage });

  if (ui.zenMode) {
    return (
      <ResizableGroup key={`zen-${horizontalIds.join('-')}`} orientation="horizontal" defaultLayout={hLayout.defaultLayout} onLayoutChanged={hLayout.onLayoutChanged}>
        <DesktopEditorPanel
          kicked={kicked}
          wide={wide}
          languagePreview={languagePreview}
          showPreviewPane={showPreviewPane}
          showSidebar={false}
        />
        {showPreviewPane && (
          <>
            <ResizableHandle />
            <ResizablePanel id="preview" minSize="20" defaultSize="50" collapsible>
              <section aria-label="Live preview" className={card}>
                <PreviewPane />
              </section>
            </ResizablePanel>
          </>
        )}
      </ResizableGroup>
    );
  }

  return (
    <ResizableGroup orientation="vertical" defaultLayout={vLayout.defaultLayout} onLayoutChanged={vLayout.onLayoutChanged}>
      <ResizablePanel id="main" minSize="30">
        <ResizableGroup key={horizontalIds.join('-')} orientation="horizontal" defaultLayout={hLayout.defaultLayout} onLayoutChanged={hLayout.onLayoutChanged}>
          <DesktopEditorPanel
            kicked={kicked}
            wide={wide}
            languagePreview={languagePreview}
            showPreviewPane={showPreviewPane}
            showSidebar={showSidebar}
          />
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
          {showSidebar && (
            <>
              <ResizableHandle />
              <ResizablePanel id="sidebar" minSize={240} maxSize="40" defaultSize={showPreviewPane ? '22' : '28'}>
                <aside aria-label="People and activity" className={card}>
                  <Sidebar />
                </aside>
              </ResizablePanel>
            </>
          )}
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
          <DiagnosticsDrawer />
        </div>
      </ResizablePanel>
    </ResizableGroup>
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

      if (e.key === 'Escape') {
        const ui = ws.ui.get();
        if (ui.maximizedPanel) {
          e.preventDefault();
          ws.maximizePanel(null);
          return;
        }
        if (ui.zenMode) {
          e.preventDefault();
          ws.ui.update((s) => ({ ...s, zenMode: false }));
          return;
        }
        // Esc stops follow and returns focus to the editor (docs/07 a11y). Open dialogs handle their own Esc first.
        if (ws.follow.get()) ws.follow.set(null);
        if (!ui.palette && !ui.settings && !ui.shortcuts && !ui.hostSheet && !target?.closest('.cm-editor')) ws.focusEditor();
      } else if (mod && e.shiftKey && key === 'f') {
        e.preventDefault();
        ws.ui.update((s) => ({ ...s, zenMode: !s.zenMode }));
      } else if (e.shiftKey && e.altKey && key === 'f') {
        e.preventDefault();
        const room = ws.client.room.get();
        const isHost = room.hostId === room.selfId;
        if (isHost || !room.room.locked) {
          const text = ws.client.text.toString();
          void formatCode(text, languageInfo(room.room.language).id).then((formatted) => {
            if (formatted !== text) {
              ws.client.doc.transact(() => {
                ws.client.text.delete(0, ws.client.text.length);
                ws.client.text.insert(0, formatted);
              });
              toast.success('Document formatted');
            }
          });
        }
      } else if (mod && key === 'k') {
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
    ['Shift Alt F', 'Format document'],
    [`${m} Shift F`, 'Toggle Zen mode'],
    ['Alt H', 'Highlight current lines for everyone'],
    ['Ctrl `', 'Toggle diagnostics drawer'],
    ['Esc', 'Exit Zen mode / Restore panel / Back to editor'],
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
