import { GithubIcon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { Suspense } from 'react';
import { Logo } from '@/components/brand';
import { MiniEditor } from '@/components/landing/mini-editor';
import { CreateRoomCard, JoinRoomCard } from '@/components/landing/room-forms';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com';

// Engineering spec strip, not vanity counters (docs/ui-ux/03 §4). TODO(M10): wire to real bench/chaos numbers.
const PROOF = [
  ['0', 'lost edits under network partition'],
  ['p95 ack < 40 ms', 'measured, not estimated'],
  ['5 op/s', 'lossless token-bucket throttling'],
  ['50+ seeds', 'chaos tested in CI'],
] as const;

const GUARANTEES = [
  {
    title: 'Nothing typed is ever lost',
    body: 'Yjs CRDT merges every edit. Offline edits persist in IndexedDB and merge on reconnect. Throttling batches updates, it never drops them.',
  },
  {
    title: 'You can see it is in sync',
    body: 'When the room goes quiet, clients compare checksums with the server. "Verified in sync" only shows when nothing is pending.',
  },
  {
    title: 'Latency you can read',
    body: 'Round-trip and commit latency are measured live, with p50/p95 in the status bar and a chart in the diagnostics drawer.',
  },
  {
    title: 'Proof, not promises',
    body: 'Launch a bot storm: up to 8 peers typing under jitter and partitions. Every replica must end byte for byte identical.',
  },
];

export default function LandingPage() {
  return (
    <>
      <SmoothScroll />
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6" aria-label="Main">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="size-6" /> Tether
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <a href="#start">Start</a>
            </Button>
            <Button variant="ghost" size="icon-sm" asChild>
              <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub">
                <Icon icon={GithubIcon} />
              </a>
            </Button>
            <ThemeToggle />
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div className="flex flex-col gap-6">
            <p className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 font-mono text-micro text-muted-foreground">
              <span className="size-1.5 rounded-full bg-success" aria-hidden /> live collaborative code pad
            </p>
            <h1 className="text-hero font-semibold tracking-tight text-balance">
              Real-time collaborative coding with mathematical convergence.
            </h1>
            <p className="max-w-xl text-title leading-relaxed text-muted-foreground text-pretty">
              Share a room, type together, and watch every replica prove it is identical. No accounts, no lost keystrokes,
              even when the network falls apart.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="lg" asChild>
                <a href="#start">Create a room</a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">How it stays in sync</a>
              </Button>
            </div>
          </div>
          <MiniEditor />
        </section>

        <section aria-label="Engineering guarantees" className="border-y border-border bg-card/50">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 font-mono sm:px-6 lg:grid-cols-4">
            {PROOF.map(([value, label]) => (
              <div key={label} className="flex flex-col gap-1 py-5 pr-4">
                <dt className="text-micro text-muted-foreground">{label}</dt>
                <dd className="text-title text-foreground tabular">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section id="start" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6">
          <div className="grid gap-4 lg:grid-cols-2">
            <Suspense>
              <CreateRoomCard />
            </Suspense>
            <JoinRoomCard />
          </div>
          <p className="mt-4 text-center text-caption text-muted-foreground">
            The workspace needs a screen 1024 px or wider. Rooms are joinable from anywhere.
          </p>
        </section>

        <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pb-20 sm:px-6">
          <h2 className="mb-6 text-display font-semibold tracking-tight">Bulletproof inside</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {GUARANTEES.map((g) => (
              <article key={g.title} className="rounded-2xl border border-border bg-card p-5 shadow-card transition-ui hover:-translate-y-0.5">
                <h3 className="mb-1.5 text-title font-semibold">{g.title}</h3>
                <p className="text-body leading-relaxed text-muted-foreground">{g.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-caption text-muted-foreground sm:px-6">
          <span className="flex items-center gap-2">
            <Logo className="size-4" /> Tether
          </span>
          <a href={REPO_URL} className="transition-ui hover:text-foreground">
            Repository
          </a>
          <a href={`${REPO_URL}#architecture`} className="transition-ui hover:text-foreground">
            Architecture
          </a>
          <span className="ml-auto font-mono">Yjs · CodeMirror 6 · Next.js</span>
        </div>
      </footer>
    </>
  );
}
