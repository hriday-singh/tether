import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { SyncClient } from '@/lib/sync';
import { createStore } from '@/lib/store';
import { createWorkspace, type UIState } from './context';

describe('UIState mobileTab behavior', () => {
  it('defaults mobileTab to editor and supports switching between mobile tabs', () => {
    const ui = createStore<UIState>({
      palette: false,
      settings: false,
      shortcuts: false,
      hostSheet: false,
      drawerOpen: false,
      drawerTab: 'console',
      sidebarOpen: true,
      sidebarTab: 'people',
      previewOpen: true,
      editorView: 'code',
      mobileTab: 'editor',
      maximizedPanel: null,
      zenMode: false,
    });

    expect(ui.get().mobileTab).toBe('editor');

    ui.update((s) => ({ ...s, mobileTab: 'chat' }));
    expect(ui.get().mobileTab).toBe('chat');

    ui.update((s) => ({ ...s, mobileTab: 'activity' }));
    expect(ui.get().mobileTab).toBe('activity');

    ui.update((s) => ({ ...s, mobileTab: 'diagnostics' }));
    expect(ui.get().mobileTab).toBe('diagnostics');
  });

  it('supports maximizing and restoring editor only', () => {
    const ui = createStore<UIState>({
      palette: false,
      settings: false,
      shortcuts: false,
      hostSheet: false,
      drawerOpen: false,
      drawerTab: 'console',
      sidebarOpen: true,
      sidebarTab: 'people',
      previewOpen: true,
      editorView: 'code',
      mobileTab: 'editor',
      maximizedPanel: null,
      zenMode: false,
    });

    expect(ui.get().maximizedPanel).toBeNull();
    ui.update((s) => ({ ...s, maximizedPanel: 'editor' }));
    expect(ui.get().maximizedPanel).toBe('editor');
    ui.update((s) => ({ ...s, maximizedPanel: null }));
    expect(ui.get().maximizedPanel).toBeNull();
  });

  it('supports entering and exiting Zen mode', () => {
    const ui = createStore<UIState>({
      palette: false,
      settings: false,
      settingsSection: 'appearance',
      shortcuts: false,
      hostSheet: false,
      drawerOpen: true,
      drawerTab: 'console',
      sidebarOpen: true,
      sidebarTab: 'people',
      previewOpen: true,
      editorView: 'code',
      mobileTab: 'editor',
      maximizedPanel: null,
      zenMode: false,
    });

    expect(ui.get().zenMode).toBe(false);
    ui.update((s) => ({ ...s, zenMode: true }));
    expect(ui.get().zenMode).toBe(true);

    ui.update((s) => ({ ...s, zenMode: false }));
    expect(ui.get().zenMode).toBe(false);
  });

  it('supports opening settings focused on a specific section', () => {
    const ui = createStore<UIState>({
      palette: false,
      settings: false,
      settingsSection: 'appearance',
      shortcuts: false,
      hostSheet: false,
      drawerOpen: false,
      drawerTab: 'console',
      sidebarOpen: true,
      sidebarTab: 'people',
      previewOpen: true,
      editorView: 'code',
      mobileTab: 'editor',
      maximizedPanel: null,
      zenMode: false,
    });

    expect(ui.get().settings).toBe(false);
    expect(ui.get().settingsSection).toBe('appearance');

    ui.update((s) => ({ ...s, settings: true, settingsSection: 'editor' }));
    expect(ui.get().settings).toBe(true);
    expect(ui.get().settingsSection).toBe('editor');
  });

  it('activates previewOpen and editorView when switching to previewable mode', () => {
    const ui = createStore<UIState>({
      palette: false,
      settings: false,
      settingsSection: 'appearance',
      shortcuts: false,
      hostSheet: false,
      drawerOpen: false,
      drawerTab: 'console',
      sidebarOpen: true,
      sidebarTab: 'people',
      previewOpen: false,
      editorView: 'code',
      mobileTab: 'editor',
      maximizedPanel: null,
      zenMode: false,
    });

    expect(ui.get().previewOpen).toBe(false);
    expect(ui.get().editorView).toBe('code');

    ui.update((s) => ({ ...s, previewOpen: true, editorView: 'preview' }));
    expect(ui.get().previewOpen).toBe(true);
    expect(ui.get().editorView).toBe('preview');
  });

  it('ws.run() in HTML room activates previewOpen and editorView with scripts enabled', async () => {
    const doc = new Y.Doc();
    const text = doc.getText('content');
    text.insert(0, '<h1>Hello</h1>');

    const mockClient = {
      room: createStore({
        room: { id: 'room-1', name: 'Room', language: 'html', locked: false, maxMembers: 10, createdAt: 0 },
        selfId: 'self',
        hostId: 'self',
        members: [],
        version: 1,
      }),
      presence: createStore(new Map()),
      awareness: {} as unknown,
      text,
      status: createStore({ connection: 'connected' as const, latencyMs: 10, rtt: 10, bytesSent: 0, bytesReceived: 0, pendingOps: 0 }),
      onChat: () => () => {},
    } as unknown as SyncClient;

    const ws = createWorkspace(mockClient, 'room-1', { memberId: 'self', token: 'tok', name: 'Tester', epoch: '1' });
    ws.ui.update((s) => ({ ...s, previewOpen: false, editorView: 'code' }));

    await ws.run();

    expect(ws.ui.get().previewOpen).toBe(true);
    expect(ws.ui.get().editorView).toBe('preview');
    expect(ws.preview.get().scripts).toBe(true);
  });

  it('ws.destroy() calls the onChat unsubscribe handler', () => {
    let unsubsCalled = 0;
    const doc = new Y.Doc();
    const mockClient = {
      room: createStore({
        room: { id: 'room-1', name: 'Room', language: 'html', locked: false, maxMembers: 10, createdAt: 0 },
        selfId: 'self',
        hostId: 'self',
        members: [],
        version: 1,
      }),
      presence: createStore(new Map()),
      awareness: {} as unknown,
      text: doc.getText('content'),
      status: createStore({ connection: 'connected' as const, latencyMs: 10, rtt: 10, bytesSent: 0, bytesReceived: 0, pendingOps: 0 }),
      onChat: () => () => {
        unsubsCalled++;
      },
    } as unknown as SyncClient;

    const ws = createWorkspace(mockClient, 'room-1', { memberId: 'self', token: 'tok', name: 'Tester', epoch: '1' });
    expect(unsubsCalled).toBe(0);
    ws.destroy();
    expect(unsubsCalled).toBe(1);
  });
});

