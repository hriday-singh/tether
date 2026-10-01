'use client';

import {
  ArrowExpand01Icon,
  ArrowReloadHorizontalIcon,
  BrowserIcon,
  Cancel01Icon,
  MinusSignIcon,
  PlusSignIcon,
  ZoomInAreaIcon,
} from '@hugeicons/core-free-icons';
import { useEffect, useRef, useState } from 'react';
import { Badge, Slider, Tip } from '@/components/ui/controls';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/menus';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { buildPreviewDoc, isConsoleMessage } from '@/lib/preview';
import { cn, randomId } from '@/lib/utils';
import { useWorkspace } from './context';
import { JsonPreview } from './preview/json-preview';
import { MarkdownPreview } from './preview/markdown-preview';

const DEBOUNCE_MS = 300;
const WATCHDOG_MS = 5000;
const PRESET_ZOOMS = [0.5, 0.75, 1, 1.25, 1.5] as const;

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
  const [doc, setDoc] = useState(() =>
    mode === 'html' || mode === 'css'
      ? buildPreviewDoc(mode, client.text.toString(), { runScripts: ws.preview.get().scripts, runId: ws.preview.get().runId })
      : '',
  );
  const [prevMode, setPrevMode] = useState(mode);
  if (prevMode !== mode) {
    setPrevMode(mode);
    if (mode === 'html' || mode === 'css') {
      setDoc(buildPreviewDoc(mode, client.text.toString(), { runScripts: ws.preview.get().scripts, runId: ws.preview.get().runId }));
    }
  }
  const [zoom, setZoom] = useState<number>(1);
  const [zoomOpen, setZoomOpen] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const lastBeat = useRef(0);

  const [liveText, setLiveText] = useState(() => client.text.toString());

  // Close zoom popover when clicking into iframe or window blurs
  useEffect(() => {
    if (!zoomOpen) return;
    const onBlur = () => setZoomOpen(false);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [zoomOpen]);

  // Rebuild on text change (debounced). Depends on [client, mode] only, not on `run`.
  // Preview-store mutations (Run Page, refresh, language-switch resets) are handled
  // via a stable store subscription so the text observer is never torn down mid-transition.
  useEffect(() => {
    if (!mode) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const buildDoc = () => {
      const text = client.text.toString();
      setLiveText(text);
      if (mode === 'html' || mode === 'css') {
        const { scripts, runId } = ws.preview.get();
        setDoc(buildPreviewDoc(mode, text, { runScripts: scripts, runId }));
      }
    };

    // Initial build on mount / mode change
    buildDoc();

    // Observe text edits (debounced)
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (mode === 'html' || mode === 'css') {
          if (ws.preview.get().scripts) {
            // User typed while scripts were on, turn scripts off and rebuild
            ws.preview.set({ runId: randomId(4), scripts: false });
          } else {
            buildDoc();
          }
        } else {
          setLiveText(client.text.toString());
        }
      }, DEBOUNCE_MS);
    };
    client.text.observe(onChange);

    // Subscribe to preview store so Run Page / refresh / resets rebuild the doc
    // without tearing down the text observer.
    const unsub = ws.preview.subscribe(() => {
      if (mode === 'html' || mode === 'css') buildDoc();
    });

    return () => {
      client.text.unobserve(onChange);
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [client, mode, ws.preview]);

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
        Live preview is available for HTML, CSS, Markdown, and JSON rooms.
      </div>
    );
  }

  const badgeLabel =
    mode === 'markdown'
      ? 'live · markdown'
      : mode === 'json'
        ? 'live · json tree'
        : run.scripts
          ? 'scripts on'
          : 'live · scripts off';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header && (
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <Icon icon={BrowserIcon} size={14} className="text-muted-foreground" />
          <span className="text-caption font-medium">Preview</span>
          <Badge tone={run.scripts && (mode === 'html' || mode === 'css') ? 'warning' : 'neutral'} className="ml-1">
            {badgeLabel}
          </Badge>
          <div className="ml-auto flex items-center gap-0.5">
            <Tip label="Refresh">
              <Button size="icon-xs" variant="ghost" aria-label="Refresh preview" onClick={() => ws.preview.set({ runId: randomId(4), scripts: false })}>
                <Icon icon={ArrowReloadHorizontalIcon} size={14} />
              </Button>
            </Tip>
            <Popover open={zoomOpen} onOpenChange={setZoomOpen}>
              <Tip label={`Zoom ${Math.round(zoom * 100)}%`}>
                <PopoverTrigger asChild>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`Zoom controls, now ${Math.round(zoom * 100)} percent`}
                  >
                    <Icon icon={ZoomInAreaIcon} size={14} />
                  </Button>
                </PopoverTrigger>
              </Tip>
              <PopoverContent
                side="bottom"
                align="end"
                className="w-60 flex flex-col gap-3 p-3"
                onPointerDownOutside={() => setZoomOpen(false)}
                onInteractOutside={() => setZoomOpen(false)}
              >
                <div className="flex items-center justify-between text-caption font-medium">
                  <span className="text-muted-foreground">Zoom Level</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono tabular">{Math.round(zoom * 100)}%</span>
                    {zoom !== 1 && (
                      <button
                        type="button"
                        onClick={() => setZoom(1)}
                        className="text-micro text-primary hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Zoom out"
                    disabled={zoom <= 0.25}
                    onClick={() => setZoom((z) => Math.max(0.25, Math.round((z - 0.1) * 100) / 100))}
                  >
                    <Icon icon={MinusSignIcon} size={12} />
                  </Button>
                  <Slider
                    min={25}
                    max={200}
                    step={5}
                    value={[Math.round(zoom * 100)]}
                    onValueChange={([val]) => val && setZoom(val / 100)}
                    aria-label="Preview zoom scale"
                    className="flex-1"
                  />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label="Zoom in"
                    disabled={zoom >= 2}
                    onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.1) * 100) / 100))}
                  >
                    <Icon icon={PlusSignIcon} size={12} />
                  </Button>
                </div>

                <div className="flex items-center justify-between gap-1 border-t border-border/50 pt-2">
                  {PRESET_ZOOMS.map((p) => {
                    const active = Math.abs(zoom - p) < 0.01;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setZoom(p)}
                        className={cn(
                          'h-6 rounded px-1.5 text-micro font-medium transition-ui',
                          active
                            ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {Math.round(p * 100)}%
                      </button>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
            <Tip label="Open in new window">
              <Button size="icon-xs" variant="ghost" aria-label="Open preview in new window" onClick={popout}>
                <Icon icon={ArrowExpand01Icon} size={14} />
              </Button>
            </Tip>
            <Tip label="Close preview">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Close preview"
                onClick={() => ws.ui.update((s) => ({ ...s, previewOpen: false }))}
              >
                <Icon icon={Cancel01Icon} size={14} />
              </Button>
            </Tip>
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {(mode === 'html' || mode === 'css') && (
          <iframe
            ref={frame}
            key={`${mode}-${run.runId}`}
            title="Sandboxed live preview"
            sandbox="allow-scripts"
            srcDoc={doc}
            referrerPolicy="no-referrer"
            className={cn(
              'absolute top-0 left-0 origin-top-left border-0 bg-preview-canvas',
              zoomOpen && 'pointer-events-none',
            )}
            style={{ width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})` }}
          />
        )}
        {mode === 'markdown' && <MarkdownPreview content={liveText} zoom={zoom} />}
        {mode === 'json' && <JsonPreview content={liveText} zoom={zoom} />}
      </div>
    </div>
  );
}
