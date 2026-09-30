'use client';

import { CheckmarkCircle02Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import { Dialog as D } from 'radix-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Kbd, Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { usePrefs } from '@/components/providers';
import { useStore } from '@/lib/hooks';
import { applyTheme, THEMES, type ThemeId } from '@/lib/prefs';
import { isMac } from '@/lib/utils';
import {
  CATEGORIES,
  buildPaletteCommands,
  scoreCommand,
  type PaletteCommand,
} from './command-palette-items';
import { useWorkspace } from './context';

/** ⌘K palette + VS Code-style theme QuickPick (⌘K ⌘T): arrow keys preview live, Enter commits, Esc reverts. */
export function CommandPalette() {
  const ws = useWorkspace();
  const mode = useStore(ws.ui).palette;
  const close = () => ws.ui.update((s) => ({ ...s, palette: false }));
  return (
    <D.Root open={mode !== false} onOpenChange={(v) => !v && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[1000] bg-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-[15vh] left-1/2 z-[1001] w-[min(38rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-overlay outline-none data-[state=open]:animate-fade-in motion-reduce:animate-none"
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
  const router = useRouter();
  const { prefs, setPrefs } = usePrefs();
  const roster = useStore(ws.client.roster);
  const room = useStore(ws.client.room);
  const uiState = useStore(ws.ui);
  const mod = isMac() ? '⌘' : 'Ctrl';

  const [search, setSearch] = useState('');

  const commands = useMemo<PaletteCommand[]>(() => {
    return buildPaletteCommands({
      ws,
      uiState,
      prefs,
      setPrefs,
      roster,
      room,
      mod,
      onClose,
      routerPush: router.push,
    });
  }, [ws, uiState, prefs, setPrefs, roster, room, mod, onClose, router]);

  const scoredItems = useMemo(() => {
    const q = search.trim();
    if (!q) return [];
    return commands
      .map((cmd) => ({ cmd, score: scoreCommand(cmd, q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [commands, search]);

  const isSearching = search.trim().length > 0;

  return (
    <Command
      shouldFilter={false}
      loop
      onKeyDown={(e) => {
        // ⌘K ⌘T chord: jump straight to the theme picker.
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
          e.preventDefault();
          ws.ui.update((s) => ({ ...s, palette: 'theme' }));
        }
      }}
    >
      <CommandInput
        autoFocus
        placeholder="Type a command or search settings…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        {isSearching ? (
          scoredItems.length === 0 ? (
            <CommandEmpty>No results found for &ldquo;{search}&rdquo;</CommandEmpty>
          ) : (
            <CommandGroup heading="Matching Commands">
              {scoredItems.map(({ cmd }) => (
                <PaletteItem
                  key={cmd.id}
                  icon={cmd.icon}
                  label={cmd.label}
                  shortcut={cmd.shortcut}
                  category={cmd.category}
                  showCategory={true}
                  settingsAction={cmd.settingsAction}
                  onSelect={cmd.onSelect}
                  onSettingsClick={() => {
                    if (cmd.settingsAction) {
                      onClose();
                      ws.ui.update((s) => ({
                        ...s,
                        settings: true,
                        settingsSection: cmd.settingsAction!.section,
                      }));
                    }
                  }}
                />
              ))}
            </CommandGroup>
          )
        ) : (
          CATEGORIES.map((category) => {
            const items = commands.filter((c) => c.category === category);
            if (items.length === 0) return null;
            return (
              <CommandGroup key={category} heading={category}>
                {items.map((cmd) => (
                  <PaletteItem
                    key={cmd.id}
                    icon={cmd.icon}
                    label={cmd.label}
                    shortcut={cmd.shortcut}
                    category={cmd.category}
                    showCategory={false}
                    settingsAction={cmd.settingsAction}
                    onSelect={cmd.onSelect}
                    onSettingsClick={() => {
                      if (cmd.settingsAction) {
                        onClose();
                        ws.ui.update((s) => ({
                          ...s,
                          settings: true,
                          settingsSection: cmd.settingsAction!.section,
                        }));
                      }
                    }}
                  />
                ))}
              </CommandGroup>
            );
          })
        )}
      </CommandList>
    </Command>
  );
}

function PaletteItem({
  icon,
  label,
  shortcut,
  category,
  showCategory = false,
  settingsAction,
  onSelect,
  onSettingsClick,
}: {
  icon: Parameters<typeof Icon>[0]['icon'];
  label: string;
  shortcut?: string;
  category?: string;
  showCategory?: boolean;
  settingsAction?: { label: string; section: 'editor' | 'appearance' | 'collab' | 'network' };
  onSelect: () => void;
  onSettingsClick?: () => void;
}) {
  return (
    <CommandItem
      onSelect={onSelect}
      value={label}
      className="group flex items-center gap-2 rounded-lg px-2 py-2 text-body outline-none select-none transition-ui"
    >
      <Icon icon={icon} className="shrink-0 text-muted-foreground group-hover:text-foreground transition-ui" />
      <span className="flex-1 truncate">{label}</span>
      {showCategory && category && (
        <span className="hidden sm:inline-flex rounded-full bg-muted/80 px-2 py-0.5 text-micro font-medium text-muted-foreground">
          {category}
        </span>
      )}
      {settingsAction && (
        <Tip label="Configure in Settings">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSettingsClick?.();
            }}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-ui"
            aria-label={`Configure ${label} in settings`}
          >
            <Icon icon={Settings01Icon} size={13} />
          </button>
        </Tip>
      )}
      {shortcut && <Kbd className="shrink-0">{shortcut}</Kbd>}
    </CommandItem>
  );
}
