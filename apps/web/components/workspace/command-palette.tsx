'use client';

import {
  Activity01Icon,
  BracketsIcon,
  BrowserIcon,
  CheckmarkCircle02Icon,
  CodeIcon,
  Copy01Icon,
  Download04Icon,
  HighlighterIcon,
  KeyboardIcon,
  Link01Icon,
  PaintBoardIcon,
  PlayIcon,
  Settings01Icon,
  SidebarBottomIcon,
  SlidersHorizontalIcon,
  UserGroupIcon,
  ViewIcon,
  Wifi01Icon,
} from '@hugeicons/core-free-icons';
import { Dialog as D } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Kbd } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { toast } from '@/components/ui/toaster';
import { usePrefs } from '@/components/providers';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { applyTheme, THEMES, type ThemeId } from '@/lib/prefs';
import { isMac } from '@/lib/utils';
import { useWorkspace } from './context';
import { toggleLineHighlight } from './editor/collab';

/** ⌘K palette + VS Code-style theme QuickPick (⌘K ⌘T): arrow keys preview live, Enter commits, Esc reverts. */
export function CommandPalette() {
  const ws = useWorkspace();
  const mode = useStore(ws.ui).palette;
  const close = () => ws.ui.update((s) => ({ ...s, palette: false }));
  return (
    <D.Root open={mode !== false} onOpenChange={(v) => !v && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[15vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-overlay outline-none data-[state=open]:animate-fade-in motion-reduce:animate-none"
        >
          <D.Title className="sr-only">{mode === 'theme' ? 'Select color theme' : 'Command palette'}</D.Title>
          {mode === 'theme' ? <ThemePick onClose={close} /> : mode === 'commands' ? <Commands onClose={close} /> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function ThemePick({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = usePrefs();
  const [initial] = useState(prefs.themeId);
  const committed = useRef(false);
  const [active, setActive] = useState<string>(prefs.themeId);

  useEffect(() => {
    if (THEMES.some((t) => t.id === active)) applyTheme(active as ThemeId); // live preview on highlight
  }, [active]);
  useEffect(
    () => () => {
      if (!committed.current) applyTheme(initial); // Esc / click-away reverts
    },
    [initial],
  );

  return (
    <Command value={active} onValueChange={setActive} loop>
      <CommandInput autoFocus placeholder="Select Color Theme (Up/Down to preview, Enter to select)" />
      <CommandList>
        <CommandEmpty>No theme found.</CommandEmpty>
        {THEMES.map((t) => (
          <CommandItem
            key={t.id}
            value={t.id}
            keywords={[t.name, t.type]}
            onSelect={() => {
              committed.current = true;
              setPrefs({ themeId: t.id });
              onClose();
            }}
            className="justify-between font-mono text-caption"
          >
            <span>{t.name}</span>
            {t.id === initial && <Icon icon={CheckmarkCircle02Icon} size={14} className="text-primary" />}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

function Commands({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const { client } = ws;
  const { prefs, setPrefs } = usePrefs();
  const roster = useStore(client.roster);
  const room = useStore(client.room);
  const lang = languageInfo(room.room.language);
  const mod = isMac() ? '⌘' : 'Ctrl';
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const ui = (patch: Partial<ReturnType<typeof ws.ui.get>>) => ws.ui.update((s) => ({ ...s, ...patch }));

  const togglePref = <K extends 'ambientAnimations' | 'reduceMotion' | 'wordWrap' | 'lineNumbers' | 'bracketColors' | 'followUnlockOnInput' | 'offscreenCursorBadges' | 'telemetrySampling'>(
    key: K,
    name: string,
  ) => {
    const next = !prefs[key];
    setPrefs({ [key]: next });
    toast.success(`${name}: ${next ? 'Enabled' : 'Disabled'}`);
  };

  return (
    <Command
      loop
      onKeyDown={(e) => {
        // ⌘K ⌘T chord: jump straight to the theme picker.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
          e.preventDefault();
          ui({ palette: 'theme' });
        }
      }}
    >
      <CommandInput autoFocus placeholder="Type a command or search settings…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Editor">
          {(lang.runnable || lang.preview === 'html') && (
            <Item icon={PlayIcon} label="Run code" shortcut={`${mod} Enter`} onSelect={act(() => void ws.run())} />
          )}
          <Item
            icon={HighlighterIcon}
            label="Highlight current lines for everyone"
            shortcut="Alt H"
            onSelect={act(() => ws.view.current && toggleLineHighlight(ws.view.current, client.awareness, client.text))}
          />
          <Item
            icon={CodeIcon}
            label={`Word Wrap: ${prefs.wordWrap ? 'On' : 'Off'}`}
            keywords={['word wrap', 'wrap', 'editor', 'text', 'line wrap', 'settings']}
            onSelect={act(() => togglePref('wordWrap', 'Word wrap'))}
          />
          <Item
            icon={CodeIcon}
            label={`Line Numbers: ${prefs.lineNumbers ? 'On' : 'Off'}`}
            keywords={['line numbers', 'gutter', 'lines', 'editor', 'settings']}
            onSelect={act(() => togglePref('lineNumbers', 'Line numbers'))}
          />
          <Item
            icon={BracketsIcon}
            label={`Bracket Pair Colorization: ${prefs.bracketColors ? 'On' : 'Off'}`}
            keywords={['bracket pair colorization', 'brackets', 'parentheses', 'syntax', 'rainbow', 'editor', 'settings']}
            onSelect={act(() => togglePref('bracketColors', 'Bracket pair colorization'))}
          />
          <Item
            icon={CodeIcon}
            label={`Increase Font Size (Current: ${prefs.editorFontSize}px)`}
            keywords={['increase font size', 'font size', 'text size', 'larger', 'editor', 'settings']}
            onSelect={act(() => {
              const next = Math.min(18, prefs.editorFontSize + 1);
              setPrefs({ editorFontSize: next });
              toast.success(`Editor font size: ${next}px`);
            })}
          />
          <Item
            icon={CodeIcon}
            label={`Decrease Font Size (Current: ${prefs.editorFontSize}px)`}
            keywords={['decrease font size', 'font size', 'text size', 'smaller', 'editor', 'settings']}
            onSelect={act(() => {
              const next = Math.max(11, prefs.editorFontSize - 1);
              setPrefs({ editorFontSize: next });
              toast.success(`Editor font size: ${next}px`);
            })}
          />
          <Item
            icon={CodeIcon}
            label="Tab Size: 2 Spaces"
            keywords={['tab size', 'indentation', 'spaces', 'tab 2', 'editor', 'settings']}
            onSelect={act(() => {
              setPrefs({ tabSize: 2 });
              toast.success('Tab size: 2 Spaces');
            })}
          />
          <Item
            icon={CodeIcon}
            label="Tab Size: 4 Spaces"
            keywords={['tab size', 'indentation', 'spaces', 'tab 4', 'editor', 'settings']}
            onSelect={act(() => {
              setPrefs({ tabSize: 4 });
              toast.success('Tab size: 4 Spaces');
            })}
          />
        </CommandGroup>

        <CommandGroup heading="Appearance">
          <Item icon={PaintBoardIcon} label="Preferences: Color Theme" shortcut={`${mod} K ${mod} T`} keywords={['theme', 'color', 'dark', 'light', 'appearance', 'palette']} onSelect={() => ui({ palette: 'theme' })} />
          <Item
            icon={PaintBoardIcon}
            label="Theme: Quiet Dark (Default)"
            keywords={['quiet dark', 'dark theme', 'theme', 'color', 'appearance']}
            onSelect={act(() => {
              setPrefs({ themeId: 'quiet-dark' });
              toast.success('Theme set to Quiet Dark');
            })}
          />
          <Item
            icon={PaintBoardIcon}
            label="Theme: Quiet Light"
            keywords={['quiet light', 'light theme', 'theme', 'color', 'appearance']}
            onSelect={act(() => {
              setPrefs({ themeId: 'quiet-light' });
              toast.success('Theme set to Quiet Light');
            })}
          />
          <Item
            icon={PaintBoardIcon}
            label="Theme: High Contrast Dark"
            keywords={['contrast dark', 'high contrast', 'dark theme', 'theme', 'accessibility']}
            onSelect={act(() => {
              setPrefs({ themeId: 'contrast-dark' });
              toast.success('Theme set to High Contrast Dark');
            })}
          />
          <Item
            icon={PaintBoardIcon}
            label="Theme: High Contrast Light"
            keywords={['contrast light', 'high contrast', 'light theme', 'theme', 'accessibility']}
            onSelect={act(() => {
              setPrefs({ themeId: 'contrast-light' });
              toast.success('Theme set to High Contrast Light');
            })}
          />
          <Item
            icon={SlidersHorizontalIcon}
            label="UI Font Scale: Small"
            keywords={['ui scale', 'font scale', 'small', 'zoom', 'appearance', 'settings']}
            onSelect={act(() => {
              setPrefs({ uiScale: 'sm' });
              toast.success('UI scale set to Small');
            })}
          />
          <Item
            icon={SlidersHorizontalIcon}
            label="UI Font Scale: Medium (Default)"
            keywords={['ui scale', 'font scale', 'medium', 'zoom', 'appearance', 'settings']}
            onSelect={act(() => {
              setPrefs({ uiScale: 'md' });
              toast.success('UI scale set to Medium');
            })}
          />
          <Item
            icon={SlidersHorizontalIcon}
            label="UI Font Scale: Large"
            keywords={['ui scale', 'font scale', 'large', 'zoom', 'appearance', 'settings']}
            onSelect={act(() => {
              setPrefs({ uiScale: 'lg' });
              toast.success('UI scale set to Large');
            })}
          />
          <Item
            icon={SlidersHorizontalIcon}
            label={`Ambient Animations: ${prefs.ambientAnimations ? 'On' : 'Off'}`}
            keywords={['ambient animations', 'canvas', 'orbs', 'effects', 'appearance', 'settings']}
            onSelect={act(() => togglePref('ambientAnimations', 'Ambient animations'))}
          />
          <Item
            icon={SlidersHorizontalIcon}
            label={`Reduce Motion: ${prefs.reduceMotion ? 'On' : 'Off'}`}
            keywords={['reduce motion', 'motion', 'animations', 'transitions', 'accessibility', 'settings']}
            onSelect={act(() => togglePref('reduceMotion', 'Reduce motion'))}
          />
        </CommandGroup>

        <CommandGroup heading="Collaboration">
          <Item
            icon={UserGroupIcon}
            label={`Unlock Follow on Input: ${prefs.followUnlockOnInput ? 'On' : 'Off'}`}
            keywords={['unlock follow on input', 'follow', 'typing', 'scroll', 'collaboration', 'settings']}
            onSelect={act(() => togglePref('followUnlockOnInput', 'Unlock follow on input'))}
          />
          <Item
            icon={UserGroupIcon}
            label={`Off-Screen Cursor Badges: ${prefs.offscreenCursorBadges ? 'On' : 'Off'}`}
            keywords={['off-screen cursor badges', 'cursor', 'presence', 'badges', 'collaboration', 'settings']}
            onSelect={act(() => togglePref('offscreenCursorBadges', 'Off-screen cursor badges'))}
          />
          <Item
            icon={UserGroupIcon}
            label={`Cursor Name Fade: ${prefs.cursorFlagFadeSeconds.toFixed(1)}s (Click to Cycle)`}
            keywords={['cursor name fade', 'cursor', 'presence', 'flag', 'fade', 'duration', 'collaboration', 'settings']}
            onSelect={act(() => {
              const next = prefs.cursorFlagFadeSeconds >= 5 ? 1 : prefs.cursorFlagFadeSeconds + 1;
              setPrefs({ cursorFlagFadeSeconds: next });
              toast.success(`Cursor name fade: ${next}s`);
            })}
          />
        </CommandGroup>

        <CommandGroup heading="Network & Telemetry">
          <Item
            icon={Wifi01Icon}
            label={`Live Latency Sampling: ${prefs.telemetrySampling ? 'On' : 'Off'}`}
            keywords={['live latency sampling', 'telemetry', 'sampling', 'rtt', 'ping', 'network', 'settings']}
            onSelect={act(() => togglePref('telemetrySampling', 'Live latency sampling'))}
          />
          <Item
            icon={Wifi01Icon}
            label={`Reset Simulated Latency to 0 ms (Current: ${prefs.simulatedLatencyMs}ms)`}
            keywords={['reset simulated latency', 'latency', 'network', 'delay', 'jitter', 'settings']}
            onSelect={act(() => {
              setPrefs({ simulatedLatencyMs: 0 });
              toast.success('Simulated latency reset to 0ms');
            })}
          />
          <Item
            icon={Wifi01Icon}
            label="Simulated Latency: 50 ms (Mild jitter)"
            keywords={['simulated latency 50ms', 'latency', 'network', 'delay', 'settings']}
            onSelect={act(() => {
              setPrefs({ simulatedLatencyMs: 50 });
              toast.success('Simulated latency set to 50ms');
            })}
          />
          <Item
            icon={Wifi01Icon}
            label="Simulated Latency: 150 ms (Cross-region demo)"
            keywords={['simulated latency 150ms', 'latency', 'network', 'delay', 'settings']}
            onSelect={act(() => {
              setPrefs({ simulatedLatencyMs: 150 });
              toast.success('Simulated latency set to 150ms');
            })}
          />
        </CommandGroup>

        <CommandGroup heading="View">
          <Item icon={SidebarBottomIcon} label="Toggle diagnostics drawer" shortcut="Ctrl `" keywords={['drawer', 'diagnostics', 'telemetry', 'events', 'chaos']} onSelect={act(() => ws.ui.update((s) => ({ ...s, drawerOpen: !s.drawerOpen })))} />
          <Item icon={UserGroupIcon} label="Show people" keywords={['sidebar', 'people', 'roster', 'users']} onSelect={act(() => ui({ sidebarTab: 'people' }))} />
          <Item icon={Activity01Icon} label="Show activity" keywords={['sidebar', 'activity', 'events', 'log']} onSelect={act(() => ui({ sidebarTab: 'activity' }))} />
          {lang.preview && <Item icon={BrowserIcon} label="Toggle preview (laptop layout)" keywords={['preview', 'browser', 'html', 'live']} onSelect={act(() => ws.ui.update((s) => ({ ...s, editorView: s.editorView === 'code' ? 'preview' : 'code' })))} />}
        </CommandGroup>

        {roster.length > 1 && (
          <CommandGroup heading="People">
            {roster
              .filter((m) => m.id !== room.selfId)
              .map((m) => (
                <Item key={m.id} icon={ViewIcon} label={`Follow ${m.name}`} keywords={['follow', m.name, 'collaborator']} onSelect={act(() => ws.follow.set(m.id))} />
              ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Room">
          <Item icon={Link01Icon} label="Copy invite link" keywords={['copy', 'invite', 'link', 'share', 'room']} onSelect={act(() => void navigator.clipboard.writeText(`${location.origin}/r/${ws.roomId}`).then(() => toast.success('Invite link copied')))} />
          <Item icon={Copy01Icon} label="Copy all code" keywords={['copy', 'code', 'all', 'clipboard']} onSelect={act(() => void navigator.clipboard.writeText(client.text.toString()).then(() => toast.success('Copied')))} />
          <Item
            icon={Download04Icon}
            label={`Download ${ws.roomId}.${lang.ext}`}
            keywords={['download', 'export', 'save', 'file']}
            onSelect={act(() => {
              const url = URL.createObjectURL(new Blob([client.text.toString()], { type: 'text/plain' }));
              Object.assign(document.createElement('a'), { href: url, download: `${ws.roomId}.${lang.ext}` }).click();
              URL.revokeObjectURL(url);
            })}
          />
        </CommandGroup>

        <CommandGroup heading="Settings Dialog">
          <Item icon={Settings01Icon} label="Open Settings Dialog" shortcut={`${mod} ,`} keywords={['settings', 'preferences', 'dialog', 'modal', 'options']} onSelect={act(() => ui({ settings: true }))} />
          <Item icon={KeyboardIcon} label="Keyboard shortcuts" shortcut="?" keywords={['keyboard', 'shortcuts', 'help', 'hotkeys']} onSelect={act(() => ui({ shortcuts: true }))} />
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function Item({
  icon,
  label,
  shortcut,
  keywords,
  onSelect,
}: {
  icon: Parameters<typeof Icon>[0]['icon'];
  label: string;
  shortcut?: string;
  keywords?: string[];
  onSelect: () => void;
}) {
  return (
    <CommandItem onSelect={onSelect} value={label} keywords={keywords}>
      <Icon icon={icon} className="text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </CommandItem>
  );
}
