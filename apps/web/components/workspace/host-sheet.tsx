'use client';

import { CrownIcon, Key01Icon, LockKeyIcon, UserRemove01Icon, UserSwitchIcon } from '@hugeicons/core-free-icons';
import { useState } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Dialog, DialogDescription, DialogHeader, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { HoldButton } from '@/components/ui/hold-button';
import { Icon } from '@/components/ui/icon';
import { Field, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { PasscodeSchema } from '@/lib/api';
import { useStore } from '@/lib/hooks';
import { CommandError, type SyncCommand } from '@/lib/sync';
import { useWorkspace } from './context';

/** Host controls. Every action stays pending until ok/error for its rid; the server enforces host-only too. */
export function HostSheet() {
  const ws = useWorkspace();
  const { client } = ws;
  const open = useStore(ws.ui).hostSheet;
  const room = useStore(client.room);
  const roster = useStore(client.roster);
  const [pending, setPending] = useState<string | null>(null);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isHost = room.hostId === room.selfId;
  const others = roster.filter((m) => m.id !== room.selfId && !m.isBot);

  const send = async (key: string, cmd: SyncCommand, success: string) => {
    setPending(key);
    try {
      await client.command(cmd);
      toast.success(success);
      return true;
    } catch (e) {
      toast.error('Action failed', { description: e instanceof CommandError ? e.code : String(e) });
      return false;
    } finally {
      setPending(null);
    }
  };

  const savePasscode = async () => {
    const parsed = PasscodeSchema.safeParse(passcode);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Invalid passcode');
    setError(null);
    if (await send('pass', { t: 'host.passcode', passcode }, room.room.hasPasscode ? 'Passcode changed' : 'Passcode set')) setPasscode('');
  };

  return (
    <Dialog open={open && isHost} onOpenChange={(v) => ws.ui.update((s) => ({ ...s, hostSheet: v }))}>
      <SheetContent aria-describedby="host-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon icon={CrownIcon} className="text-warning" /> Host controls
          </DialogTitle>
          <DialogDescription id="host-desc">Changes apply to everyone in {ws.roomId}.</DialogDescription>
        </DialogHeader>

        <section className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div className="flex items-start gap-2.5">
            <Icon icon={LockKeyIcon} className="mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-body font-medium">Lock room</p>
              <p className="text-caption text-muted-foreground">No new members. People already in can reconnect.</p>
            </div>
          </div>
          <Switch
            checked={room.room.locked}
            disabled={pending === 'lock'}
            aria-label="Lock room"
            onCheckedChange={(v) => void send('lock', { t: 'host.lock', locked: v }, v ? 'Room locked' : 'Room unlocked')}
          />
        </section>

        <section className="flex flex-col gap-2.5 rounded-xl border border-border p-3">
          <div className="flex items-start gap-2.5">
            <Icon icon={Key01Icon} className="mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-body font-medium">Passcode {room.room.hasPasscode ? '(on)' : '(off)'}</p>
              <p className="text-caption text-muted-foreground">Connected members keep their session when it changes.</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void savePasscode();
            }}
            className="flex flex-col gap-2"
          >
            <Field id="host-pass" label={room.room.hasPasscode ? 'New passcode' : 'Set passcode'} error={error}>
              <Input
                id="host-pass"
                type="password"
                autoComplete="new-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                aria-invalid={!!error}
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending === 'pass' || !passcode}>
                {room.room.hasPasscode ? 'Change' : 'Set'}
              </Button>
              {room.room.hasPasscode && (
                <Button size="sm" variant="outline" disabled={pending === 'pass'} onClick={() => void send('pass', { t: 'host.passcode', passcode: null }, 'Passcode cleared')}>
                  Clear
                </Button>
              )}
            </div>
          </form>
        </section>

        <section className="flex flex-col gap-1 rounded-xl border border-border p-2">
          <p className="px-1 pt-1 text-caption font-medium text-muted-foreground">Members</p>
          {others.length === 0 && <p className="px-1 py-2 text-caption text-muted-foreground">Nobody else is here yet.</p>}
          {others.map((m) => (
            <div key={m.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
              <Avatar name={m.name} colorIndex={m.colorIndex} size="sm" dimmed={m.status === 'reconnecting'} />
              <span className="min-w-0 flex-1 truncate text-body">{m.name}</span>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending !== null || m.status === 'reconnecting'}
                onClick={() => void send(`t-${m.id}`, { t: 'host.transfer', memberId: m.id }, `${m.name} is now host`)}
              >
                <Icon icon={UserSwitchIcon} size={12} /> Host
              </Button>
              <HoldButton disabled={pending !== null} onConfirm={() => void send(`k-${m.id}`, { t: 'host.kick', memberId: m.id }, `${m.name} removed`)} className="h-6 px-2 text-micro">
                <Icon icon={UserRemove01Icon} size={12} /> Kick
              </HoldButton>
            </div>
          ))}
        </section>
      </SheetContent>
    </Dialog>
  );
}
