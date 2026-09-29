/**
 * Sandboxed preview document builder (docs/ui-ux/05). The result goes into
 * <iframe sandbox="allow-scripts" srcdoc>, which has an opaque origin, no allow-same-origin, no top navigation and no popups.
 *
 * Decision 2026-09-30: HTML/CSS re-render live (300 ms debounce), but user scripts run only on Run.
 * Live builds strip <script>, so a half-typed `while(` can never hang the tab. JS/TS never runs here: it runs in the
 * Web Worker runner, which has a real 5 s kill. Known ceiling: an infinite loop in an HTML page's own <script>
 * (Run only) can still stall the tab where the browser does not put sandboxed frames in their own process. The
 * host's heartbeat watchdog then reloads the frame once the thread frees up.
 */
export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error';

export interface ConsoleMessage {
  source: 'sandboxed-console';
  type: ConsoleLevel | 'result' | 'heartbeat' | 'done';
  timestamp: number;
  payload: string[];
  runId: string;
}

export function isConsoleMessage(data: unknown): data is ConsoleMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.source === 'sandboxed-console' && typeof d.type === 'string' && Array.isArray(d.payload);
}

function interceptor(runId: string): string {
  // Kept ES5-ish and self-contained: it runs inside the user's page before any user code.
  return `<script>(function(){var R=${JSON.stringify(runId)};function fmt(a){if(typeof a==='string')return a;try{return JSON.stringify(a)}catch(e){return String(a)}}function emit(t,args){try{parent.postMessage({source:'sandboxed-console',type:t,timestamp:Date.now(),payload:Array.prototype.map.call(args,fmt),runId:R},'*')}catch(e){}}['log','info','warn','error'].forEach(function(m){var o=console[m];console[m]=function(){emit(m,arguments);if(o)o.apply(console,arguments)}});window.onerror=function(msg,src,line){emit('error',[msg+' (Line '+line+')'])};window.onunhandledrejection=function(e){emit('error',['Unhandled rejection: '+fmt(e.reason)])};setInterval(function(){emit('heartbeat',[])},500);addEventListener('message',function(e){var d=e.data;if(!d||d.source!=='tether-repl')return;try{emit('result',[fmt((0,eval)(d.code))])}catch(err){emit('error',[String(err)])}});addEventListener('load',function(){emit('done',[])})})();<\/script>`;
}

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?(?:<\/script\s*>|$)/gi;

export function stripScripts(html: string): string {
  return html.replace(SCRIPT_RE, '').replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

const CSS_SAMPLE = `<h1>Heading</h1><p>Paragraph with <a href="#">a link</a> and <code>code</code>.</p><button>Button</button><ul><li>List item</li><li>List item</li></ul>`;

export function buildPreviewDoc(
  mode: 'html' | 'css',
  source: string,
  { runScripts, runId }: { runScripts: boolean; runId: string },
): string {
  const head = interceptor(runId);
  if (mode === 'css') {
    return `<!DOCTYPE html><html><head>${head}<style>${source.replace(/<\/style/gi, '<\\/style')}</style></head><body>${CSS_SAMPLE}</body></html>`;
  }
  const html = runScripts ? source : stripScripts(source);
  // Inject the interceptor as early as possible: after <head>, else after <html>, else prepend.
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + head);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${head}</head>`);
  return head + html;
}
