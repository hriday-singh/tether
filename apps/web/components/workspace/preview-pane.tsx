'use client';

import { ArrowExpand01Icon, ArrowReloadHorizontalIcon, BrowserIcon, ZoomInAreaIcon } from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { Badge, Tip } from '@/components/ui/controls';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { buildPreviewDoc, isConsoleMessage } from '@/lib/preview';
import { randomId } from '@/lib/utils';
import { useWorkspace } from './context';

const DEBOUNCE_MS = 300;
const WATCHDOG_MS = 5000;
const ZOOMS = [1, 0.75, 0.5] as const;

/**
 * Sandboxed live preview (docs/ui-ux/05): sandbox="allow-scripts" only, so the frame has an opaque origin
 * and cannot read tokens, storage or cookies. HTML/CSS refresh 300 ms after typing, with scripts stripped.
 * Scripts run only after Run page.
 */
export function PreviewPane({ header = true }: { header?: boolean }) {
  const ws = useWorkspace();
  const { client } = ws;
  const mode = languageInfo(useStore(client.room).room.language).preview;
  const run = useStore(ws.preview);
  const [doc, setDoc] = useState('');
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastBeat = useRef(0);

  // Rebuild on text change (debounced). An edit after "Run page" drops back to script-free live mode.
  useEffect(() => {
    if (!mode) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const build = (scripts: boolean) =>
      setDoc(buildPreviewDoc(mode, client.text.toString(), { runScripts: scripts, runId: ws.preview.get().runId }));
    build(ws.preview.get().scripts);
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (ws.preview.get().scripts) ws.preview.set({ runId: randomId(4), scripts: false });
        else build(false);
      }, DEBOUNCE_MS);
    };
    client.text.observe(onChange);
    return () => {
      client.text.unobserve(onChange);
      if (timer) clearTimeout(timer);
    };
  }, [client, mode, ws.preview, run]);

  // Console bridge: only messages from our frame and the current run id are accepted.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !isConsoleMessage(e.data)) return;
      if (e.data.runId !== ws.preview.get().runId) return;
      if (e.data.type === 'heartbeat' || e.data.type === 'done') {
        lastBeat.current = Date.now();
        return;
      }
      ws.console.push(e.data.type, e.data.payload.join(' '), 'preview');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [ws.console, ws.preview]);

  // Watchdog for script runs: a frame that stops beating for 5 s gets reloaded without scripts.
  useEffect(() => {
    if (!run.scripts) return;
    lastBeat.current = Date.now();
    const id = setInterval(() => {
      if (Date.now() - lastBeat.current > WATCHDOG_MS) {
        ws.console.push('error', 'Preview stopped responding for 5000ms. Reloaded without scripts.', 'system');
        ws.preview.set({ runId: randomId(4), scripts: false });
      }
    }, 1000);
    return () => clearInterval(id);
  }, [run.scripts, ws.console, ws.preview]);

  useEffect(() => {
    ws.setPreviewFrame(frame.current);
    return () => ws.setPreviewFrame(null);
  }, [ws, run.runId]);

  const popout = () => {
    // The popup holds only our sandboxed iframe, so user code keeps its opaque origin there too.
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) return;
    const iframe = w.document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.srcdoc = doc;
    iframe.style.cssText = 'border:0;position:fixed;inset:0;width:100%;height:100%';
    w.document.title = `${ws.roomId} preview`;
    w.document.body.style.margin = '0';
    w.document.body.append(iframe);
    w.opener = null;
  };

  if (!mode) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-caption text-muted-foreground">
        Live preview is available for HTML and CSS rooms.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <Icon icon={BrowserIcon} size={14} className="text-muted-foreground" />
          <span className="text-caption font-medium">Preview</span>
          <Badge tone={run.scripts ? 'warning' : 'neutral'} className="ml-1">
            {run.scripts ? 'scripts on' : 'live · scripts off'}
          </Badge>
          <div className="ml-auto flex items-center gap-0.5">
            <Tip label="Refresh">
              <Button size="icon-xs" variant="ghost" aria-label="Refresh preview" onClick={() => ws.preview.set({ runId: randomId(4), scripts: false })}>
                <Icon icon={ArrowReloadHorizontalIcon} size={14} />
              </Button>
            </Tip>
            <Tip label={`Zoom ${Math.round(zoom * 100)}%`}>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Zoom, now ${Math.round(zoom * 100)} percent`}
                onClick={() => setZoom(ZOOMS[(ZOOMS.indexOf(zoom) + 1) % ZOOMS.length]!)}
              >
                <Icon icon={ZoomInAreaIcon} size={14} />
              </Button>
            </Tip>
            <Tip label="Open in a window">
              <Button size="icon-xs" variant="ghost" aria-label="Open preview in a new window" onClick={popout}>
                <Icon icon={ArrowExpand01Icon} size={14} />
              </Button>
            </Tip>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        <iframe
          ref={frame}
          key={run.runId}
          title="Sandboxed live preview"
          sandbox="allow-scripts"
          srcDoc={doc}
          referrerPolicy="no-referrer"
          className="absolute top-0 left-0 origin-top-left border-0 bg-preview-canvas"
          style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}
        />
      </div>
    </div>
  );
}
