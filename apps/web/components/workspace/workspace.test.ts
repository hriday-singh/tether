import { describe, expect, it } from 'vitest';
import { createStore } from '@/lib/store';
import type { UIState } from './context';

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
});
