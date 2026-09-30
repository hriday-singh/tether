import { CodeIcon } from '@hugeicons/core-free-icons';
import { describe, expect, it, vi } from 'vitest';
import {
  scoreCommand,
  buildPaletteCommands,
  type PaletteCommand,
} from './command-palette-items';
import type { Workspace, UIState } from './context';
import type { UserPreferences } from '@/lib/prefs';

describe('Command Palette scoring and search prioritization', () => {
  const dummyCommand: PaletteCommand = {
    id: 'view:zen',
    category: 'Editor & Actions',
    icon: CodeIcon,
    label: 'Toggle Zen Mode',
    keywords: ['zen', 'distraction free', 'fullscreen', 'zen mode', 'focus', 'editor'],
    priority: 98,
    onSelect: () => {},
  };

  const fontCommand: PaletteCommand = {
    id: 'editor:font-size',
    category: 'Editor & Actions',
    icon: CodeIcon,
    label: 'Editor Font Size: 13px (Click to configure)',
    keywords: ['editor font size', 'font size', 'text size', 'code font', 'zoom', 'settings'],
    priority: 94,
    settingsAction: { label: 'Settings', section: 'editor' },
    onSelect: () => {},
  };

  const tabCommand: PaletteCommand = {
    id: 'editor:tab-size',
    category: 'Editor & Actions',
    icon: CodeIcon,
    label: 'Tab Size: 2 Spaces (Click to toggle 2/4)',
    keywords: ['tab size', 'indentation', 'spaces', 'tab 2', 'tab 4', 'indent', 'settings'],
    priority: 93,
    settingsAction: { label: 'Settings', section: 'editor' },
    onSelect: () => {},
  };

  const latencyCommand: PaletteCommand = {
    id: 'net:latency-150',
    category: 'Advanced & Diagnostics',
    icon: CodeIcon,
    label: 'Simulated Latency: 150 ms (Cross-region demo)',
    keywords: ['simulated latency 150ms', 'latency', 'network', 'delay', 'settings'],
    priority: 42,
    onSelect: () => {},
  };

  it('ranks exact keyword match as top priority score', () => {
    const zenScore = scoreCommand(dummyCommand, 'zen');
    const latencyScore = scoreCommand(latencyCommand, 'zen');

    expect(zenScore).toBeGreaterThan(1800);
    expect(latencyScore).toBe(0);
  });

  it('prioritizes exact word start match over generic contains match', () => {
    const fontScore = scoreCommand(fontCommand, 'font');
    expect(fontScore).toBeGreaterThan(1200);

    const tabScore = scoreCommand(tabCommand, 'tab');
    expect(tabScore).toBeGreaterThan(1200);
  });

  it('prioritizes core commands over obscure settings on shared keywords like "settings"', () => {
    const fontScore = scoreCommand(fontCommand, 'settings');
    const latencyScore = scoreCommand(latencyCommand, 'settings');

    expect(fontScore).toBeGreaterThan(latencyScore);
  });

  it('returns 0 for queries that do not match label or keywords', () => {
    expect(scoreCommand(dummyCommand, 'xyzunknownterm')).toBe(0);
    expect(scoreCommand(fontCommand, 'database migration')).toBe(0);
  });

  it('supports multi-token matching when all tokens appear', () => {
    const score = scoreCommand(tabCommand, 'tab spaces');
    expect(score).toBeGreaterThan(600);
  });
});

describe('buildPaletteCommands feature completeness', () => {
  const dummyWs = {
    client: {
      roster: { get: () => [] },
      room: { get: () => ({ hostId: 'user-1', selfId: 'user-1', room: { language: 'html', locked: false } }) },
      text: { toString: () => 'console.log("hi");' },
      doc: { transact: (fn: () => void) => fn() },
      command: vi.fn().mockResolvedValue(undefined),
      leave: vi.fn().mockResolvedValue(undefined),
    },
    roomId: 'test-room-1',
    ui: {
      update: vi.fn(),
      get: () => ({
        palette: 'commands' as const,
        settings: false,
        settingsSection: 'appearance' as const,
        shortcuts: false,
        hostSheet: false,
        drawerOpen: false,
        drawerTab: 'console' as const,
        sidebarOpen: true,
        sidebarTab: 'people' as const,
        previewOpen: true,
        editorView: 'code' as const,
        mobileTab: 'editor' as const,
        maximizedPanel: null,
        zenMode: false,
      }),
    },
    run: vi.fn(),
    togglePanel: vi.fn(),
    maximizePanel: vi.fn(),
    openDrawerTab: vi.fn(),
    view: { current: null },
  } as unknown as Workspace;

  const dummyPrefs: UserPreferences = {
    themeId: 'quiet-dark',
    uiScale: 'md',
    ambientAnimations: true,
    reduceMotion: false,
    editorFontSize: 13,
    tabSize: 2,
    wordWrap: true,
    lineNumbers: true,
    bracketColors: true,
    followUnlockOnInput: true,
    cursorFlagFadeSeconds: 2,
    offscreenCursorBadges: true,
    telemetrySampling: true,
    simulatedLatencyMs: 0,
  };

  const dummyUiState: UIState = {
    palette: 'commands',
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
  };

  it('builds commands covering Zen Mode, Font Size, Tab Size, Language, and Host Controls', () => {
    const setPrefs = vi.fn();
    const onClose = vi.fn();
    const routerPush = vi.fn();

    const commands = buildPaletteCommands({
      ws: dummyWs,
      uiState: dummyUiState,
      prefs: dummyPrefs,
      setPrefs,
      roster: [],
      room: {
        hostId: 'user-1',
        selfId: 'user-1',
        eventSeq: 0,
        chatSeq: 0,
        room: {
          id: 'test-room-1',
          language: 'html',
          locked: false,
          hasPasscode: false,
          epoch: '1',
        },
      },
      mod: 'Ctrl',
      onClose,
      routerPush,
    });

    const ids = commands.map((c) => c.id);

    // Zen Mode must be present
    expect(ids).toContain('view:zen');

    // Font size & tab size with direct settingsAction
    const fontCmd = commands.find((c) => c.id === 'editor:font-size');
    expect(fontCmd).toBeDefined();
    expect(fontCmd?.settingsAction?.section).toBe('editor');

    const tabCmd = commands.find((c) => c.id === 'editor:tab-size');
    expect(tabCmd).toBeDefined();
    expect(tabCmd?.settingsAction?.section).toBe('editor');

    // Tab size onSelect toggles between 2 and 4
    tabCmd?.onSelect();
    expect(setPrefs).toHaveBeenCalledWith({ tabSize: 4 });

    // Host commands must be present when user is host
    expect(ids).toContain('room:host-lock');
    expect(ids).toContain('room:host-sheet');
    expect(ids).toContain('room:lang:html');
    expect(ids).toContain('room:lang:javascript');
    expect(ids).toContain('room:lang:python');

    // General commands
    expect(ids).toContain('editor:maximize');
    expect(ids).toContain('room:leave');
    expect(ids).toContain('room:copy-id');
  });
});
