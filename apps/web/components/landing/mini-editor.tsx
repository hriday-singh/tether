'use client';

import { CheckmarkCircle02Icon, PlayIcon } from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { TextMorph } from '@/components/ui/motion';
import { ThinkingOrb } from '@/components/ui/thinking-orb';
import { useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { CursorPos, MiniEditorCode, highlightLine } from './mini-editor-code';

const START_LINES = ["const team = ['Asha', 'Ravi'];", '', 'function greet(name: string) {', '  ', '}', '', ''];
const ASHA = { line: 3, prefix: '  ', text: 'return `Welcome, ${name}!`;' };
const RAVI = { line: 6, prefix: '', text: 'console.log(team.map(greet));' };
const OUTPUT = "['Welcome, Asha!', 'Welcome, Ravi!']";

// Story beats, in ticks of TICK_MS. One loop is roughly 13 seconds.
const TICK_MS = 70;
const RAVI_START = 12;
const SYNCED_AT = 64;
const SELECT_AT = 72;
const COMMENT_AT = 84;
const RUN_AT = 104;
const OUTPUT_AT = 112;
const LOOP_AT = 190;

/** Characters typed after `ticks`, pausing a little on spaces so it reads like a person. */
function typed(text: string, ticks: number): number {
  let n = 0;
  for (let t = ticks; n < text.length && t > 0; n++) t -= text[n] === ' ' ? 3 : 1;
  return n;
}

export type DemoFrame = {
  lines: string[];
  cursors: CursorPos[];
  selectedLine: number | null;
  synced: boolean;
  commented: boolean;
  running: boolean;
  output: boolean;
};

/** Pure: everything the demo shows at a given tick. */
export function demoFrame(tick: number): DemoFrame {
  const a = ASHA.prefix + ASHA.text.slice(0, typed(ASHA.text, tick));
  const r = RAVI.prefix + RAVI.text.slice(0, typed(RAVI.text, tick - RAVI_START));
  const lines = [...START_LINES];
  lines[ASHA.line] = a;
  lines[RAVI.line] = r;
  const selecting = tick >= SELECT_AT;
  return {
    lines,
    cursors: [
      { who: 0, name: 'Asha', color: 0, line: ASHA.line, col: a.length },
      // Ravi selects Asha's line to comment on it, so his cursor jumps to its start.
      selecting
        ? { who: 1, name: 'Ravi', color: 1, line: ASHA.line, col: ASHA.prefix.length }
        : { who: 1, name: 'Ravi', color: 1, line: RAVI.line, col: r.length },
    ],
    selectedLine: selecting ? ASHA.line : null,
    synced: tick >= SYNCED_AT,
    commented: tick >= COMMENT_AT,
    running: tick >= RUN_AT && tick < OUTPUT_AT,
    output: tick >= OUTPUT_AT,
  };
}

export function MiniEditor() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  const [isVisible, setIsVisible] = useState(true);
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry?.isIntersecting ?? false), { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (reduce || !isVisible) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => (t >= LOOP_AT ? 0 : t + 1));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [reduce, isVisible]);

  // ponytail: reduced motion shows the finished story; Run replays nothing there because nothing animates.
  const f = demoFrame(reduce ? LOOP_AT : tick);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Tether demo: two people editing, commenting and running code together"
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-overlay"
    >
      <header className="flex h-11 items-center gap-2 border-b border-border/60 bg-muted/30 px-3">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-card px-2 font-mono text-caption font-medium text-foreground shadow-xs">
          <LanguageLogo language="typescript" size={13} />
          greet.ts
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center -space-x-1.5 sm:flex" aria-label="Asha and Ravi are in the room">
            <Avatar name="Asha" colorIndex={0} size="sm" />
            <Avatar name="Ravi" colorIndex={1} size="sm" />
          </div>
          <span
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-micro font-medium transition-ui',
              f.synced ? 'border-success/30 text-success' : 'border-primary/30 text-primary',
            )}
          >
            {f.synced ? (
              <Icon icon={CheckmarkCircle02Icon} size={12} />
            ) : (
              <ThinkingOrb state="working" tone="primary" size={20} animated label="Syncing" className="-my-1 size-3.5" />
            )}
            <TextMorph>{f.synced ? 'In sync' : 'Syncing…'}</TextMorph>
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setTick(RUN_AT)}
            className={cn('h-7 gap-1 px-2.5 text-micro font-medium', f.running && 'ring-2 ring-primary/40')}
          >
            <Icon icon={PlayIcon} size={12} className="text-primary" />
            <TextMorph>{f.running ? 'Running…' : 'Run'}</TextMorph>
          </Button>
        </div>
      </header>

      <div className="grid sm:grid-cols-[minmax(0,1fr)_12rem]">
        <MiniEditorCode lines={f.lines} cursors={f.cursors} selectedLine={f.selectedLine} selectionColor={1} />

        <aside aria-label="Room chat" className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 p-3 sm:border-t-0 sm:border-l">
          <span className="text-micro font-medium text-muted-foreground">Chat</span>
          <ChatMessage name="Asha" color={0} text="Adding a greeting for the team." />
          {f.commented && (
            <ChatMessage name="Ravi" color={1} quote={{ label: `L${ASHA.line + 1}`, code: ASHA.text }} text="Nice. Run it?" />
          )}
        </aside>
      </div>

      <section aria-label="Console" className="border-t border-border/60 bg-muted/30 font-mono text-caption">
        <div className="flex h-8 items-center justify-between px-3 text-micro text-muted-foreground">
          <span className="font-sans font-medium">Console</span>
          <span className="font-sans">Runs in your browser</span>
        </div>
        <div className="flex h-9 items-center gap-2 overflow-hidden px-3 whitespace-pre">
          <span aria-hidden className="text-muted-foreground/60">›</span>
          {f.output ? (
            <span className="animate-fade-in">{highlightLine(OUTPUT)}</span>
          ) : (
            <span className="text-muted-foreground">{f.running ? 'Running greet.ts…' : 'Press Run to see the output'}</span>
          )}
        </div>
      </section>
    </div>
  );
}

function ChatMessage({ name, color, text, quote }: { name: string; color: number; text: string; quote?: { label: string; code: string } }) {
  return (
    <div className="flex animate-fade-in gap-2">
      <Avatar name={name} colorIndex={color} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-micro font-medium text-foreground">{name}</span>
        {quote && (
          <span className="block overflow-hidden rounded-lg border border-border/60 bg-card/80">
            <span className="block border-b border-border/60 px-2 py-0.5 font-mono text-micro text-primary">{quote.label}</span>
            <span className="block truncate px-2 py-1 font-mono text-micro text-muted-foreground">{quote.code}</span>
          </span>
        )}
        <p className="text-caption text-foreground/90">{text}</p>
      </div>
    </div>
  );
}
