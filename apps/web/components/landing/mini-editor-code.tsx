'use client';

import React from 'react';
import { presenceClass } from '@/lib/presence';
import { cn } from '@/lib/utils';

export interface CursorPos {
  who: number;
  name: string;
  color: number;
  line: number;
  col: number;
}

interface MiniEditorCodeProps {
  lines: string[];
  cursors: CursorPos[];
  /** Line highlighted as a peer's selection. */
  selectedLine?: number | null;
  selectionColor?: number;
}

// Tokenize a code line into syntax elements using CSS variables from globals.css
export function highlightLine(text: string): React.ReactNode {
  // If line is empty
  if (!text) return ' ';

  // Match comments first
  if (text.trim().startsWith('//')) {
    return <span className="text-(--syntax-comment)">{text}</span>;
  }

  // Regex splitting by words and delimiters
  const tokenRegex = /(\b(?:interface|function|const|return|export|type|let|var)\b|\b(?:string|boolean|number|void)\b|\b(?:greet|map|log)\b|['"`].*?['"`]|\b\d+\b|=>|[{}()[\];,.:])/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(text)) !== null) {
    const start = match.index;
    const token = match[0];

    // Push text before match
    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    if (/^(interface|function|const|return|export|type|let|var)$/.test(token)) {
      parts.push(
        <span key={start} className="text-(--syntax-keyword) font-medium">
          {token}
        </span>,
      );
    } else if (/^(string|boolean|number|void)$/.test(token)) {
      parts.push(
        <span key={start} className="text-(--syntax-type)">
          {token}
        </span>,
      );
    } else if (/^(greet|map|log)$/.test(token)) {
      parts.push(
        <span key={start} className="text-(--syntax-function)">
          {token}
        </span>,
      );
    } else if (/^['"`]/.test(token)) {
      parts.push(
        <span key={start} className="text-(--syntax-string)">
          {token}
        </span>,
      );
    } else if (/^\d+$/.test(token)) {
      parts.push(
        <span key={start} className="text-(--syntax-number)">
          {token}
        </span>,
      );
    } else if (token === '=>' || /[{}()[\];,.:]/.test(token)) {
      parts.push(
        <span key={start} className="text-muted-foreground/80">
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

export function MiniEditorCode({ lines, cursors, selectedLine = null, selectionColor = 0 }: MiniEditorCodeProps) {
  return (
    <div className="relative overflow-hidden bg-editor px-3 pt-6 pb-4 font-mono text-caption leading-loose">
      {lines.map((text, idx) => (
        <div key={`line-${idx}`} className="relative flex items-baseline">
          <span className="w-6 shrink-0 text-right text-micro text-muted-foreground/50 select-none tabular" aria-hidden>
            {idx + 1}
          </span>
          <div
            className={cn(
              'relative flex-1 rounded-sm pl-3 whitespace-pre text-foreground transition-ui',
              idx === selectedLine && [presenceClass(selectionColor), 'bg-(--p)/15'],
            )}
          >
            {renderLineWithCursors(text, cursors.filter((c) => c.line === idx))}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderLineWithCursors(text: string, cursors: CursorPos[]) {
  if (!cursors.length) {
    return highlightLine(text);
  }

  // Sort cursors by column
  const sorted = [...cursors].sort((a, b) => a.col - b.col);
  const elements: React.ReactNode[] = [];
  let currentPos = 0;

  sorted.forEach((c, i) => {
    const col = Math.min(Math.max(c.col, 0), text.length);

    if (col > currentPos) {
      elements.push(
        <React.Fragment key={`text-${currentPos}-${col}`}>
          {highlightLine(text.slice(currentPos, col))}
        </React.Fragment>,
      );
    }

    elements.push(
      <span
        key={`cursor-${c.who}-${i}`}
        className={cn(
          presenceClass(c.color),
          'relative inline-block h-[1.25em] w-0 border-l-2 border-(--p) align-text-bottom transition-all duration-75',
        )}
      >
        <span
          className="pointer-events-none absolute bottom-full -left-0.5 z-10 rounded-t-md rounded-r-md bg-(--p) px-1.5 py-0.5 font-sans text-micro leading-none font-medium whitespace-nowrap text-presence-ink shadow-sm"
        >
          {c.name}
        </span>
      </span>,
    );

    currentPos = col;
  });

  if (currentPos < text.length) {
    elements.push(
      <React.Fragment key={`text-end-${currentPos}`}>
        {highlightLine(text.slice(currentPos))}
      </React.Fragment>,
    );
  }

  return elements;
}
