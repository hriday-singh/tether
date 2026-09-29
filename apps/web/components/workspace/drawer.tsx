'use client';

import {
  AlertCircleIcon,
  CancelCircleIcon,
  CpuIcon,
  Delete02Icon,
  MinusSignIcon,
  BotIcon,
  ArrowRight01Icon,
} from '@hugeicons/core-free-icons';
import { STORM_MAX_BOTS, STORM_MAX_SECONDS, THROTTLE_BURST } from '@tether/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Gauge, LineChart } from '@/components/ui/charts';
import { Badge, Segmented, Slider, Switch, Tabs, TabsList, TabsTrigger, Tip } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Input, Label } from '@/components/ui/input';
import { MorphIcon, TextMorph } from '@/components/ui/motion';
import { ThinkingOrb } from '@/components/ui/thinking-orb';
import { toast } from '@/components/ui/toaster';
import { usePrefs } from '@/components/providers';
import { DEMO_MODE } from '@/lib/api';
import type { ConsoleEntry } from '@/lib/console-store';
import { useNow, useStore } from '@/lib/hooks';
import { CommandError } from '@/lib/sync';
import { SandboxedWorkerRunner } from '@/lib/worker-runner';
import { cn, formatAgo, formatClock } from '@/lib/utils';
import { useWorkspace, type UIState } from './context';
import { Metric } from './sync-status';

