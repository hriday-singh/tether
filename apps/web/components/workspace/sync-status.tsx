'use client';

import { Tip } from '@/components/ui/controls';
import { LineChart } from '@/components/ui/charts';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { CountUp, MorphIcon, TextMorph } from '@/components/ui/motion';
import { ThinkingOrb } from '@/components/ui/thinking-orb';
import { usePrefs } from '@/components/providers';
import { useNow, useStore } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { useWorkspace } from './context';
import { describeStatus, type StatusView } from './sync-status-model';

const TONES: Record<StatusView['tone'], string> = {
  success: 'border-success/30 text-success',
  warning: 'border-warning/30 text-warning',
  destructive: 'border-destructive/30 text-destructive',
  neutral: 'border-border text-muted-foreground',
  primary: 'border-primary/30 text-primary',
};

export function StatusPill() {
  const { client } = useWorkspace();
  const { prefs } = usePrefs();
  const status = useStore(client.status);
  const now = useNow(1000);
  const view = describeStatus(status, now);
  return (
    <Tip label={view.detail}>
      <span
        role="status"
        aria-live="polite"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-full border bg-card px-2.5 text-caption font-medium transition-ui',
          TONES[view.tone],
        )}
      >
        {view.orb ? (
          <ThinkingOrb state={view.orb} tone={view.tone} size={20} animated={prefs.ambientAnimations} label={view.label} className="-my-1 size-4" />
        ) : view.icon ? (
          <MorphIcon icon={view.icon} size={14} />
        ) : null}
        <TextMorph>{view.label}</TextMorph>
      </span>
    </Tip>
  );
}

export function LatencyHud() {
  const { client } = useWorkspace();
  const stats = useStore(client.stats);
  const connected = useStore(client.status, (s) => s.connection === 'online');
  const rtt = stats.rttP50 ?? stats.rtt;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Latency ${rtt ?? 'unknown'} milliseconds. Show details`}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-card px-2.5 font-mono text-caption text-muted-foreground transition-ui hover:text-foreground"
        >
          {connected && rtt !== null ? <CountUp value={rtt} /> : <span>--</span>}
          <span>ms</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="mb-3 grid grid-cols-2 gap-2 font-mono text-caption">
          <Metric label="RTT p50" value={stats.rttP50} />
          <Metric label="RTT p95" value={stats.rttP95} />
          <Metric label="Ack p50" value={stats.ackP50} />
          <Metric label="Ack p95" value={stats.ackP95} />
        </div>
        <LineChart
          height={80}
          series={[
            { key: 'rtt', label: 'RTT', colorClass: 'stroke-primary', values: stats.samples.map((s) => s.rtt) },
            { key: 'ack', label: 'Ack (commit)', colorClass: 'stroke-success', values: stats.samples.map((s) => s.ack) },
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}

export function Metric({ label, value, unit = 'ms' }: { label: string; value: number | null; unit?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-background px-2 py-1.5">
      <span className="text-micro text-muted-foreground">{label}</span>
      <span className="tabular text-body text-foreground">{value === null ? '--' : `${value} ${unit}`}</span>
    </div>
  );
}
