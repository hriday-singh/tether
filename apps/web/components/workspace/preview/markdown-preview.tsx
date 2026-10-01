'use client';

import { marked } from 'marked';
import { useMemo } from 'react';
import DOMPurify from 'dompurify';
import { cn } from '@/lib/utils';

// Configure marked with GFM (tables, task lists, line breaks)
marked.setOptions({
  gfm: true,
  breaks: true,
});

export interface MarkdownPreviewProps {
  content: string;
  className?: string;
  zoom?: number;
}

/**
 * Live Markdown preview pane.
 * Compiles GitHub Flavored Markdown (tables, checklists, code blocks) to clean HTML
 * styled exclusively with Tether design system tokens. All scripts and inline handlers are stripped.
 */
export function MarkdownPreview({ content, className, zoom = 1 }: MarkdownPreviewProps) {
  const html = useMemo(() => {
    const trimmed = content.trim();
    if (!trimmed) return '';

    try {
      const rawHtml = marked.parse(content) as string;
      // Peer-authored HTML rendered in our own origin: needs a real sanitizer, not regexes
      // (entity-encoded javascript: URLs, `<img/onerror>` and SVG links all slip past those).
      return DOMPurify.sanitize(rawHtml);
    } catch {
      return '<p class="text-destructive">Failed to parse Markdown.</p>';
    }
  }, [content]);

  if (!content.trim()) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-caption text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">Markdown Preview</p>
          <p className="mt-1">Headings, tables, checklists, and code blocks update live as you type.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('relative h-full min-h-0 flex-1 overflow-y-auto bg-background', className)}>
      <div
        className="min-h-full p-6 md:p-8"
        style={{
          zoom: zoom !== 1 ? zoom : undefined,
        }}
      >
        <article
          aria-label="Rendered Markdown Preview"
          className="tether-prose max-w-3xl mx-auto"
          style={{
            maxWidth: zoom < 1 ? `${Math.round(48 / zoom)}rem` : undefined,
          }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
