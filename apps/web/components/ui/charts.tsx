import { cn } from '@/lib/utils';

/**
 * Live line chart and gauge. ADR-016 names bklit-ui, but `@bklit/*` is not published on npm, so these are the
 * minimal SVG equivalents (no dependency, token colors, zero layout work per sample).
 * TODO: swap in the bklit registry components if they get published. The props mirror their shape.
 */
export interface Series {
  key: string;
  label: string;
  colorClass: string; // e.g. 'stroke-primary'
  values: readonly (number | null)[];
}

export function LineChart({ series, height = 112, className }: { series: readonly Series[]; height?: number; className?: string }) {
  const width = 400;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(10, ...all) * 1.15;
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const path = (values: readonly (number | null)[]) => {
    let d = '';
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) return;
      const x = (i / (n - 1)) * width;
      const y = height - (v / max) * height;
      d += `${pen ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  return (
    <figure className={cn('flex flex-col gap-1.5', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full overflow-visible"
        style={{ height }}
        role="img"
        aria-label={series.map((s) => `${s.label}: ${s.values.filter((v) => v !== null).at(-1) ?? 'no data'} ms`).join(', ')}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={width} y1={height * f} y2={height * f} className="stroke-border" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" className={s.colorClass} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <figcaption className="flex items-center gap-3 text-micro text-muted-foreground">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <svg width="10" height="2" aria-hidden>
              <line x1="0" x2="10" y1="1" y2="1" className={s.colorClass} strokeWidth={2} />
            </svg>
            {s.label}
          </span>
        ))}
        <span className="ml-auto font-mono tabular">max {Math.round(max / 1.15)} ms</span>
      </figcaption>
    </figure>
  );
}

/** Semicircle gauge, 0..1. */
export function Gauge({ value, label, toneClass = 'stroke-success' }: { value: number; label: string; toneClass?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const r = 40;
  const circumference = Math.PI * r;
  return (
    <svg viewBox="0 0 100 56" className="h-16 w-28" role="img" aria-label={`${label}: ${Math.round(v * 100)}%`}>
      <path d="M10 50 A40 40 0 0 1 90 50" fill="none" className="stroke-muted" strokeWidth={8} strokeLinecap="round" />
      <path
        d="M10 50 A40 40 0 0 1 90 50"
        fill="none"
        className={cn(toneClass, 'transition-[stroke-dashoffset] duration-(--duration-slow) ease-standard')}
        strokeWidth={8}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - v)}
      />
    </svg>
  );
}
