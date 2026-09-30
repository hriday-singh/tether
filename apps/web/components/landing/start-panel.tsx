'use client';

import { ArrowRight01Icon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Field, Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/menus';
import { seedKey } from '@/components/workspace/room-screen';
import { api, ApiError, CreateRoomInputSchema, DisplayNameSchema, RoomIdSchema } from '@/lib/api';
import { useMounted } from '@/lib/hooks';
import { LANGUAGE_IDS, LANGUAGES, type LanguageId } from '@/lib/languages';
import { sessions, type RecentSession } from '@/lib/session';

type Errors = Partial<Record<'name' | 'roomId' | 'passcode' | 'form', string>>;

function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? 'form') as keyof Errors;
    out[key] ??= i.message;
  }
  return out;
}

// Nav and panel both read the last session; forgetting it in one must update the other.
const RECENT_EVENT = 'tether:recent-changed';
const subscribeRecent = (cb: () => void) => {
  window.addEventListener(RECENT_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(RECENT_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
};

export function useLastSession(): RecentSession | null {
  // Snapshot as a string so identical sessions compare equal between renders.
  const raw = useSyncExternalStore(
    subscribeRecent,
    () => JSON.stringify(sessions.last()),
    () => 'null',
  );
  return JSON.parse(raw) as RecentSession | null;
}

function forgetSession(roomId: string) {
  sessions.forgetRecent(roomId);
  window.dispatchEvent(new Event(RECENT_EVENT));
}

/** Nav action: jumps straight back into the last room when there is one, otherwise scrolls to the start panel. */
export function NavStartButton() {
  const last = useLastSession();
  return (
    <Button variant="ghost" size="sm" asChild>
      {last ? (
        <Link href={`/r/${last.roomId}`}>
          Resume <Icon icon={ArrowRight01Icon} size={14} />
        </Link>
      ) : (
        <a href="#start">Start</a>
      )}
    </Button>
  );
}

function ResumeRow() {
  const last = useLastSession();
  if (!last) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-4 text-body text-muted-foreground">
      <p className="min-w-0">
        Continue in <span className="font-mono text-foreground">{last.roomId}</span>
        {last.name && (
          <>
            {' '}
            as <span className="text-foreground">{last.name}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => forgetSession(last.roomId)}>
          Forget
        </Button>
        <Button variant="ghost" size="sm" className="text-foreground" asChild>
          <Link href={`/r/${last.roomId}`}>
            Open <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </Button>
      </div>
    </div>
  );
}

export function StartPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const mounted = useMounted();
  // null = untouched, so the remembered name shows as a real value without an effect.
  const [nameInput, setNameInput] = useState<string | null>(null);
  const name = nameInput ?? (mounted ? sessions.lastName() : '');

  const [language, setLanguage] = useState<LanguageId>('html');
  const [roomId, setRoomId] = useState(params.get('room') ?? '');
  const [passcode, setPasscode] = useState('');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState<Errors>({});
  // One key per intended room, so a double submit or a retry after a timeout never makes two rooms.
  const idempotencyKey = useRef<string | null>(null);

  const [joinId, setJoinId] = useState('');
  const [joinPass, setJoinPass] = useState('');
  const [joinErr, setJoinErr] = useState<Errors>({});

  const [mode, setMode] = useState<'create' | 'join'>('create');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);

  const create = async (e: FormEvent, override?: string) => {
    e.preventDefault();
    const parsed = CreateRoomInputSchema.safeParse({
      name,
      roomId: (override ?? roomId).trim() || undefined,
      passcode: passcode || undefined,
      language,
    });
    setJoinErr({});
    if (!parsed.success) return setCreateErr(fieldErrors(parsed.error.issues));
    setCreateErr({});
    setSuggestion(null);
    setBusy('create');
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const res = await api.createRoom(parsed.data, idempotencyKey.current);
      sessions.set(res.room.id, { token: res.token, memberId: res.memberId, name: parsed.data.name, epoch: res.room.epoch });
      sessionStorage.setItem(seedKey(res.room.id), '1');
      router.push(`/r/${res.room.id}`);
    } catch (err) {
      idempotencyKey.current = null;
      if (err instanceof ApiError && err.code === 'room_taken') {
        setCreateErr({ roomId: err.message });
        setSuggestion(typeof err.details.suggestion === 'string' ? err.details.suggestion : null);
      } else {
        setCreateErr({ form: err instanceof ApiError ? err.message : 'Could not create the room. Try again.' });
      }
      setBusy(null);
    }
  };

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const id = RoomIdSchema.safeParse(joinId);
    const nm = DisplayNameSchema.safeParse(name);
    setCreateErr({});
    if (!id.success || !nm.success) {
      return setJoinErr({ roomId: id.error?.issues[0]?.message, name: nm.error?.issues[0]?.message });
    }
    setJoinErr({});
    setBusy('join');
    try {
      // Already a member on this device? Go straight in.
      if (!sessions.get(id.data)) {
        const res = await api.joinRoom(id.data, { name: nm.data, passcode: joinPass || undefined });
        sessions.set(id.data, { token: res.token, memberId: res.memberId, name: nm.data, epoch: res.room.epoch });
      }
      router.push(`/r/${id.data}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      if (code === 'bad_passcode') {
        setJoinErr({ passcode: joinPass ? (err as ApiError).message : 'This room needs a passcode' });
      } else if (code === 'not_found') {
        setJoinErr({ roomId: (err as ApiError).message });
      } else {
        setJoinErr({ form: err instanceof ApiError ? err.message : 'Could not join. Try again.' });
      }
      setBusy(null);
    }
  };

  const nameError = mode === 'create' ? createErr.name : joinErr.name;

  const formError = mode === 'create' ? createErr.form : joinErr.form;

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-7">
      <ResumeRow />

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-title font-semibold">{mode === 'create' ? 'Create a room' : 'Join a room'}</h3>
        <Button variant="ghost" size="sm" className="text-primary" onClick={() => setMode(mode === 'create' ? 'join' : 'create')}>
          {mode === 'create' ? 'Join one instead' : 'Create one instead'}
        </Button>
      </div>

      {/* One form that swaps its fields; the name is shared so switching modes never loses it. */}
      <form
        onSubmit={(e) => void (mode === 'create' ? create(e) : join(e))}
        className="flex flex-col gap-4"
        aria-busy={busy !== null}
        noValidate
      >
        <Field id="s-name" label="Your name" error={nameError}>
          <Input
            id="s-name"
            autoComplete="nickname"
            maxLength={50}
            value={name}
            placeholder="Asha"
            onChange={(e) => setNameInput(e.target.value)}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? 's-name-error' : undefined}
          />
        </Field>

        {mode === 'create' ? (
          <div key="create" className="flex animate-fade-in flex-col gap-4 motion-reduce:animate-none">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="s-lang" label="Language">
                <Select id="s-lang" value={language} onValueChange={(v) => setLanguage(v as LanguageId)} aria-label="Language">
                  {LANGUAGE_IDS.map((id) => (
                    <SelectItem key={id} value={id}>
                      <LanguageLogo language={id} /> {LANGUAGES[id].label}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Field id="s-room" label="Room ID" hint="Optional. Blank picks one." error={createErr.roomId}>
                <Input
                  id="s-room"
                  value={roomId}
                  placeholder="team-standup"
                  onChange={(e) => setRoomId(e.target.value.toLowerCase())}
                  className="font-mono"
                  aria-invalid={!!createErr.roomId}
                  aria-describedby={createErr.roomId ? 's-room-error' : 's-room-hint'}
                />
              </Field>
            </div>
            {suggestion && (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={(e) => {
                  setRoomId(suggestion);
                  void create(e as unknown as FormEvent, suggestion);
                }}
              >
                Use <span className="font-mono">{suggestion}</span> instead
              </Button>
            )}
            <Field id="s-pass" label="Passcode" hint="Optional. Share the link, not the passcode." error={createErr.passcode}>
              <Input
                id="s-pass"
                type="password"
                autoComplete="new-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                aria-invalid={!!createErr.passcode}
                aria-describedby={createErr.passcode ? 's-pass-error' : 's-pass-hint'}
              />
            </Field>
          </div>
        ) : (
          <div key="join" className="flex animate-fade-in flex-col gap-4 motion-reduce:animate-none">
            <Field id="s-join" label="Room ID" error={joinErr.roomId}>
              <Input
                id="s-join"
                value={joinId}
                placeholder="team-standup"
                onChange={(e) => setJoinId(e.target.value.toLowerCase())}
                className="font-mono"
                aria-invalid={!!joinErr.roomId}
                aria-describedby={joinErr.roomId ? 's-join-error' : undefined}
              />
            </Field>
            <Field id="s-join-pass" label="Passcode" hint="Only if the room has one." error={joinErr.passcode}>
              <Input
                id="s-join-pass"
                type="password"
                autoComplete="current-password"
                value={joinPass}
                onChange={(e) => setJoinPass(e.target.value)}
                aria-invalid={!!joinErr.passcode}
                aria-describedby={joinErr.passcode ? 's-join-pass-error' : 's-join-pass-hint'}
              />
            </Field>
          </div>
        )}

        {formError && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" disabled={busy !== null}>
          {mode === 'create' ? (busy === 'create' ? 'Creating…' : 'Create room') : busy === 'join' ? 'Joining…' : 'Join room'}
          <Icon icon={ArrowRight01Icon} />
        </Button>
      </form>
    </div>
  );
}
