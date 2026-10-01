import {
  Activity01Icon,
  BubbleChatIcon,
  BracketsIcon,
  BrowserIcon,
  CodeIcon,
  Copy01Icon,
  CrownIcon,
  Delete02Icon,
  Download04Icon,
  FlashIcon,
  FullScreenIcon,
  HighlighterIcon,
  Link01Icon,
  LockKeyIcon,
  Logout03Icon,
  MaximizeScreenIcon,
  MinimizeScreenIcon,
  PlayIcon,
  Search01Icon,
  Share08Icon,
  SidebarBottomIcon,
  UserGroupIcon,
  ViewIcon,
} from '@hugeicons/core-free-icons';
import { openSearchPanel } from '@codemirror/search';
import { toast } from '@/components/ui/toaster';
import { DEMO_MODE } from '@/lib/api';
import { formatCode } from '@/lib/formatter';
import { LANGUAGE_IDS, LANGUAGES, STARTER_CODE, languageInfo, type LanguageId } from '@/lib/languages';
import { CommandError } from '@/lib/sync';
import type { UIState } from './context';
import { toggleLineHighlight } from './editor/collab';
import {
  CATEGORIES,
  scoreCommand,
  type PaletteCategory,
  type PaletteCommand,
  type BuildPaletteCommandsArgs,
} from './command-palette-types';
import { buildPreferenceAndDiagnosticCommands } from './command-palette-prefs';

export {
  CATEGORIES,
  scoreCommand,
  type PaletteCategory,
  type PaletteCommand,
  type BuildPaletteCommandsArgs,
};

