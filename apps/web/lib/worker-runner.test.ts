import { SandboxedWorkerRunner, transpileForRun, type RunnerLog } from './worker-runner';

class HangingWorker {
  static last: HangingWorker | null = null;
  static url = '';
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  constructor(url: string) {
    HangingWorker.url = url;
    HangingWorker.last = this;
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
}

describe('SandboxedWorkerRunner', () => {
  it('kills a runaway worker after the watchdog and reports a timeout', () => {
    vi.useFakeTimers();
    const logs: RunnerLog[] = [];
    const done = vi.fn();
    const runner = new SandboxedWorkerRunner(HangingWorker as unknown as new (u: string) => Worker, 5000);
    runner.execute('while(true){}', (l) => logs.push(l), done);
    vi.advanceTimersByTime(4999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledWith('timeout');
    expect(HangingWorker.last?.terminated).toBe(true);
    expect(logs[0]?.args[0]).toMatch(/timed out after 5000ms/);
    vi.useRealTimers();
  });

  it('passes logs through and completes on done', () => {
    const logs: RunnerLog[] = [];
    const done = vi.fn();
    const runner = new SandboxedWorkerRunner(HangingWorker as unknown as new (u: string) => Worker);
    runner.execute('x', (l) => logs.push(l), done);
    const w = HangingWorker.last!;
    w.onmessage?.({ data: { type: 'log', args: ['hi'] } } as MessageEvent);
    w.onmessage?.({ data: { type: 'done' } } as MessageEvent);
    expect(logs).toEqual([{ type: 'log', args: ['hi'] }]);
    expect(done).toHaveBeenCalledWith('done');
    expect(runner.running).toBe(false);
  });

  it('uses an opaque-origin data: worker, never a same-origin blob:', () => {
    new SandboxedWorkerRunner(HangingWorker as unknown as new (u: string) => Worker).execute('1', () => {}, () => {});
    expect(HangingWorker.url.startsWith('data:text/javascript')).toBe(true);
  });

  it('strips TypeScript types before running', async () => {
    const js = await transpileForRun('const n: number = 1; console.log(n as number);', 'typescript');
    expect(js).not.toContain(': number');
    expect(js).not.toContain('as number');
  });
});
