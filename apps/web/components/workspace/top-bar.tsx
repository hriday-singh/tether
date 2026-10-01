'use client';

import {
  CommandIcon,
  Copy01Icon,
  CrownIcon,
  Download04Icon,
  Link01Icon,
  LockKeyIcon,
  Logout03Icon,
  PlayIcon,
  Settings01Icon,
  Share08Icon,
  StopIcon,
  CheckmarkCircle02Icon,
  TextAlignLeftIcon,
} from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Kbd, Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menus';
import { MorphIcon, TextMorph } from '@/components/ui/motion';
import { toast } from '@/components/ui/toaster';
import { formatCode } from '@/lib/formatter';
import { useFlag, useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { cn, isMac } from '@/lib/utils';
import { Logo } from '../brand';
import { useWorkspace } from './context';
import { LanguagePicker } from './language-picker';
import { LatencyHud, StatusPill } from './sync-status';
import { ViewMenu } from './view-menu';

export function TopBar() {
  const ws = useWorkspace();
  const room = useStore(ws.client.room);
  const isHost = room.hostId === room.selfId;
  const lang = languageInfo(room.room.language);
  const running = useStore(ws.running);
  const canRun = lang.runnable || lang.preview === 'html';
  const mod = isMac() ? '⌘' : 'Ctrl';

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border/60 bg-card/80 px-2 shadow-capsule backdrop-blur-md">
      <Link href="/" aria-label="Tether home" className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-ui hover:bg-accent">
        <Logo className="size-5" />
        <span className="text-body font-semibold tracking-tight">Tether</span>
      </Link>
      <span aria-hidden className="hidden sm:inline-block h-4 w-px bg-border" />
      <RoomIdPill roomId={ws.roomId} />
      {room.room.locked && (
        <Tip label="Room locked: no new members">
          <span className="inline-flex text-warning">
            <Icon icon={LockKeyIcon} size={14} label="Locked" />
          </span>
        </Tip>
      )}
      <LanguagePicker disabled={!isHost} />
      {canRun && (
        <Button
          size="sm"
          variant={running ? 'outline' : 'secondary'}
          onClick={() => (running ? ws.stop() : void ws.run())}
          aria-keyshortcuts="Control+Enter Meta+Enter"
        >
          <MorphIcon icon={running ? StopIcon : PlayIcon} size={14} />
          <TextMorph>{running ? 'Stop' : lang.preview === 'html' ? 'Run page' : 'Run'}</TextMorph>
        </Button>
      )}
      <div className="hidden sm:inline-flex">
        <InviteButton roomId={ws.roomId} />
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <div className="hidden md:flex">
          <AvatarStack />
        </div>
        <StatusPill />
        <div className="hidden lg:inline-flex">
          <LatencyHud />
        </div>
        <Tip label="Command palette" shortcut={`${mod} K`}>
          <button
            type="button"
            onClick={() => ws.ui.update((s) => ({ ...s, palette: 'commands' }))}
            className="hidden sm:inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2 text-caption text-muted-foreground transition-ui hover:text-foreground"
            aria-label="Open command palette"
          >
            <Icon icon={CommandIcon} size={14} />
            <Kbd className="h-4 border-0 bg-transparent px-0">K</Kbd>
          </button>
        </Tip>
        <div className="hidden sm:inline-flex">
          <FormatButton />
        </div>
        <div className="hidden lg:inline-flex">
          <ViewMenu />
        </div>
        {isHost && (
          <Tip label="Host controls">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Host controls"
              onClick={() => ws.ui.update((s) => ({ ...s, hostSheet: true }))}
            >
              <Icon icon={CrownIcon} size={14} className="text-warning" />
            </Button>
          </Tip>
        )}
        <OverflowMenu languageExt={lang.ext} />
        <Tip label="Settings" shortcut={`${mod} ,`}>
          <Button size="icon-sm" variant="ghost" aria-label="Settings" onClick={() => ws.ui.update((s) => ({ ...s, settings: true }))}>
            <Icon icon={Settings01Icon} size={14} />
          </Button>
        </Tip>
      </div>
    </header>
  );
}

