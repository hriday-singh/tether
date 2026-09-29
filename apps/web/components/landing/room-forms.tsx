'use client';

import { ArrowRight01Icon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Field, Input } from '@/components/ui/input';
import { Select, SelectItem } from '@/components/ui/menus';
import { seedKey } from '@/components/workspace/room-screen';
import { api, ApiError, CreateRoomInputSchema, DisplayNameSchema, RoomIdSchema } from '@/lib/api';
import { useMounted } from '@/lib/hooks';
import { LANGUAGE_IDS, LANGUAGES, type LanguageId } from '@/lib/languages';
import { sessions } from '@/lib/session';

type Errors = Partial<Record<'name' | 'roomId' | 'passcode' | 'form', string>>;

function fieldErrors(issues: readonly { path: PropertyKey[]; message: string }[]): Errors {
  const out: Errors = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? 'form') as keyof Errors;
    out[key] ??= i.message;
  }
  return out;
}

export function CreateRoomCard() {
  const router = useRouter();
  const params = useSearchParams();
  const mounted = useMounted();
  const [name, setName] = useState('');
  const [roomId, setRoomId] = useState(params.get('room') ?? '');
  const [passcode, setPasscode] = useState('');
  const [language, setLanguage] = useState<LanguageId>('html');
  const [errors, setErrors] = useState<Errors>({});
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per intended room, so a double submit or a retry after a timeout never makes two rooms.
  const idempotencyKey = useRef<string | null>(null);

  const submit = async (e: FormEvent, override?: string) => {
    e.preventDefault();
    const input = {
      name: name || (mounted ? sessions.lastName() : ''),
      roomId: (override ?? roomId).trim() || undefined,
      passcode: passcode || undefined,
      language,
    };
    const parsed = CreateRoomInputSchema.safeParse(input);
    if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
    setErrors({});
    setSuggestion(null);
    setBusy(true);
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const res = await api.createRoom(parsed.data, idempotencyKey.current);
      sessions.set(res.room.id, { token: res.token, memberId: res.memberId, name: parsed.data.name, epoch: res.room.epoch });
      sessionStorage.setItem(seedKey(res.room.id), '1');
      router.push(`/r/${res.room.id}`);
    } catch (err) {
      idempotencyKey.current = null;
      if (err instanceof ApiError && err.code === 'room_taken') {
        setErrors({ roomId: err.message });
        setSuggestion(typeof err.details.suggestion === 'string' ? err.details.suggestion : null);
      } else {
        setErrors({ form: err instanceof ApiError ? err.message : 'Could not create the room. Try again.' });
      }
      setBusy(false);
    }
  };

  return (
    <form id="create" onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6" aria-busy={busy} noValidate>
      <div>
        <h2 className="text-title font-semibold">Create a room</h2>
        <p className="text-caption text-muted-foreground">You become the host. Share the link, not the passcode.</p>
      </div>
      <Field id="c-name" label="Display name" error={errors.name}>
        <Input id="c-name" autoComplete="nickname" maxLength={50} value={name} placeholder={mounted ? sessions.lastName() || 'Asha' : 'Asha'} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="c-lang" label="Language">
          <Select id="c-lang" value={language} onValueChange={(v) => setLanguage(v as LanguageId)} aria-label="Language">
            {LANGUAGE_IDS.map((id) => (
              <SelectItem key={id} value={id}>
                <LanguageLogo language={id} /> {LANGUAGES[id].label}
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field id="c-room" label="Room ID (optional)" error={errors.roomId} hint="Blank picks one for you">
          <Input id="c-room" value={roomId} placeholder="team-standup" onChange={(e) => setRoomId(e.target.value.toLowerCase())} className="font-mono" aria-invalid={!!errors.roomId} />
        </Field>
      </div>
      {suggestion && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={(e) => {
            setRoomId(suggestion);
            void submit(e as unknown as FormEvent, suggestion);
          }}
        >
          Use <span className="font-mono">{suggestion}</span> instead
        </Button>
      )}
      <Field id="c-pass" label="Passcode (optional)" error={errors.passcode}>
        <Input id="c-pass" type="password" autoComplete="new-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} aria-invalid={!!errors.passcode} />
      </Field>
      {errors.form && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
          {errors.form}
        </p>
      )}
      <Button type="submit" size="lg" disabled={busy}>
        <Icon icon={PlusSignIcon} /> {busy ? 'Creating…' : 'Create Room'}
      </Button>
    </form>
  );
}

export function JoinRoomCard() {
  const router = useRouter();
  const mounted = useMounted();
  const [roomId, setRoomId] = useState('');
  const [name, setName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const id = RoomIdSchema.safeParse(roomId);
    const nm = DisplayNameSchema.safeParse(name || (mounted ? sessions.lastName() : ''));
    const next: Errors = {};
    if (!id.success) next.roomId = id.error.issues[0]?.message;
    if (!nm.success) next.name = nm.error.issues[0]?.message;
    if (!id.success || !nm.success) return setErrors(next);
    setErrors({});
    setBusy(true);
    try {
      // Already a member on this device? Go straight in.
      const existing = sessions.get(id.data);
      if (!existing) {
        const res = await api.joinRoom(id.data, { name: nm.data, passcode: passcode || undefined });
        sessions.set(id.data, { token: res.token, memberId: res.memberId, name: nm.data, epoch: res.room.epoch });
      }
      router.push(`/r/${id.data}`);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : null;
      setErrors(
        code === 'bad_passcode'
          ? { passcode: passcode ? (err as ApiError).message : 'This room needs a passcode' }
          : code === 'not_found'
            ? { roomId: (err as ApiError).message }
            : { form: err instanceof ApiError ? err.message : 'Could not join. Try again.' },
      );
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6" aria-busy={busy} noValidate>
      <div>
        <h2 className="text-title font-semibold">Join by ID</h2>
        <p className="text-caption text-muted-foreground">Have an invite link? Just open it.</p>
      </div>
      <Field id="j-room" label="Room ID" error={errors.roomId}>
        <Input id="j-room" value={roomId} placeholder="team-standup" onChange={(e) => setRoomId(e.target.value.toLowerCase())} className="font-mono" aria-invalid={!!errors.roomId} />
      </Field>
      <Field id="j-name" label="Display name" error={errors.name}>
        <Input id="j-name" autoComplete="nickname" maxLength={50} value={name} placeholder={mounted ? sessions.lastName() || 'Ravi' : 'Ravi'} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
      </Field>
      <Field id="j-pass" label="Passcode (if the room has one)" error={errors.passcode}>
        <Input id="j-pass" type="password" autoComplete="current-password" value={passcode} onChange={(e) => setPasscode(e.target.value)} aria-invalid={!!errors.passcode} />
      </Field>
      {errors.form && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
          {errors.form}
        </p>
      )}
      <Button type="submit" size="lg" variant="secondary" disabled={busy}>
        {busy ? 'Joining…' : 'Enter Room'} <Icon icon={ArrowRight01Icon} />
      </Button>
    </form>
  );
}
