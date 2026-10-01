import { GithubIcon } from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { Suspense } from 'react';
import { Logo } from '@/components/brand';
import { MiniEditor } from '@/components/landing/mini-editor';
import { SmoothScroll } from '@/components/landing/smooth-scroll';
import { NavStartButton, StartPanel } from '@/components/landing/start-panel';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? 'https://github.com/hriday-singh/tether';

// ponytail: benchmark strip (p95 ack, chaos seeds) removed until M10 produces measured numbers.
const GUARANTEES = [
  {
    title: 'Nothing typed is lost',
    body: 'Every edit merges through a CRDT. Offline changes stay on your device and sync when you reconnect.',
  },
  {
    title: 'Checksum-verified',
    body: 'Clients compare SHA-256 checksums with the server. "In sync" only shows when every replica matches.',
  },
  {
    title: 'Live telemetry',
    body: 'Round-trip and ack latency are measured continuously and shown in the status bar.',
  },
  {
    title: 'Chaos tested in CI',
    body: 'Chaos runs with jitter, dropped packets, and network partitions run on every change.',
  },
];

export default function LandingPage() {
  return (
    <>
      <SmoothScroll />
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-md">
        <nav className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6" aria-label="Main">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo className="size-8" /> Tether
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <NavStartButton />
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
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1fr_1.25fr] lg:pt-28 lg:pb-28">
          <div className="flex flex-col gap-6">
            <h1 className="text-hero font-semibold tracking-tight text-balance">Code together. Stay in sync.</h1>
            <p className="max-w-lg text-title leading-relaxed text-muted-foreground text-pretty">
              Open a room, share the link, and write code in real time with zero accounts. Every replica is cryptographically verified to match.
            </p>
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button size="lg" asChild>
                <a href="#start">Create a room</a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how">How it works</a>
              </Button>
            </div>
          </div>
          <MiniEditor />
        </section>

        <section id="start" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:py-28">
            <div className="flex flex-col gap-5 lg:sticky lg:top-28">
              <h2 className="max-w-md text-headline font-semibold tracking-tight text-balance">Your room is one click away.</h2>
              <p className="max-w-md text-title leading-relaxed text-muted-foreground text-pretty">
                No accounts and nothing to install. Create a room and you are the host. Share the link, and anyone can join from their
                browser.
              </p>
            </div>
            <Suspense>
              <StartPanel />
            </Suspense>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-t border-border">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
            <h2 className="mb-12 text-headline font-semibold tracking-tight text-balance">How it stays in sync</h2>
            <ul className="grid border-t border-border sm:grid-cols-2">
              {GUARANTEES.map((g) => (
                <li key={g.title} className="flex flex-col gap-2 border-b border-border py-8 sm:odd:pr-10 sm:even:border-l sm:even:pl-10">
                  <h3 className="text-title font-semibold text-foreground">{g.title}</h3>
                  <p className="text-body leading-relaxed text-muted-foreground">{g.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-caption text-muted-foreground sm:px-6">
          <span className="flex items-center gap-2 text-foreground">
            <Logo className="size-5" /> Tether
          </span>
          <a href={REPO_URL} target="_blank" rel="noreferrer" className="transition-ui hover:text-foreground">
            Repository
          </a>
          <a href={`${REPO_URL}#system-architecture`} target="_blank" rel="noreferrer" className="transition-ui hover:text-foreground">
            Architecture
          </a>
          <span className="font-mono sm:ml-auto">Yjs · CodeMirror 6 · Next.js</span>
        </div>
      </footer>
    </>
  );
}
