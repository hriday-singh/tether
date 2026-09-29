'use client';

import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  Download04Icon,
  HighlighterIcon,
  KeyboardIcon,
  Link01Icon,
  PaintBoardIcon,
  PlayIcon,
  Settings01Icon,
  SidebarBottomIcon,
  UserGroupIcon,
  Activity01Icon,
  ViewIcon,
  BrowserIcon,
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
  const roster = useStore(client.roster);
  const room = useStore(client.room);
  const lang = languageInfo(room.room.language);
  const mod = isMac() ? '⌘' : 'Ctrl';
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const ui = (patch: Partial<ReturnType<typeof ws.ui.get>>) => ws.ui.update((s) => ({ ...s, ...patch }));

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
      <CommandInput autoFocus placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
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
        </CommandGroup>
        <CommandGroup heading="View">
          <Item icon={SidebarBottomIcon} label="Toggle diagnostics drawer" shortcut="Ctrl `" onSelect={act(() => ws.ui.update((s) => ({ ...s, drawerOpen: !s.drawerOpen })))} />
          <Item icon={UserGroupIcon} label="Show people" onSelect={act(() => ui({ sidebarTab: 'people' }))} />
          <Item icon={Activity01Icon} label="Show activity" onSelect={act(() => ui({ sidebarTab: 'activity' }))} />
          {lang.preview && <Item icon={BrowserIcon} label="Toggle preview (laptop layout)" onSelect={act(() => ws.ui.update((s) => ({ ...s, editorView: s.editorView === 'code' ? 'preview' : 'code' })))} />}
        </CommandGroup>
        {roster.length > 1 && (
          <CommandGroup heading="People">
            {roster
              .filter((m) => m.id !== room.selfId)
              .map((m) => (
                <Item key={m.id} icon={ViewIcon} label={`Follow ${m.name}`} onSelect={act(() => ws.follow.set(m.id))} />
              ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Room">
          <Item icon={Link01Icon} label="Copy invite link" onSelect={act(() => void navigator.clipboard.writeText(`${location.origin}/r/${ws.roomId}`).then(() => toast.success('Invite link copied')))} />
          <Item icon={Copy01Icon} label="Copy all code" onSelect={act(() => void navigator.clipboard.writeText(client.text.toString()).then(() => toast.success('Copied')))} />
          <Item
            icon={Download04Icon}
            label={`Download ${ws.roomId}.${lang.ext}`}
            onSelect={act(() => {
              const url = URL.createObjectURL(new Blob([client.text.toString()], { type: 'text/plain' }));
              Object.assign(document.createElement('a'), { href: url, download: `${ws.roomId}.${lang.ext}` }).click();
              URL.revokeObjectURL(url);
            })}
          />
        </CommandGroup>
        <CommandGroup heading="Preferences">
          <Item icon={PaintBoardIcon} label="Preferences: Color Theme" shortcut={`${mod} K ${mod} T`} onSelect={() => ui({ palette: 'theme' })} />
          <Item icon={Settings01Icon} label="Open settings" shortcut={`${mod} ,`} onSelect={act(() => ui({ settings: true }))} />
          <Item icon={KeyboardIcon} label="Keyboard shortcuts" shortcut="?" onSelect={act(() => ui({ shortcuts: true }))} />
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

function Item({ icon, label, shortcut, onSelect }: { icon: Parameters<typeof Icon>[0]['icon']; label: string; shortcut?: string; onSelect: () => void }) {
  return (
    <CommandItem onSelect={onSelect} value={label}>
      <Icon icon={icon} className="text-muted-foreground" />
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd>{shortcut}</Kbd>}
    </CommandItem>
  );
}
