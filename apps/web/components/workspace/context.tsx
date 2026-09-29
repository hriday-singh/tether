'use client';

import { EditorView } from '@codemirror/view';
import { createContext, useContext } from 'react';
import { toast } from '@/components/ui/toaster';
import { createConsoleStore, type ConsoleStore } from '@/lib/console-store';
import { languageInfo } from '@/lib/languages';
import type { RoomSession } from '@/lib/session';
import { createStore, shallowEqual, type WritableStore } from '@/lib/store';
import type { SyncClient } from '@/lib/sync';
import { SandboxedWorkerRunner, transpileForRun } from '@/lib/worker-runner';
import { randomId } from '@/lib/utils';
import { remoteHead, type OffscreenCursor } from './editor/collab';

export interface UIState {
  palette: false | 'commands' | 'theme';
  settings: boolean;
  shortcuts: boolean;
  hostSheet: boolean;
  drawerOpen: boolean;
  drawerTab: 'console' | 'sync' | 'chaos';
  sidebarTab: 'people' | 'activity';
  /** Laptop layout (lg): the editor card shows code or preview. */
  editorView: 'code' | 'preview';
}

export interface PreviewRun {
  runId: string;
  scripts: boolean;
}

export interface Workspace {
  client: SyncClient;
  roomId: string;
  session: RoomSession;
  console: ConsoleStore;
  cursorPos: WritableStore<{ line: number; col: number; selected: number }>;
  offscreen: WritableStore<readonly OffscreenCursor[]>;
  follow: WritableStore<string | null>;
  running: WritableStore<boolean>;
  preview: WritableStore<PreviewRun>;
  ui: WritableStore<UIState>;
  view: { current: EditorView | null };
  /** Live preview iframe, if mounted. The console REPL evaluates inside it. */
  previewFrame: { current: HTMLIFrameElement | null };
  setView(view: EditorView | null): void;
  setPreviewFrame(frame: HTMLIFrameElement | null): void;
  jumpTo(memberId: string): boolean;
  run(): Promise<void>;
  stop(): void;
  focusEditor(): void;
}

const Ctx = createContext<Workspace | null>(null);
export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace(): Workspace {
  const ws = useContext(Ctx);
  if (!ws) throw new Error('useWorkspace outside <WorkspaceProvider>');
  return ws;
}

export function createWorkspace(client: SyncClient, roomId: string, session: RoomSession): Workspace {
  const view: Workspace['view'] = { current: null };
  const runner = new SandboxedWorkerRunner();
  const consoleStore = createConsoleStore();
  const running = createStore(false);
  const preview = createStore<PreviewRun>({ runId: randomId(4), scripts: false }, shallowEqual);
  const ui = createStore<UIState>(
    {
      palette: false,
      settings: false,
      shortcuts: false,
      hostSheet: false,
      drawerOpen: false,
      drawerTab: 'console',
      sidebarTab: 'people',
      editorView: 'code',
    },
    shallowEqual,
  );

  const ws: Workspace = {
    client,
    roomId,
    session,
    console: consoleStore,
    cursorPos: createStore({ line: 1, col: 1, selected: 0 }, shallowEqual),
    offscreen: createStore<readonly OffscreenCursor[]>([]),
    follow: createStore<string | null>(null),
    running,
    preview,
    ui,
    view,
    previewFrame: { current: null },
    setView(v) {
      view.current = v;
    },
    setPreviewFrame(frame) {
      ws.previewFrame.current = frame;
    },

    jumpTo(memberId) {
      const entries = client.presence.get().get(memberId) ?? [];
      const target = entries.find((e) => e.hasCursor);
      const pos = target ? remoteHead(client.awareness, client.text, target.clientId) : null;
      if (pos === null || !view.current) return false;
      view.current.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      return true;
    },

    async run() {
      const language = languageInfo(client.room.get().room.language);
      if (language.preview === 'html') {
        preview.set({ runId: randomId(4), scripts: true });
        ui.update((s) => ({ ...s, editorView: 'preview' }));
        consoleStore.push('info', 'Preview reloaded with scripts enabled.', 'system');
        return;
      }
      if (!language.runnable || (language.id !== 'javascript' && language.id !== 'typescript')) {
        toast.info(`Run supports JavaScript, TypeScript and HTML. ${language.label} is edit-only.`);
        return;
      }
      ui.update((s) => ({ ...s, drawerOpen: true, drawerTab: 'console' }));
      let code: string;
      try {
        code = await transpileForRun(client.text.toString(), language.id);
      } catch (err) {
        consoleStore.push('error', `TypeScript: ${err instanceof Error ? err.message : String(err)}`, 'runner');
        return;
      }
      running.set(true);
      consoleStore.push('input', `Run ${language.label} (5 s limit)`, 'system');
      const started = performance.now();
      runner.execute(
        code,
        (log) => consoleStore.push(log.type, log.args.join(' '), 'runner'),
        (reason) => {
          running.set(false);
          if (reason !== 'timeout') {
            consoleStore.push('info', `${reason === 'stopped' ? 'Stopped' : 'Finished'} in ${Math.round(performance.now() - started)} ms`, 'system');
          }
        },
      );
    },

    stop() {
      runner.stop();
      if (preview.get().scripts) preview.set({ runId: randomId(4), scripts: false });
    },

    focusEditor() {
      view.current?.focus();
    },
  };
  return ws;
}
