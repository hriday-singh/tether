'use client';

import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons';
import { useState } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/menus';
import { toast } from '@/components/ui/toaster';
import { useStore } from '@/lib/hooks';
import { LANGUAGE_IDS, LANGUAGES, languageInfo, type LanguageId } from '@/lib/languages';
import { CommandError } from '@/lib/sync';
import { randomId } from '@/lib/utils';
import { useWorkspace } from './context';

/** Room-wide syntax mode. Host-only in the UI, and the server enforces it too. Pending until ok/error. */
export function LanguagePicker({ disabled }: { disabled: boolean }) {
  const ws = useWorkspace();
  const { client } = ws;
  const current = languageInfo(useStore(client.room).room.language);
  const [pending, setPending] = useState<LanguageId | null>(null);

  const change = async (id: LanguageId) => {
    if (id === current.id) return;
    setPending(id);
    if (languageInfo(id).preview !== null) {
      ws.ui.update((s) => ({ ...s, previewOpen: true, editorView: 'preview' }));
      ws.preview.set({ runId: randomId(4), scripts: false });
    }
    try {
      await client.command({ t: 'room.language', language: id });
    } catch (e) {
      toast.error('Could not change language', { description: e instanceof CommandError ? e.code : String(e) });
    } finally {
      setPending(null);
    }
  };

  const trigger = (
    <button
      type="button"
      disabled={disabled || pending !== null}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-caption font-medium transition-ui hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
      aria-label={`Language: ${current.label}${disabled ? ' (host only)' : ''}`}
    >
      <LanguageLogo language={pending ?? current.id} size={14} />
      {LANGUAGES[pending ?? current.id].label}
      {!disabled && <Icon icon={ArrowDown01Icon} size={12} className="text-muted-foreground" />}
    </button>
  );

  if (disabled) return <Tip label="Only the host can change the language">{trigger}</Tip>;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Language for everyone</DropdownMenuLabel>
        {LANGUAGE_IDS.map((id) => (
          <DropdownMenuItem key={id} onSelect={() => void change(id)}>
            <LanguageLogo language={id} />
            {LANGUAGES[id].label}
            {id === current.id && <Icon icon={Tick02Icon} size={14} className="ml-auto text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