export function buildPaletteCommands(args: BuildPaletteCommandsArgs): PaletteCommand[] {
  const { ws, uiState, prefs, setPrefs, roster, room, mod, onClose, routerPush } = args;
  const { client } = ws;
  const lang = languageInfo(room.room.language);
  const isHost = room.hostId === room.selfId;

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const ui = (patch: Partial<UIState>) => ws.ui.update((s) => ({ ...s, ...patch }));

  const changeLanguage = async (id: LanguageId) => {
    if (!isHost) {
      toast.info('Only the room host can change the language');
      return;
    }
    if (id === lang.id) {
      toast.info(`Room is already set to ${LANGUAGES[id].label}`);
      return;
    }
    try {
      await client.command({ t: 'room.language', language: id });
      toast.success(`Language set to ${LANGUAGES[id].label}`);
    } catch (e) {
      toast.error('Could not change language', {
        description: e instanceof CommandError ? e.code : String(e),
      });
    }
  };

  const toggleRoomLock = async () => {
    if (!isHost) {
      toast.info('Only the room host can lock or unlock the room');
      return;
    }
    const next = !room.room.locked;
    try {
      await client.command({ t: 'host.lock', locked: next });
      toast.success(next ? 'Room locked' : 'Room unlocked');
    } catch (e) {
      toast.error('Could not toggle room lock', {
        description: e instanceof CommandError ? e.code : String(e),
      });
    }
  };

  return [
    // 1. Editor & Actions
    {
      id: 'editor:find',
      category: 'Editor & Actions',
      icon: Search01Icon,
      label: 'Find in document',
      shortcut: `${mod} F`,
      keywords: ['find', 'search', 'replace', 'editor'],
      priority: 96,
      onSelect: act(() => {
        if (ws.view.current) openSearchPanel(ws.view.current);
      }),
    },
    {
      id: 'editor:comment',
      category: 'Editor & Actions',
      icon: BubbleChatIcon,
      label: 'Comment on selection in chat',
      shortcut: `${mod} Shift M`,
      keywords: ['comment', 'quote', 'chat', 'selection', 'discuss', 'review'],
      priority: 94,
      onSelect: act(() => void ws.commentOnSelection()),
    },
    {
      id: 'editor:format',
      category: 'Editor & Actions',
      icon: CodeIcon,
      label: 'Format document',
      shortcut: 'Shift Alt F',
      keywords: ['format', 'prettier', 'beautify', 'indent', 'clean'],
      priority: 95,
      onSelect: act(() => {
        if (!isHost && room.room.locked) {
          toast.info('Room is locked. Only the host can format.');
          return;
        }
        const currentText = client.text.toString();
        if (!currentText.trim()) return;
        void formatCode(currentText, lang.id)
          .then((formatted) => {
            if (formatted === currentText) {
              toast.info('Document is already formatted');
              return;
            }
            client.doc.transact(() => {
              client.text.delete(0, client.text.length);
              client.text.insert(0, formatted);
            });
            toast.success('Document formatted');
          })
          .catch(() => {
            toast.error('Failed to format document');
          });
      }),
    },
    ...(lang.runnable || lang.preview === 'html'
      ? [
          {
            id: 'editor:run',
            category: 'Editor & Actions' as const,
            icon: PlayIcon,
            label: lang.preview === 'html' ? 'Refresh Preview' : 'Run code',
            shortcut: `${mod} Enter`,
            keywords: ['run', 'execute', 'preview', 'play', 'test', 'eval'],
            priority: 94,
            onSelect: act(() => {
              if (lang.preview === 'html') {
                ui({ previewOpen: true });
                toast.success('Preview refreshed');
              } else {
                ui({ drawerOpen: true, drawerTab: 'console' });
                ws.run();
              }
            }),
          },
        ]
      : []),
    {
      id: 'editor:font-size',
      category: 'Editor & Actions',
      icon: CodeIcon,
      label: `Editor Font Size: ${prefs.editorFontSize}px`,
      keywords: ['font size', 'text size', 'editor zoom', 'typography', 'editor', 'settings'],
      priority: 92,
      settingsAction: { label: 'Settings', section: 'editor' },
      onSelect: act(() => ui({ settings: true, settingsSection: 'editor' })),
    },
    {
      id: 'editor:tab-size',
      category: 'Editor & Actions',
      icon: BracketsIcon,
      label: `Tab Size: ${prefs.tabSize} spaces (Click to Toggle 2/4)`,
      keywords: ['tab size', 'indent', 'spaces', 'tab width', 'editor', 'settings'],
      priority: 91,
      settingsAction: { label: 'Settings', section: 'editor' },
      onSelect: act(() => {
        const next = prefs.tabSize === 2 ? 4 : 2;
        setPrefs({ tabSize: next });
        toast.success(`Tab size set to ${next} spaces`);
      }),
    },
    {
      id: 'editor:line-numbers',
      category: 'Editor & Actions',
      icon: CodeIcon,
      label: `Line Numbers: ${prefs.lineNumbers ? 'Hide' : 'Show'}`,
      keywords: ['line numbers', 'gutter', 'editor', 'settings'],
      priority: 88,
      settingsAction: { label: 'Settings', section: 'editor' },
      onSelect: act(() => {
        const next = !prefs.lineNumbers;
        setPrefs({ lineNumbers: next });
        toast.success(`Line numbers: ${next ? 'Shown' : 'Hidden'}`);
      }),
    },
    {
      id: 'editor:word-wrap',
      category: 'Editor & Actions',
      icon: CodeIcon,
      label: `Word Wrap: ${prefs.wordWrap ? 'Disable' : 'Enable'}`,
      keywords: ['word wrap', 'soft wrap', 'editor', 'settings'],
      priority: 88,
      settingsAction: { label: 'Settings', section: 'editor' },
      onSelect: act(() => {
        const next = !prefs.wordWrap;
        setPrefs({ wordWrap: next });
        toast.success(`Word wrap: ${next ? 'Enabled' : 'Disabled'}`);
      }),
    },
    {
      id: 'editor:bracket-colors',
      category: 'Editor & Actions',
      icon: BracketsIcon,
      label: `Rainbow Brackets: ${prefs.bracketColors ? 'Disable' : 'Enable'}`,
      keywords: ['rainbow brackets', 'bracket pair colorization', 'brackets', 'editor', 'settings'],
      priority: 85,
      settingsAction: { label: 'Settings', section: 'editor' },
      onSelect: act(() => {
        const next = !prefs.bracketColors;
        setPrefs({ bracketColors: next });
        toast.success(`Rainbow brackets: ${next ? 'Enabled' : 'Disabled'}`);
      }),
    },
    {
      id: 'editor:highlight-line',
      category: 'Editor & Actions',
      icon: HighlighterIcon,
      label: 'Broadcast Line Highlight',
      shortcut: `${mod} H`,
      keywords: ['highlight', 'broadcast', 'attention', 'mark', 'collaborate'],
      priority: 86,
      onSelect: act(() => {
        if (!ws.view.current) return;
        const line = ws.view.current.state.doc.lineAt(ws.view.current.state.selection.main.head).number;
        toggleLineHighlight(ws.view.current, ws.client.awareness, ws.client.text, line);
        toast.success(`Broadcasting highlight on line ${line}`);
      }),
    },
    {
      id: 'editor:maximize',
      category: 'Editor & Actions',
      icon: uiState.maximizedPanel === 'editor' ? MinimizeScreenIcon : MaximizeScreenIcon,
      label: uiState.maximizedPanel === 'editor' ? 'Restore Editor Panel' : 'Maximize Editor Panel',
      keywords: ['maximize editor', 'fullscreen editor', 'focus editor', 'restore'],
      priority: 89,
      onSelect: act(() => {
        ui({ maximizedPanel: uiState.maximizedPanel === 'editor' ? null : 'editor' });
      }),
    },
    {
      id: 'editor:insert-template',
      category: 'Editor & Actions',
      icon: CodeIcon,
      label: `Insert Starter Template (${lang.label})`,
      keywords: ['template', 'starter template', 'insert template', 'boilerplate', 'sample code'],
      priority: 75,
      onSelect: act(() => {
        if (!isHost && room.room.locked) {
          toast.info('Room is locked. Only the host can modify.');
          return;
        }
        const template = STARTER_CODE[lang.id];
        if (!template) return;
        client.doc.transact(() => {
          const sep = client.text.length > 0 ? '\n\n' : '';
          client.text.insert(client.text.length, `${sep}${template}`);
        });
        toast.success(`Inserted ${lang.label} template`);
      }),
    },
    {
      id: 'editor:clear-doc',
      category: 'Editor & Actions',
      icon: Delete02Icon,
      label: 'Clear Document',
      keywords: ['clear document', 'clear editor', 'empty document', 'reset code'],
      priority: 55,
      onSelect: act(() => {
        if (!isHost && room.room.locked) {
          toast.info('Room is locked. Only the host can clear the document.');
          return;
        }
        if (client.text.length === 0) {
          toast.info('Document is already empty');
          return;
        }
        client.doc.transact(() => {
          client.text.delete(0, client.text.length);
        });
        toast.success('Document cleared');
      }),
    },

    // 2. Navigation & Views
    {
      id: 'view:zen',
      category: 'Navigation & Views',
      icon: FullScreenIcon,
      label: uiState.zenMode ? 'Exit Zen Mode' : 'Zen Mode (Distraction Free)',
      shortcut: 'F11',
      keywords: ['zen', 'zen mode', 'distraction free', 'fullscreen', 'focus', 'clean'],
      priority: 98,
      onSelect: act(() => {
        const next = !uiState.zenMode;
        ui({ zenMode: next, maximizedPanel: null });
        toast.success(next ? 'Zen mode enabled (Editor & Preview only)' : 'Zen mode exited');
      }),
    },
    {
      id: 'view:sidebar',
      category: 'Navigation & Views',
      icon: UserGroupIcon,
      label: `${uiState.sidebarOpen ? 'Close' : 'Open'} Sidebar`,
      shortcut: `${mod} B`,
      keywords: ['sidebar', 'drawer', 'toggle sidebar', 'panel'],
      priority: 93,
      onSelect: act(() => ui({ sidebarOpen: !uiState.sidebarOpen })),
    },
    {
      id: 'view:sidebar-people',
      category: 'Navigation & Views',
      icon: UserGroupIcon,
      label: 'Go to People tab',
      keywords: ['people', 'roster', 'users', 'collaborators', 'presence', 'sidebar'],
      priority: 88,
      onSelect: act(() => ui({ sidebarOpen: true, sidebarTab: 'people' })),
    },
    {
      id: 'view:sidebar-chat',
      category: 'Navigation & Views',
      icon: BubbleChatIcon,
      label: 'Go to Chat tab',
      keywords: ['chat', 'messages', 'talk', 'sidebar'],
      priority: 88,
      onSelect: act(() => ui({ sidebarOpen: true, sidebarTab: 'chat' })),
    },
    {
      id: 'view:sidebar-activity',
      category: 'Navigation & Views',
      icon: Activity01Icon,
      label: 'Go to Activity tab',
      keywords: ['activity', 'feed', 'history', 'events', 'audit', 'sidebar'],
      priority: 86,
      onSelect: act(() => ui({ sidebarOpen: true, sidebarTab: 'activity' })),
    },
    {
      id: 'view:sidebar-scratchpad',
      category: 'Navigation & Views',
      icon: CodeIcon,
      label: 'Go to Scratchpad tab',
      keywords: ['scratchpad', 'notes', 'private', 'buffer', 'sidebar'],
      priority: 85,
      onSelect: act(() => ui({ sidebarOpen: true, sidebarTab: 'scratchpad' })),
    },
    {
      id: 'view:drawer',
      category: 'Navigation & Views',
      icon: SidebarBottomIcon,
      label: `${uiState.drawerOpen ? 'Close' : 'Open'} Bottom Diagnostics Drawer`,
      shortcut: `${mod} J`,
      keywords: ['drawer', 'terminal', 'diagnostics', 'bottom panel', 'console'],
      priority: 87,
      onSelect: act(() => ui({ drawerOpen: !uiState.drawerOpen })),
    },
    {
      id: 'view:drawer-terminal',
      category: 'Navigation & Views',
      icon: SidebarBottomIcon,
      label: 'Open Console & Output',
      keywords: ['terminal', 'console', 'output', 'run output', 'drawer'],
      priority: 87,
      onSelect: act(() => ui({ drawerOpen: true, drawerTab: 'console' })),
    },
    {
      id: 'view:drawer-diagnostics',
      category: 'Navigation & Views',
      icon: SidebarBottomIcon,
      label: 'Open Diagnostics / Sync Inspector',
      keywords: ['diagnostics', 'sync inspector', 'network', 'metrics', 'drawer'],
      priority: 84,
      onSelect: act(() => ui({ drawerOpen: true, drawerTab: 'sync' })),
    },
    ...(lang.preview === 'html'
      ? [
          {
            id: 'view:preview',
            category: 'Navigation & Views' as const,
            icon: BrowserIcon,
            label: `${uiState.previewOpen ? 'Hide' : 'Show'} Live HTML Preview`,
            keywords: ['preview', 'html', 'live preview', 'browser', 'render'],
            priority: 92,
            onSelect: act(() => ui({ previewOpen: !uiState.previewOpen })),
          },
        ]
      : []),
    {
      id: 'view:chaos',
      category: 'Navigation & Views',
      icon: FlashIcon,
      label: 'Open Chaos',
      keywords: ['chaos', 'chaos lab', 'storm', 'bots', 'faults', 'stress'], // old names still find it
      priority: 82,
      onSelect: act(() => ui({ drawerOpen: true, drawerTab: 'chaos' })),
    },
    {
      id: 'console:clear',
      category: 'Advanced & Diagnostics',
      icon: Delete02Icon,
      label: 'Clear Console Output',
      keywords: ['clear console', 'terminal clear', 'clear logs', 'cls', 'console'],
      priority: 78,
      onSelect: act(() => {
        ws.console?.clear?.();
        toast.success('Console cleared');
      }),
    },
    {
      id: 'console:share',
      category: 'Advanced & Diagnostics',
      icon: Share08Icon,
      label: 'Share Recent Logs to Room Chat',
      keywords: ['share console', 'share logs', 'export logs', 'console chat'],
      priority: 77,
      onSelect: act(async () => {
        const shown = ws.console?.get?.() ?? [];
        if (shown.length === 0) {
          toast.info('No console logs to share');
          return;
        }
        const lines = shown.slice(-10).map((e) => `[${e.level.toUpperCase()}] ${e.text}`).join('\n');
        const msg = `\`\`\`text\n[Console Export (${shown.length} logs)]\n${lines}\n\`\`\``;
        try {
          await client.sendChat(crypto.randomUUID(), msg);
          toast.success('Recent logs shared to room chat');
        } catch {
          toast.error('Failed to share to chat');
        }
      }),
    },

    // 3. Room & Collaboration
    {
      id: 'room:copy-link',
      category: 'Room & Collaboration',
      icon: Link01Icon,
      label: 'Copy invite link',
      shortcut: `${mod} Shift C`,
      keywords: ['invite', 'copy link', 'share', 'url'],
      priority: 94,
      onSelect: act(() => {
        void navigator.clipboard.writeText(window.location.href);
        toast.success('Invite link copied to clipboard');
      }),
    },
    {
      id: 'room:copy-id',
      category: 'Room & Collaboration',
      icon: Copy01Icon,
      label: `Copy Room ID (${ws.roomId})`,
      keywords: ['room id', 'copy id', 'code', 'session'],
      priority: 91,
      onSelect: act(() => {
        void navigator.clipboard.writeText(ws.roomId);
        toast.success(`Copied room ID: ${ws.roomId}`);
      }),
    },
    {
      id: 'room:download',
      category: 'Room & Collaboration',
      icon: Download04Icon,
      label: `Download ${ws.roomId}.${lang.ext}`,
      keywords: ['download', 'export', 'save', 'file'],
      priority: 87,
      onSelect: act(() => {
        const url = URL.createObjectURL(new Blob([client.text.toString()], { type: 'text/plain' }));
        Object.assign(document.createElement('a'), { href: url, download: `${ws.roomId}.${lang.ext}` }).click();
        URL.revokeObjectURL(url);
      }),
    },
    ...(isHost
      ? [
          {
            id: 'room:host-lock',
            category: 'Room & Collaboration' as const,
            icon: LockKeyIcon,
            label: `Host: ${room.room.locked ? 'Unlock Room' : 'Lock Room'}`,
            keywords: ['lock room', 'unlock room', 'host lock', 'security', 'admission'],
            priority: 91,
            onSelect: act(() => void toggleRoomLock()),
          },
          {
            id: 'room:host-sheet',
            category: 'Room & Collaboration' as const,
            icon: CrownIcon,
            label: 'Open Host Controls (Password & Members)',
            keywords: ['host controls', 'host sheet', 'passcode', 'admin', 'kick', 'transfer'],
            priority: 90,
            onSelect: act(() => ui({ hostSheet: true })),
          },
          ...(DEMO_MODE
            ? [
                {
                  id: 'chaos:launch',
                  category: 'Room & Collaboration' as const,
                  icon: FlashIcon,
                  label: 'Launch Chaos Storm (4 Bots, 15s)',
                  keywords: ['launch chaos', 'bot storm', 'chaos storm', 'stress test', 'bots', 'collaborators'],
                  priority: 85,
                  onSelect: act(async () => {
                    ui({ drawerOpen: true, drawerTab: 'chaos' });
                    try {
                      await client.command({ t: 'demo.storm', bots: 4, seconds: 15, faults: true });
                      toast.success('Chaos storm launched');
                    } catch (e) {
                      toast.error('Chaos did not start', {
                        description: e instanceof CommandError ? e.code : String(e),
                      });
                    }
                  }),
                },
                ...(client.storm?.get?.()?.running
                  ? [
                      {
                        id: 'chaos:stop',
                        category: 'Room & Collaboration' as const,
                        icon: FlashIcon,
                        label: 'Stop Active Chaos Storm',
                        keywords: ['stop chaos', 'cancel storm', 'abort storm', 'halt storm'],
                        priority: 86,
                        onSelect: act(async () => {
                          try {
                            await client.command({ t: 'demo.storm_stop' });
                            toast.info('Stopping chaos storm...');
                          } catch (e) {
                            toast.error('Could not stop storm', {
                              description: e instanceof CommandError ? e.code : String(e),
                            });
                          }
                        }),
                      },
                    ]
                  : []),
              ]
            : []),
          ...LANGUAGE_IDS.map((id) => ({
            id: `room:lang:${id}`,
            category: 'Room & Collaboration' as const,
            icon: CodeIcon,
            label: `Change Language: ${LANGUAGES[id].label}${id === lang.id ? ' (Current)' : ''}`,
            keywords: ['change language', 'syntax', 'mode', id, LANGUAGES[id].label.toLowerCase(), 'host'],
            priority: id === lang.id ? 72 : 82,
            onSelect: act(() => void changeLanguage(id)),
          })),
        ]
      : [
          {
            id: 'room:lang-info',
            category: 'Room & Collaboration' as const,
            icon: CodeIcon,
            label: `Language: ${lang.label} (Host only to change)`,
            keywords: ['language', 'syntax', 'mode', lang.id, lang.label.toLowerCase()],
            priority: 60,
            onSelect: act(() => {
              toast.info(`Language is set to ${lang.label}. Only the room host can change it.`);
            }),
          },
        ]),
    ...roster
      .filter((m) => m.id !== room.selfId)
      .map((m) => ({
        id: `collab:follow:${m.id}`,
        category: 'Room & Collaboration' as const,
        icon: ViewIcon,
        label: `Follow ${m.name}`,
        keywords: ['follow', m.name.toLowerCase(), 'collaborator', 'peer', 'cursor'],
        priority: 84,
        onSelect: act(() => ws.follow.set(m.id)),
      })),
    {
      id: 'room:leave',
      category: 'Room & Collaboration',
      icon: Logout03Icon,
      label: 'Leave Room',
      keywords: ['leave room', 'exit', 'disconnect', 'quit'],
      priority: 65,
      onSelect: act(async () => {
        await client.leave();
        routerPush('/');
      }),
    },

    // 4. Preferences, Appearance & Diagnostics
    ...buildPreferenceAndDiagnosticCommands(args, act, ui),
  ];
}
