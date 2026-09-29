'use client';

import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';
import { useEffect, useState } from 'react';
import { LanguageLogo } from '@/components/icons/language-logo';
import { presenceClass } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';
import { TextMorph } from '@/components/ui/motion';
import { ThinkingOrb } from '@/components/ui/thinking-orb';
import { useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * Looping hero demo: two scripted cursors type and refactor at once, and the badge flips Syncing -> Verified
 * when they go quiet. Pure client state on a timer; reduced motion shows the final frame.
 */
const FINAL = [
  'export function mergeCursors(peers) {',
  '  const live = peers.filter((p) => p.online);',
  '  return live.map((p) => ({ id: p.id, line: p.line }));',
  '}',
];
const START = ['export function merge(peers) {', '  ', '  return peers;', '}'];

type Step = { who: 0 | 1; line: number; text: string };
// Asha renames the function while Ravi writes the filter line (interleaved), then Asha rewrites the return.
const SCRIPT: Step[] = (() => {
  const steps: Step[] = [];
  const rename = 'Cursors';
  const filter = FINAL[1]!;
  for (let i = 1; i <= Math.max(rename.length, filter.length - 2); i++) {
    if (i <= rename.length) steps.push({ who: 0, line: 0, text: `export function merge${rename.slice(0, i)}(peers) {` });
    if (2 + i <= filter.length) steps.push({ who: 1, line: 1, text: filter.slice(0, 2 + i) });
  }
  const ret = FINAL[2]!;
  for (let i = '  return '.length + 1; i < ret.length; i += 2) steps.push({ who: 0, line: 2, text: ret.slice(0, i) });
  steps.push({ who: 0, line: 2, text: ret });
  return steps;
})();

const PEERS = [
  { name: 'Asha', color: 0 },
  { name: 'Ravi', color: 1 },
];

export function MiniEditor() {
  const [step, setStep] = useState(0);
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setStep((s) => (s >= SCRIPT.length + 30 ? 0 : s + 1)), 70);
    return () => clearInterval(id);
  }, [reduce]);

  const at = reduce ? SCRIPT.length : Math.min(step, SCRIPT.length);
  const lines = [...START];
  const cursor: Record<number, { line: number; col: number }> = { 0: { line: 0, col: 0 }, 1: { line: 1, col: 2 } };
  for (let i = 0; i < at; i++) {
    const s = SCRIPT[i]!;
    lines[s.line] = s.text;
    cursor[s.who] = { line: s.line, col: s.text.length };
  }
  const settled = reduce || step >= SCRIPT.length + 8;

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-overlay" aria-label="Animated demo of two people editing" role="img">
      <div className="flex h-10 items-center gap-2 border-b border-border/60 px-3">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-muted" />
          <span className="size-2.5 rounded-full bg-muted" />
          <span className="size-2.5 rounded-full bg-muted" />
        </span>
        <span className="ml-2 inline-flex items-center gap-1.5 font-mono text-caption text-muted-foreground">
          <LanguageLogo language="javascript" size={12} /> cursors.js
        </span>
        <span
          className={cn(
            'ml-auto inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-micro font-medium transition-ui',
            settled ? 'border-success/30 text-success' : 'border-primary/30 text-primary',
          )}
        >
          {settled ? (
            <Icon icon={CheckmarkCircle02Icon} size={12} />
          ) : (
            <ThinkingOrb state="working" tone="primary" size={20} animated label="Syncing" className="-my-1 size-3.5" />
          )}
          <TextMorph>{settled ? 'Verified in sync' : 'Syncing…'}</TextMorph>
        </span>
      </div>
      <pre className="overflow-x-auto bg-editor p-4 font-mono text-caption leading-relaxed sm:text-body">
        {lines.map((text, i) => (
          <div key={i} className="flex">
            <span className="w-8 shrink-0 text-right text-muted-foreground/60 select-none tabular">{i + 1}</span>
            <code className="relative pl-4 whitespace-pre text-foreground">
              {renderLine(text, i, cursor)}
            </code>
          </div>
        ))}
      </pre>
    </div>
  );
}

function renderLine(text: string, line: number, cursor: Record<number, { line: number; col: number }>) {
  const marks = PEERS.map((p, who) => ({ ...p, ...cursor[who]! })).filter((c) => c.line === line).sort((a, b) => a.col - b.col);
  if (!marks.length) return text;
  const out: React.ReactNode[] = [];
  let last = 0;
  marks.forEach((m, i) => {
    out.push(text.slice(last, m.col));
    out.push(
      <span key={i} className={cn(presenceClass(m.color), 'relative inline-block h-[1.2em] w-0 border-l-2 border-(--p) align-text-bottom')}>
        <span className="absolute bottom-full -left-0.5 rounded-t-md rounded-r-md bg-(--p) px-1.5 font-sans text-micro font-medium text-presence-ink">
          {m.name}
        </span>
      </span>,
    );
    last = m.col;
  });
  out.push(text.slice(last));
  return out;
}
