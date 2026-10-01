import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { hashString } from '@tether/shared/checksum';
import { CLIENT_DEAD_MS, WS_CLOSE_CODES } from '@tether/shared/constants';
import { SyncClient } from './syncClient.js';
import { DelayLine } from './delayLine.js';
import type { SyncClientOptions } from './types.js';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public readyState: number = WebSocket.OPEN;
  public binaryType = 'arraybuffer';
  public sent: (Uint8Array | string)[] = [];
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: Uint8Array | string }) => void) | null = null;
  public onerror: ((err: Error) => void) | null = null;
  public onclose: ((event: { code: number }) => void) | null = null;

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }
  public send(data: Uint8Array | string): void {
    this.sent.push(data);
  }
  public close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code: WS_CLOSE_CODES.NORMAL });
  }
  public terminate(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code: WS_CLOSE_CODES.ABNORMAL });
  }
  public receive(data: string): void {
    this.onmessage?.({ data });
  }
}

function makeClient(extra: Partial<SyncClientOptions> = {}): { client: SyncClient; doc: Y.Doc; ws: () => MockWebSocket } {
  const doc = new Y.Doc();
  const client = new SyncClient({
    url: 'ws://localhost/ws/rooms/demo',
    token: 'token-1',
    doc,
    webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
    ...extra,
  });
  return { client, doc, ws: () => MockWebSocket.instances.at(-1)! };
}

const sentControls = (ws: MockWebSocket) =>
  ws.sent.filter((f): f is string => typeof f === 'string').map((f) => JSON.parse(f) as { t: string; ts?: number });

describe('DelayLine', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs synchronously at 0 ms and keeps FIFO order when the delay drops mid-stream', () => {
    const line = new DelayLine();
    const out: number[] = [];
    line.run(() => out.push(0));
    expect(out).toEqual([0]);

    line.setDelay(300);
    line.run(() => out.push(1));
    line.setDelay(0);
    line.run(() => out.push(2)); // queued behind 1, not run immediately
    expect(out).toEqual([0]);
    vi.advanceTimersByTime(300);
    expect(out).toEqual([0, 1, 2]);
  });

  it('clear() drops queued tasks', () => {
    const line = new DelayLine();
    const task = vi.fn();
    line.setDelay(100);
    line.run(task);
    line.clear();
    vi.advanceTimersByTime(500);
    expect(task).not.toHaveBeenCalled();
  });
});

describe('SyncClient network lab + server signals', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  it('setLatency splits the delay across outgoing and incoming frames', () => {
    const onStatsChange = vi.fn();
    const { client, ws } = makeClient({ onStatsChange });
    client.connect();
    vi.advanceTimersByTime(0);
    const sock = ws();
    const baseline = sock.sent.length;

    client.setLatency(200);
    client.sendPing();
    expect(sock.sent.length).toBe(baseline);
    vi.advanceTimersByTime(100);
    expect(sentControls(sock).at(-1)?.t).toBe('ping');

    sock.receive(JSON.stringify({ t: 'pong', id: 1, ts: Date.now(), serverQueueMs: 0 }));
    expect(onStatsChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onStatsChange).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it('setLatency drops stale RTT samples and pings so p50 reflects the new delay at once', () => {
    const onStatsChange = vi.fn();
    const { client, ws } = makeClient({ onStatsChange });
    client.connect();
    vi.advanceTimersByTime(0);
    const sock = ws();
    for (let i = 0; i < 10; i++) {
      sock.receive(JSON.stringify({ t: 'pong', id: i, ts: Date.now() - 10, serverQueueMs: 0 }));
    }

    client.setLatency(150);
    vi.advanceTimersByTime(75);
    const ping = sentControls(sock).at(-1);
    expect(ping?.t).toBe('ping');

    sock.receive(JSON.stringify({ t: 'pong', id: 99, ts: ping?.ts, serverQueueMs: 0 }));
    vi.advanceTimersByTime(75);
    // Slider value = added round trip, not per direction.
    expect(onStatsChange.mock.lastCall?.[0].rtt.p50Ms).toBe(150);
    client.destroy();
  });

  it('reports server checksum matches and mismatches via onChecksum', () => {
    const onChecksum = vi.fn();
    const { client, doc, ws } = makeClient({ onChecksum });
    client.connect();
    vi.advanceTimersByTime(0);
    doc.getText('codemirror').insert(0, 'hello');
    const sv = Buffer.from(Y.encodeStateVector(doc)).toString('base64');

    ws().receive(JSON.stringify({ t: 'checksum', sv, hash: hashString('hello') }));
    expect(onChecksum).toHaveBeenLastCalledWith({ hash: hashString('hello'), matched: true });

    ws().receive(JSON.stringify({ t: 'checksum', sv, hash: 'deadbeef' }));
    expect(onChecksum).toHaveBeenLastCalledWith({ hash: 'deadbeef', matched: false });
    expect(sentControls(ws()).at(-1)?.t).toBe('verify.mismatch');
    client.destroy();
  });

  it('concurrent connect() calls during the storage restore open one socket, and none after destroy', async () => {
    const { client } = makeClient({ storage: { roomId: 'demo', roomEpoch: 'e1' } });
    const first = client.connect();
    const second = client.connect();
    await Promise.all([first, second]);
    expect(MockWebSocket.instances).toHaveLength(1);

    const { client: gone } = makeClient({ storage: { roomId: 'demo', roomEpoch: 'e1' } });
    const pending = gone.connect();
    gone.destroy(); // StrictMode unmount while IndexedDB restore is in flight
    await pending;
    expect(MockWebSocket.instances).toHaveLength(1);
    client.destroy();
  });

  it('dead-connection timer works on browser sockets without terminate() and reconnects once', () => {
    const onReconnectScheduled = vi.fn();
    const { client, ws } = makeClient({ onReconnectScheduled });
    client.connect();
    vi.advanceTimersByTime(0);
    const sock = ws() as unknown as { terminate?: unknown };
    sock.terminate = undefined; // browser WebSocket shape

    expect(() => vi.advanceTimersByTime(CLIENT_DEAD_MS)).not.toThrow();
    expect(onReconnectScheduled).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it('adopts a refreshed token for the next reconnect and surfaces throttling + backoff', () => {
    const onToken = vi.fn();
    const onThrottled = vi.fn();
    const onReconnectScheduled = vi.fn();
    const { client, ws } = makeClient({ onToken, onThrottled, onReconnectScheduled });
    client.connect();
    vi.advanceTimersByTime(0);

    ws().receive(JSON.stringify({ t: 'token', token: 'token-2' }));
    expect(onToken).toHaveBeenCalledWith('token-2');
    ws().receive(JSON.stringify({ t: 'throttled', windowMs: 1000 }));
    expect(onThrottled).toHaveBeenCalledWith(1000);

    ws().terminate();
    expect(onReconnectScheduled).toHaveBeenCalledWith(1, expect.any(Number));
    vi.runOnlyPendingTimers();
    expect(ws().protocols).toContain('token-2');
    client.destroy();
  });
});
