import type { ConsoleLevel } from './preview';

export const RUN_TIMEOUT_MS = 5000;

export interface RunnerLog {
  type: ConsoleLevel;
  args: string[];
}

/** Worker body: console capture, async-aware completion, errors reported as console.error. */
const WORKER_SOURCE = `
const fmt = (a) => { if (typeof a === 'string') return a; try { return JSON.stringify(a); } catch { return String(a); } };
const emit = (type, args) => self.postMessage({ type, args: Array.from(args, fmt) });
for (const m of ['log', 'info', 'warn', 'error']) console[m] = (...args) => emit(m, args);
self.onunhandledrejection = (e) => emit('error', ['Unhandled rejection: ' + fmt(e.reason)]);
self.onmessage = async (e) => {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction(e.data)();
  } catch (err) {
    emit('error', [err && err.stack ? String(err.stack).split('\\n')[0] : String(err)]);
  } finally {
    self.postMessage({ type: 'done' });
  }
};`;

const WORKER_URL = `data:text/javascript;charset=utf-8,${encodeURIComponent(WORKER_SOURCE)}`;

type WorkerCtor = new (url: string) => Worker;

/**
 * Runs user JS in an ephemeral Web Worker (docs/ui-ux/05 §3). Nothing ever runs on the server.
 * A 5 s watchdog terminates runaway code: `while(true){}` cannot freeze the tab because it lives on another thread.
 *
 * Security: the worker is created from a data: URL, which gives it an opaque origin. A blob: worker would inherit
 * this app's origin, and a collaborator's code could then read IndexedDB (other rooms' docs) or make same-origin requests.
 * Running arbitrary code (new Function / eval) is the feature itself. The isolation is what makes it safe.
 */
export class SandboxedWorkerRunner {
  private worker: Worker | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly WorkerImpl: WorkerCtor = typeof Worker !== 'undefined' ? Worker : (class DummyWorker {} as unknown as WorkerCtor),
    private readonly timeoutMs = RUN_TIMEOUT_MS,
  ) {}

  get running(): boolean {
    return this.worker !== null;
  }

  execute(code: string, onLog: (log: RunnerLog) => void, onComplete: (reason: 'done' | 'timeout' | 'stopped') => void): void {
    this.terminate();
    const worker = new this.WorkerImpl(WORKER_URL);
    this.worker = worker;
    const finish = (reason: 'done' | 'timeout' | 'stopped') => {
      if (this.worker !== worker) return;
      this.terminate();
      onComplete(reason);
    };
    this.watchdog = setTimeout(() => {
      onLog({ type: 'error', args: [`Execution timed out after ${this.timeoutMs}ms (potential infinite loop terminated).`] });
      finish('timeout');
    }, this.timeoutMs);
    worker.onmessage = (e: MessageEvent<{ type: string; args?: string[] }>) => {
      if (e.data.type === 'done') finish('done');
      else onLog({ type: e.data.type as ConsoleLevel, args: e.data.args ?? [] });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      onLog({ type: 'error', args: [e.message || 'Worker error'] });
      finish('done');
    };
    this.stopHandler = () => finish('stopped');
    worker.postMessage(code);
  }

  private stopHandler: (() => void) | null = null;

  stop(): void {
    this.stopHandler?.();
  }

  terminate(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = null;
    this.worker?.terminate();
    this.worker = null;
    this.stopHandler = null;
  }
}

/** TypeScript -> JS for the runner. Lazy-loaded so the editor bundle never pays for it. */
export async function transpileForRun(code: string, language: 'javascript' | 'typescript'): Promise<string> {
  if (language === 'javascript') return code;
  const { transform } = await import('sucrase');
  return transform(code, { transforms: ['typescript'], disableESTransforms: true }).code;
}
