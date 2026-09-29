import C from '@thesvg/react/c';
import Cplusplus from '@thesvg/react/cplusplus';
import Csharp from '@thesvg/react/csharp';
import Css3 from '@thesvg/react/css3';
import Go from '@thesvg/react/go';
import Html5 from '@thesvg/react/html5';
import Java from '@thesvg/react/java';
import Javascript from '@thesvg/react/javascript';
import Markdown from '@thesvg/react/markdown';
import Postgresql from '@thesvg/react/postgresql';
import Python from '@thesvg/react/python';
import Rust from '@thesvg/react/rust';
import Typescript from '@thesvg/react/typescript';
import type { ComponentType } from 'react';
import { languageInfo, type LanguageId } from '@/lib/languages';
import { cn } from '@/lib/utils';

// theSVG brand marks (ADR-016). Brand colors live inside the SVG data, which is the one sanctioned exception to tokens.
const LOGOS: Record<LanguageId, ComponentType<any>> = {
  javascript: Javascript,
  typescript: Typescript,
  html: Html5,
  css: Css3,
  python: Python,
  go: Go,
  rust: Rust,
  c: C,
  cpp: Cplusplus,
  csharp: Csharp,
  java: Java,
  markdown: Markdown,
  sql: Postgresql,
};

/** Rust and Markdown marks are black. Mono keeps them visible on dark themes. */
const MONO: ReadonlySet<LanguageId> = new Set(['rust', 'markdown']);

export function LanguageLogo({ language, size = 14, className }: { language: string; size?: number; className?: string }) {
  const info = languageInfo(language);
  const Logo = LOGOS[info.id];
  return (
    <Logo
      width={size}
      height={size}
      aria-hidden
      variant={MONO.has(info.id) ? 'mono' : 'default'}
      className={cn('shrink-0', MONO.has(info.id) && 'text-foreground', className)}
    />
  );
}