export function DiagnosticsDrawer({ onCollapse }: { onCollapse: () => void }) {
  const ws = useWorkspace();
  const tab = useStore(ws.ui).drawerTab;
  return (
    <section aria-label="Diagnostics" className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-2">
        <Tabs value={tab} onValueChange={(v) => ws.ui.update((s) => ({ ...s, drawerTab: v as UIState['drawerTab'] }))}>
          <TabsList aria-label="Diagnostics panels">
            <TabsTrigger value="console">Console</TabsTrigger>
            <TabsTrigger value="sync">Sync &amp; Latency</TabsTrigger>
            {DEMO_MODE && <TabsTrigger value="chaos">Chaos Lab</TabsTrigger>}
          </TabsList>
        </Tabs>
        <Tip label="Collapse (Ctrl `)">
          <Button size="icon-xs" variant="ghost" className="ml-auto" aria-label="Collapse diagnostics" onClick={onCollapse}>
            <Icon icon={MinusSignIcon} size={14} />
          </Button>
        </Tip>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'console' && <ConsolePanel />}
        {tab === 'sync' && <SyncPanel />}
        {tab === 'chaos' && DEMO_MODE && <ChaosLab />}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ Console

type Filter = 'all' | 'error' | 'warn' | 'log';
const LEVEL_CLASS: Record<ConsoleEntry['level'], string> = {
  log: 'text-foreground',
  info: 'text-muted-foreground',
  result: 'text-primary',
  input: 'text-muted-foreground',
  warn: 'text-warning bg-warning/5',
  error: 'text-destructive bg-destructive/5',
};

function ConsolePanel() {
  const ws = useWorkspace();
  const entries = useStore(ws.console);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [expr, setExpr] = useState('');
  const history = useRef<string[]>([]);
  const replRunner = useMemo(() => new SandboxedWorkerRunner(), []);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => () => replRunner.terminate(), [replRunner]);

  const shown = useMemo(() => {
    let re: RegExp | null = null;
    try {
      re = query ? new RegExp(query, 'i') : null;
    } catch {
      re = null;
    }
    return entries.filter((e) => {
      if (filter === 'error' && e.level !== 'error') return false;
      if (filter === 'warn' && e.level !== 'warn') return false;
      if (filter === 'log' && !['log', 'info', 'result', 'input'].includes(e.level)) return false;
      if (!query) return true;
      return re ? re.test(e.text) : e.text.toLowerCase().includes(query.toLowerCase());
    });
  }, [entries, filter, query]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  const evaluate = () => {
    const code = expr.trim();
    if (!code) return;
    history.current.push(code);
    setExpr('');
    ws.console.push('input', code, 'system');
    const frame = ws.previewFrame.current?.contentWindow;
    if (frame) {
      // Evaluate inside the running (sandboxed, opaque-origin) preview context.
      frame.postMessage({ source: 'tether-repl', code }, '*');
      return;
    }
    replRunner.execute(
      `const __v = await eval(${JSON.stringify(code)}); console.info(typeof __v === 'undefined' ? 'undefined' : __v);`,
      (log) => ws.console.push(log.type === 'info' ? 'result' : log.type, log.args.join(' '), 'runner'),
      () => {},
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5">
        <Tip label="Clear console">
          <Button size="icon-xs" variant="ghost" aria-label="Clear console" onClick={() => ws.console.clear()}>
            <Icon icon={Delete02Icon} size={14} />
          </Button>
        </Tip>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (text or regex)" aria-label="Filter console" className="h-7 max-w-56 rounded-lg text-caption" />
        <Segmented<Filter>
          aria-label="Severity"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'error', label: 'Errors' },
            { value: 'warn', label: 'Warnings' },
            { value: 'log', label: 'Logs' },
          ]}
        />
      </div>
      <div role="log" aria-label="Console output" className="min-h-0 flex-1 overflow-y-auto font-mono text-caption leading-normal">
        {shown.length === 0 && <p className="p-3 text-muted-foreground">Console output from Run and the live preview shows up here.</p>}
        {shown.map((e) => (
          <div key={e.id} className={cn('flex gap-3 border-b border-border/40 px-3 py-1', LEVEL_CLASS[e.level])}>
            <span className="shrink-0 text-muted-foreground tabular">{formatClock(e.at)}</span>
            {e.level === 'warn' && <Icon icon={AlertCircleIcon} size={13} className="mt-0.5" />}
            {e.level === 'error' && <Icon icon={CancelCircleIcon} size={13} className="mt-0.5" />}
            {e.level === 'input' && <Icon icon={ArrowRight01Icon} size={13} className="mt-0.5" />}
            <span className="min-w-0 break-words whitespace-pre-wrap">{e.text}</span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="flex items-center gap-2 border-t border-border/60 px-3 font-mono text-caption"
        onSubmit={(e) => {
          e.preventDefault();
          evaluate();
        }}
      >
        <span aria-hidden className="text-primary">
          &gt;
        </span>
        <input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.current.length) setExpr(history.current.at(-1) ?? '');
          }}
          placeholder="Evaluate an expression, e.g. 2 + 2"
          aria-label="Console input"
          className="h-8 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/60"
        />
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ Sync diagnostics + Network Lab

function SyncPanel() {
  const { client } = useWorkspace();
  const stats = useStore(client.stats);
  const status = useStore(client.status);
  const now = useNow(1000);
  const { prefs, setPrefs } = usePrefs();
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(0,18rem)] gap-3 overflow-y-auto p-3">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-4 gap-2 font-mono">
          <Metric label="RTT p95" value={stats.rttP95} />
          <Metric label="Ack p95" value={stats.ackP95} />
          <Metric label="Pending" value={status.pending} unit="ops" />
          <Metric label="Frames / s" value={stats.framesPerSec} unit={`of 5 (${stats.tokens}/${THROTTLE_BURST} tokens)`} />
        </div>
        {prefs.telemetrySampling ? (
          <LineChart
            series={[
              { key: 'rtt', label: 'RTT', colorClass: 'stroke-primary', values: stats.samples.map((s) => s.rtt) },
              { key: 'ack', label: 'Sync delay (ack)', colorClass: 'stroke-success', values: stats.samples.map((s) => s.ack) },
            ]}
          />
        ) : (
          <p className="text-caption text-muted-foreground">Live latency sampling is off (Settings, Network).</p>
        )}
        <p className="font-mono text-caption text-muted-foreground">
          Checksum 0x{status.checksum ?? '--------'} ·{' '}
          {status.verifiedAt ? `Verified ${formatAgo(now - status.verifiedAt)}` : 'Syncing'}
        </p>
      </div>
      {DEMO_MODE && (
        <fieldset className="flex flex-col gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-caption font-medium">Network Lab</legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lab-latency">
              Added latency <span className="font-mono tabular">{stats.latencyMs} ms</span>
            </Label>
            <Slider
              id="lab-latency"
              min={0}
              max={500}
              step={10}
              value={[stats.latencyMs]}
              onValueChange={([v]) => {
                client.lab.setLatency(v ?? 0);
                setPrefs({ simulatedLatencyMs: v ?? 0 });
              }}
              aria-label="Added latency in milliseconds"
            />
          </div>
          <label className="flex items-center justify-between gap-2 text-caption">
            Go offline
            <Switch checked={status.connection === 'offline'} onCheckedChange={(v) => client.lab.setOffline(v)} />
          </label>
          <Button size="sm" variant="outline" onClick={() => client.lab.killSocket()} disabled={status.connection !== 'online'}>
            Kill socket (abrupt drop)
          </Button>
          <p className="text-micro text-muted-foreground">Edits made while offline are kept and merged on reconnect.</p>
        </fieldset>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Chaos Lab (P2 bot storm)

function ChaosLab() {
  const { client } = useWorkspace();
  const { prefs } = usePrefs();
  const room = useStore(client.room);
  const storm = useStore(client.storm);
  const now = useNow(500);
  const [bots, setBots] = useState(STORM_MAX_BOTS);
  const [seconds, setSeconds] = useState(20);
  const [faults, setFaults] = useState(true);
  const [pending, setPending] = useState(false);
  const isHost = room.hostId === room.selfId;

  const launch = async () => {
    setPending(true);
    try {
      await client.command({ t: 'demo.storm', bots, seconds, faults });
    } catch (e) {
      toast.error('Storm did not start', { description: e instanceof CommandError ? e.code : String(e) });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,18rem)_minmax(0,1fr)] gap-3 overflow-y-auto p-3">
      <fieldset disabled={!isHost || storm.running} className="flex flex-col gap-3 rounded-xl border border-border p-3 disabled:opacity-70">
        <legend className="px-1 text-caption font-medium">Bot storm</legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="storm-bots">
            Bots <span className="font-mono tabular">{bots}</span>
          </Label>
          <Slider id="storm-bots" min={1} max={STORM_MAX_BOTS} step={1} value={[bots]} onValueChange={([v]) => setBots(v ?? 1)} aria-label="Number of bots" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="storm-secs">
            Duration <span className="font-mono tabular">{seconds}s</span>
          </Label>
          <Slider id="storm-secs" min={10} max={STORM_MAX_SECONDS} step={5} value={[seconds]} onValueChange={([v]) => setSeconds(v ?? 10)} aria-label="Duration in seconds" />
        </div>
        <label className="flex items-center justify-between gap-2 text-caption">
          Inject faults (jitter, reorder, stalls)
          <Switch checked={faults} onCheckedChange={setFaults} />
        </label>
        <Button onClick={() => void launch()} disabled={pending || storm.running || !isHost}>
          <MorphIcon icon={storm.running ? BotIcon : CpuIcon} size={14} />
          <TextMorph>{storm.running ? `${storm.bots} Bots Active` : 'Launch Storm'}</TextMorph>
        </Button>
        {!isHost && <p className="text-micro text-muted-foreground">Only the host can launch a storm.</p>}
      </fieldset>

      <div className="flex min-w-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-4 text-center">
        {storm.running ? (
          <>
            <ThinkingOrb state="working" size={64} animated={prefs.ambientAnimations} label="Bot storm running" />
            <p className="font-mono text-body tabular">
              {storm.ops} ops · {storm.endsAt ? Math.max(0, Math.ceil((storm.endsAt - now) / 1000)) : 0}s left
            </p>
            <p className="text-caption text-muted-foreground">Keep typing: your edits race the bots and must survive.</p>
          </>
        ) : storm.result ? (
          <>
            <Gauge value={storm.result.converged ? 1 : 0} label="Replicas converged" toneClass={storm.result.converged ? 'stroke-success' : 'stroke-destructive'} />
            <Badge tone={storm.result.converged ? 'success' : 'destructive'}>
              {storm.result.converged ? 'Converged: all replicas identical' : 'Diverged'}
            </Badge>
            <p className="font-mono text-caption text-muted-foreground tabular">
              {storm.result.bots} bots · {storm.result.ops} ops · {(storm.result.durationMs / 1000).toFixed(1)}s · checksum 0x{storm.result.checksum}
            </p>
          </>
        ) : (
          <p className="max-w-sm text-caption text-muted-foreground">
            Simulates up to {STORM_MAX_BOTS} concurrent peers typing under latency and network faults to verify replica convergence.
          </p>
        )}
      </div>
    </div>
  );
}
