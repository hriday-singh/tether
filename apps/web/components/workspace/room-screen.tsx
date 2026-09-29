'use client';

import { LockKeyIcon, UserGroupIcon } from '@hugeicons/core-free-icons';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { Logo } from '@/components/brand';
import { usePrefs } from '@/components/providers';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Field, Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { ThinkingOrb } from '@/components/ui/thinking-orb';
import { api, ApiError, DisplayNameSchema, type RoomInfo } from '@/lib/api';
import { useMounted, useStore, useViewportGate } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { sessions, type RoomSession } from '@/lib/session';
import { createSyncClient, type SyncClient } from '@/lib/sync';
import { CenterCard, RoomNotFound, ScreenTooSmallGate } from './gates';
import { Workspace } from './workspace';

export const seedKey = (roomId: string) => `tether:seed:${roomId}`;

export function RoomScreen({ roomId }: { roomId: string }) {
  const mounted = useMounted();
  if (!mounted) return <div className="min-h-dvh bg-background" />;
  return <RoomScreenClient roomId={roomId} />;
}

function RoomScreenClient({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<RoomSession | null>(() => sessions.get(roomId));
  const [prefillName, setPrefillName] = useState<string>(() => sessions.get(roomId)?.name ?? sessions.lastName());
  const info = useQuery({ queryKey: ['room', roomId], queryFn: () => api.getRoom(roomId), retry: (n, e) => !(e instanceof ApiError) && n < 2 });

  if (info.error instanceof ApiError && info.error.code === 'not_found') return <RoomNotFound roomId={roomId} />;
  if (!session) {
    return (
      <JoinGate
        roomId={roomId}
        info={info.data}
        loading={info.isPending}
        defaultName={prefillName}
        onJoined={(s) => {
          sessions.set(roomId, s);
          setSession(s);
        }}
      />
    );
  }
  return (
    <ConnectedRoom
      key={session.token}
      roomId={roomId}
      session={session}
      onReauth={() => {
        // Token rejected: drop it, keep the name and the local IndexedDB copy, and ask to join again.
        sessions.clear(roomId);
        setPrefillName(session.name);
        setSession(null);
      }}
    />
  );
}

function ConnectedRoom({ roomId, session, onReauth }: { roomId: string; session: RoomSession; onReauth: () => void }) {
  const wide = useViewportGate({ minWidth: 1024 });
  const { prefs } = usePrefs();
  const [client, setClient] = useState<SyncClient | null>(null);

  useEffect(() => {
    let c: SyncClient;
    try {
      // The seed flag is cleared only once the template is actually inserted (StrictMode mounts twice).
      const seed = sessionStorage.getItem(seedKey(roomId)) === '1';
      c = createSyncClient({
        roomId,
        memberId: session.memberId,
        token: session.token,
        epoch: session.epoch,
        seed,
        onSeeded: () => sessionStorage.removeItem(seedKey(roomId)),
        latencyMs: prefs.simulatedLatencyMs,
      });
    } catch {
      onReauth();
      return;
    }
    // Small screens never connect: no room slot, no presence noise.
    if (!window.matchMedia('(min-width: 1024px)').matches) c.pause();
    void c.start();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the client is an external resource created here
    setClient(c);
    return () => c.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session]);

  useEffect(() => {
    if (!client || wide === null) return;
    if (wide) client.resume();
    else client.pause();
  }, [client, wide]);

  if (wide === false) return <ScreenTooSmallGate />;
  if (!client || wide === null) return <div className="min-h-dvh bg-background" />;
  return (
    <>
      <ReauthWatcher client={client} onReauth={onReauth} />
      <Workspace client={client} roomId={roomId} session={session} />
    </>
  );
}

function ReauthWatcher({ client, onReauth }: { client: SyncClient; onReauth: () => void }) {
  const connection = useStore(client.status).connection;
  useEffect(() => {
    if (connection === 'reauth') onReauth();
  }, [connection, onReauth]);
  return null;
}

// ------------------------------------------------------------------ Join gate

function JoinGate({
  roomId,
  info,
  loading,
  defaultName,
  onJoined,
}: {
  roomId: string;
  info: RoomInfo | undefined;
  loading: boolean;
  defaultName: string;
  onJoined: (s: RoomSession) => void;
}) {
  const { prefs } = usePrefs();
  const [name, setName] = useState(defaultName);
  const [passcode, setPasscode] = useState('');
  const [otpMode, setOtpMode] = useState(true);
  const [error, setError] = useState<{ field: 'name' | 'passcode' | 'form'; message: string } | null>(null);
  const [joining, setJoining] = useState(false);

  if (info?.locked) {
    return (
      <CenterCard icon={LockKeyIcon} title="This room is locked">
        The host has locked this room. Please request access from the host.
      </CenterCard>
    );
  }

  const submit = async () => {
    const parsed = DisplayNameSchema.safeParse(name);
    if (!parsed.success) return setError({ field: 'name', message: parsed.error.issues[0]?.message ?? 'Invalid name' });
    if (info?.hasPasscode && !passcode) return setError({ field: 'passcode', message: 'This room needs a passcode' });
    setError(null);
    setJoining(true);
    try {
      const res = await api.joinRoom(roomId, { name: parsed.data, passcode: passcode || undefined });
      onJoined({ token: res.token, memberId: res.memberId, name: parsed.data, epoch: res.room.epoch });
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setError({ field: err?.code === 'bad_passcode' ? 'passcode' : 'form', message: err?.message ?? 'Could not join. Check your connection and try again.' });
      setJoining(false);
    }
  };

  const lang = languageInfo(info?.language ?? 'javascript');
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card"
        aria-busy={joining}
      >
        <div className="flex items-center justify-between">
          <Logo className="size-7" />
          {info ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-caption">
              <LanguageLogo language={lang.id} /> {lang.label}
            </span>
          ) : (
            <Skeleton className="h-6 w-24 rounded-full" />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-display font-semibold tracking-tight">
            Join <span className="font-mono">{roomId}</span>
          </h1>
          <p className="flex items-center gap-1.5 text-body text-muted-foreground">
            <Icon icon={UserGroupIcon} size={14} />
            {loading ? 'Checking the room…' : `${info?.memberCount ?? 0} ${info?.memberCount === 1 ? 'developer' : 'developers'} in this room`}
          </p>
        </div>
        <Field id="join-name" label="Display name" error={error?.field === 'name' ? error.message : null}>
          <Input
            id="join-name"
            autoFocus
            autoComplete="nickname"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error?.field === 'name'}
            aria-describedby={error?.field === 'name' ? 'join-name-error' : undefined}
          />
        </Field>
        {info?.hasPasscode && (
          <Field
            id="join-pass"
            label="Passcode"
            error={error?.field === 'passcode' ? error.message : null}
            hint={otpMode ? 'Entering PIN' : undefined}
          >
            {otpMode ? (
              <div className="flex flex-col items-center gap-2 py-1">
                <InputOTP
                  maxLength={6}
                  value={passcode}
                  onChange={setPasscode}
                  aria-invalid={error?.field === 'passcode'}
                  aria-describedby={error?.field === 'passcode' ? 'join-pass-error' : undefined}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
                <button
                  type="button"
                  onClick={() => setOtpMode(false)}
                  className="text-micro text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Use password field
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Input
                  id="join-pass"
                  type="password"
                  autoComplete="current-password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  aria-invalid={error?.field === 'passcode'}
                  aria-describedby={error?.field === 'passcode' ? 'join-pass-error' : undefined}
                />
                <button
                  type="button"
                  onClick={() => setOtpMode(true)}
                  className="self-end text-micro text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  Use PIN slots
                </button>
              </div>
            )}
          </Field>
        )}
        {error?.field === 'form' && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-caption text-destructive">
            {error.message}
          </p>
        )}
        <Button type="submit" size="lg" disabled={joining || loading}>
          {joining ? (
            <>
              <ThinkingOrb state="connecting" size={20} animated={prefs.ambientAnimations} label="Joining" className="size-4" />
              Joining…
            </>
          ) : (
            'Join Room'
          )}
        </Button>
      </form>
    </main>
  );
}
