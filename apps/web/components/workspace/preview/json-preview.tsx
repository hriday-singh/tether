'use client';

import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import { useMemo, useState } from 'react';
import { Badge, Tip } from '@/components/ui/controls';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MorphIcon } from '@/components/ui/motion';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';

export interface JsonPreviewProps {
  content: string;
  className?: string;
  zoom?: number;
}

export function JsonPreview({ content, className, zoom = 1 }: JsonPreviewProps) {
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [expandAllKey, setExpandAllKey] = useState<number>(0);
  const [forceExpand, setForceExpand] = useState<boolean | null>(null);

  const parsed = useMemo(() => {
    const trimmed = content.trim();
    if (!trimmed) return { data: null, error: null, isEmpty: true };
    try {
      return { data: JSON.parse(content), error: null, isEmpty: false };
    } catch (err) {
      return {
        data: null,
        error: err instanceof Error ? err.message : String(err),
        isEmpty: false,
      };
    }
  }, [content]);

  const handleCopy = async () => {
    if (parsed.data === null) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(parsed.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Formatted JSON copied to clipboard');
    } catch {
      toast.error('Failed to copy JSON');
    }
  };

  const handleExpandAll = () => {
    setForceExpand(true);
    setExpandAllKey((k) => k + 1);
  };

  const handleCollapseAll = () => {
    setForceExpand(false);
    setExpandAllKey((k) => k + 1);
  };

  if (parsed.isEmpty) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-caption text-muted-foreground">
        <div>
          <p className="font-medium text-foreground">JSON Tree Viewer</p>
          <p className="mt-1">Enter valid JSON in the editor to explore keys, arrays, and values.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn('flex h-full min-h-0 flex-1 flex-col bg-background font-mono text-caption', className)}
      style={{
        transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        transformOrigin: 'top left',
        width: zoom !== 1 ? `${100 / zoom}%` : '100%',
      }}
    >
      {/* Sub-toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 bg-card/40 px-3 py-1.5 text-micro">
        <div className="relative flex flex-1 max-w-64 items-center">
          <Icon icon={Search01Icon} size={12} className="absolute left-2 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search keys or values..."
            aria-label="Filter JSON keys and values"
            className="h-6 w-full rounded-md border border-border bg-background pl-6 pr-2 text-micro outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={handleExpandAll} className="h-6 text-micro">
            Expand all
          </Button>
          <Button size="xs" variant="ghost" onClick={handleCollapseAll} className="h-6 text-micro">
            Collapse all
          </Button>
          <Tip label="Copy JSON">
            <Button size="icon-xs" variant="ghost" onClick={() => void handleCopy()} aria-label="Copy formatted JSON">
              <MorphIcon icon={copied ? CheckmarkCircle02Icon : Copy01Icon} size={13} className={copied ? 'text-success' : undefined} />
            </Button>
          </Tip>
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {parsed.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-caption text-foreground">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <Icon icon={CancelCircleIcon} size={16} />
              <span>Invalid JSON Syntax</span>
            </div>
            <p className="mt-2 text-micro text-muted-foreground">{parsed.error}</p>
            <p className="mt-2 text-micro text-muted-foreground/80">
              Check for trailing commas, unquoted keys, or missing closing brackets in the editor.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            <JsonNode
              key={expandAllKey}
              name={Array.isArray(parsed.data) ? '[root]' : '{root}'}
              value={parsed.data}
              depth={0}
              filter={filter}
              forceExpand={forceExpand}
              isRoot
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface JsonNodeProps {
  name?: string | number;
  value: unknown;
  depth: number;
  filter: string;
  forceExpand: boolean | null;
  isRoot?: boolean;
}

function JsonNode({ name, value, depth, filter, forceExpand, isRoot = false }: JsonNodeProps) {
  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const [expanded, setExpanded] = useState<boolean>(() => {
    if (forceExpand !== null) return forceExpand;
    return depth < 2; // Auto-expand first 2 levels by default
  });

  const filterLower = filter.toLowerCase().trim();

  // Child keys or array elements
  const entries = useMemo(() => {
    if (!isObject || value === null) return [];
    if (isArray) {
      return (value as unknown[]).map((v, i) => [i, v] as const);
    }
    return Object.entries(value as Record<string, unknown>);
  }, [isObject, isArray, value]);

  // Determine if this node or any descendants match filter
  const matchesFilter = useMemo(() => {
    if (!filterLower) return true;
    if (name !== undefined && String(name).toLowerCase().includes(filterLower)) return true;
    if (!isObject) return String(value).toLowerCase().includes(filterLower);

    // Recursively check children
    const checkSub = (v: unknown): boolean => {
      if (v === null || typeof v !== 'object') {
        return String(v).toLowerCase().includes(filterLower);
      }
      if (Array.isArray(v)) {
        return v.some(checkSub);
      }
      return Object.entries(v as Record<string, unknown>).some(
        ([k, subVal]) => k.toLowerCase().includes(filterLower) || checkSub(subVal),
      );
    };

    return checkSub(value);
  }, [filterLower, name, isObject, value]);

  if (!matchesFilter) return null;

  if (!isObject) {
    return (
      <div className="flex items-baseline gap-1.5 py-0.5 leading-relaxed hover:bg-muted/30 rounded px-1 -mx-1">
        {name !== undefined && !isRoot && (
          <span className="text-syntax-attr font-medium">{name}:</span>
        )}
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const count = entries.length;
  const countLabel = isArray ? `${count} ${count === 1 ? 'item' : 'items'}` : `${count} ${count === 1 ? 'key' : 'keys'}`;

  return (
    <div className="py-0.5">
      <div
        onClick={() => setExpanded((prev) => !prev)}
        className="flex cursor-pointer items-baseline gap-1.5 hover:bg-muted/30 rounded px-1 -mx-1 select-none"
      >
        <span className="text-muted-foreground hover:text-foreground">
          <Icon icon={expanded ? ArrowDown01Icon : ArrowRight01Icon} size={12} className="inline align-middle" />
        </span>
        {name !== undefined && !isRoot && (
          <span className="text-syntax-attr font-medium">{name}:</span>
        )}
        <span className="text-muted-foreground">{isArray ? '[' : '{'}</span>
        {!expanded && (
          <>
            <span className="text-micro text-muted-foreground/70">...</span>
            <span className="text-muted-foreground">{isArray ? ']' : '}'}</span>
            <Badge tone="neutral" className="ml-1 text-micro px-1 py-0 h-4">
              {countLabel}
            </Badge>
          </>
        )}
        {expanded && (
          <Badge tone="neutral" className="ml-1 text-micro px-1 py-0 h-4 opacity-75">
            {countLabel}
          </Badge>
        )}
      </div>

      {expanded && (
        <div className="ml-3.5 border-l border-border/40 pl-2 space-y-0.5">
          {entries.map(([k, v]) => (
            <JsonNode
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              filter={filter}
              forceExpand={forceExpand}
            />
          ))}
          <div className="text-muted-foreground py-0.5">{isArray ? ']' : '}'}</div>
        </div>
      )}
    </div>
  );
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="italic text-muted-foreground">null</span>;
  }
  if (typeof value === 'boolean') {
    return <span className="text-syntax-keyword font-semibold">{String(value)}</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-syntax-number">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className="text-syntax-string">&quot;{value}&quot;</span>;
  }
  return <span className="text-foreground">{String(value)}</span>;
}