function FormatButton() {
  const ws = useWorkspace();
  const room = useStore(ws.client.room);
  const isHost = room.hostId === room.selfId;
  const locked = room.room.locked;
  const canFormat = isHost || !locked;

  const handleFormat = async () => {
    if (!canFormat) {
      toast.info('Room is locked. Only the host can format.');
      return;
    }
    const currentText = ws.client.text.toString();
    if (!currentText.trim()) return;

    try {
      const formatted = await formatCode(currentText, languageInfo(room.room.language).id);
      if (formatted === currentText) {
        toast.info('Document is already formatted');
        return;
      }
      ws.client.doc.transact(() => {
        ws.client.text.delete(0, ws.client.text.length);
        ws.client.text.insert(0, formatted);
      });
      toast.success('Document formatted');
    } catch {
      toast.error('Failed to format document');
    }
  };

  return (
    <Tip label="Format document" shortcut="Shift Alt F">
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Format document"
        onClick={() => void handleFormat()}
        disabled={!canFormat}
      >
        <Icon icon={TextAlignLeftIcon} size={14} />
      </Button>
    </Tip>
  );
}

function RoomIdPill({ roomId }: { roomId: string }) {
  const [copied, flash] = useFlag(2000);
  const handleCopy = () => {
    navigator.clipboard
      .writeText(roomId)
      .then(flash)
      .catch(() => {
        toast.error('Failed to copy room ID');
      });
  };
  return (
    <Tip label="Copy room ID">
      <button
        type="button"
        onClick={handleCopy}
        className="hidden sm:inline-flex h-7 max-w-48 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 font-mono text-caption transition-ui hover:border-primary/40"
        aria-label={copied ? 'Room ID copied' : `Copy room ID ${roomId}`}
      >
        <span className="truncate">{roomId}</span>
        <MorphIcon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={13} className={cn(copied ? 'text-success' : 'text-muted-foreground')} />
      </button>
    </Tip>
  );
}

/** Copies /r/<roomId> (never the passcode). Uses the native share sheet where available. */
export function InviteButton({ roomId }: { roomId: string }) {
  const [copied, flash] = useFlag(2000);
  const share = async () => {
    const url = `${window.location.origin}/r/${roomId}`;
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title: 'Join my Tether room', url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    flash();
    toast.success('Invite link copied', { description: 'The password is not included. Share it separately.' });
  };
  return (
    <Button size="sm" variant="ghost" onClick={() => void share()}>
      <MorphIcon icon={copied ? CheckmarkCircle02Icon : Share08Icon} size={14} />
      <TextMorph>{copied ? 'Copied' : 'Share'}</TextMorph>
    </Button>
  );
}

function AvatarStack() {
  const { client } = useWorkspace();
  const roster = useStore(client.roster);
  const shown = roster.slice(0, 4);
  const extra = roster.length - shown.length;
  return (
    <div className="flex items-center pr-1" aria-label={`${roster.filter((m) => !m.isBot).length} people in this room`} role="img">
      {shown.map((m) => (
        <Avatar key={m.id} name={m.name} colorIndex={m.colorIndex} isBot={m.isBot} size="sm" dimmed={m.status === 'reconnecting'} className="-ml-1.5 first:ml-0" />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 inline-grid size-6 place-items-center rounded-full bg-muted text-micro font-medium text-muted-foreground ring-2 ring-card">
          +{extra}
        </span>
      )}
    </div>
  );
}

/** Export (download / copy all) and leave. */
function OverflowMenu({ languageExt }: { languageExt: string }) {
  const ws = useWorkspace();
  const router = useRouter();
  const download = () => {
    const blob = new Blob([ws.client.text.toString()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: `${ws.roomId}.${languageExt}` });
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyAll = async () => {
    await navigator.clipboard.writeText(ws.client.text.toString());
    toast.success('Copied the whole document');
  };
  const leave = async () => {
    await ws.client.leave();
    router.push('/');
  };
  return (
    <DropdownMenu>
      <Tip label="Export and more">
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="Export and more">
            <Icon icon={Download04Icon} size={14} />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Export</DropdownMenuLabel>
        <DropdownMenuItem onSelect={download}>
          <Icon icon={Download04Icon} size={14} /> Download {ws.roomId}.{languageExt}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void copyAll()}>
          <Icon icon={Copy01Icon} size={14} /> Copy all
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(`${location.origin}/r/${ws.roomId}`).then(() => toast.success('Invite link copied'))}>
          <Icon icon={Link01Icon} size={14} /> Copy invite link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void leave()}>
          <Icon icon={Logout03Icon} size={14} /> Leave room
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

