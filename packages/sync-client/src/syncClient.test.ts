import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { SyncClient } from './syncClient.js';
import { decodeFrame } from '@tether/shared/protocol/codec';
import { FRAME_KINDS, WS_CLOSE_CODES } from '@tether/shared/constants';

class MockWebSocket {
  public static instances: MockWebSocket[] = [];
  public readyState: number = WebSocket.OPEN;
  public binaryType = 'arraybuffer';
  public sentFrames: (Uint8Array | string)[] = [];

  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: Uint8Array | string }) => void) | null = null;
  public onerror: ((err: Error) => void) | null = null;
  public onclose: ((event: { code: number }) => void) | null = null;

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this);
    setTimeout(() => this.onopen?.(), 0);
  }

  public send(data: Uint8Array | string): void {
    this.sentFrames.push(data);
  }

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code: WS_CLOSE_CODES.NORMAL });
  }

  public terminate(): void {
    this.readyState = WebSocket.CLOSED;
    this.onclose?.({ code: WS_CLOSE_CODES.ABNORMAL });
  }

  public simulateServerMessage(data: Uint8Array | string): void {
    this.onmessage?.({ data });
  }
}

describe('SyncClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('performs leading-edge flush on first edit and batches rapid successive edits', () => {
    const doc = new Y.Doc();
    let now = 1000;
    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      clock: () => now,
    });

    client.connect();
    vi.runOnlyPendingTimers(); // triggers handleOpen -> SYNC_STEP1

    const ws = MockWebSocket.instances[0]!;
    expect(ws.sentFrames.length).toBe(1); // SYNC_STEP1
    const step1 = decodeFrame(ws.sentFrames[0] as Uint8Array);
    expect(step1.kind).toBe(FRAME_KINDS.SYNC_STEP1);

    // First local edit at t=1000 (leading edge)
    doc.getText('codemirror').insert(0, 'Hello');
    expect(ws.sentFrames.length).toBe(2); // Flushed immediately!
    const frame1 = decodeFrame(ws.sentFrames[1] as Uint8Array);
    expect(frame1.kind).toBe(FRAME_KINDS.UPDATE);

    // Second edit at t=1050 (within 200ms window)
    now = 1050;
    doc.getText('codemirror').insert(5, ' ');
    // Third edit at t=1100 (still within window)
    now = 1100;
    doc.getText('codemirror').insert(6, 'World');

    // Should NOT have sent yet (batched!)
    expect(ws.sentFrames.length).toBe(2);

    // Advance time past 200ms window (to t=1200)
    now = 1200;
    vi.advanceTimersByTime(150);

    // Now second batch is flushed!
    expect(ws.sentFrames.length).toBe(3);
    const frame2 = decodeFrame(ws.sentFrames[2] as Uint8Array);
    expect(frame2.kind).toBe(FRAME_KINDS.UPDATE);

    client.destroy();
  });

  it('tracks sync state and clears pending acks upon receiving server ack', () => {
    const doc = new Y.Doc();
    let now = 1000;
    let lastSyncState = '';

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      clock: () => now,
      onSyncStateChange: (st) => {
        lastSyncState = st;
      },
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;

    // Make an edit -> saving
    doc.getText('codemirror').insert(0, 'Test');
    expect(client.unackedCount).toBe(1);
    expect(lastSyncState).toBe('saving');

    // Simulate server welcome + ack for seq 1
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'welcome',
        self: {
          id: 'u1',
          name: 'User 1',
          colorIndex: 0,
          joinedAt: new Date().toISOString(),
          status: 'active',
          isHost: true,
          isBot: false,
        },
        members: [],
        hostId: 'u1',
        room: {
          id: 'demo',
          language: 'javascript',
          locked: false,
          hasPasscode: false,
          epoch: '123e4567-e89b-12d3-a456-426614174000',
        },
        token: 'token',
        eventSeq: 0,
      })
    );

    ws.simulateServerMessage(JSON.stringify({ t: 'ack', seq: 1 }));
    expect(client.unackedCount).toBe(0);
    expect(lastSyncState).toBe('saved');

    client.destroy();
  });

  it('does not reconnect when kicked by host (code 4003)', () => {
    const doc = new Y.Doc();
    let status = '';

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      onStatusChange: (s) => {
        status = s;
      },
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;
    ws.onclose?.({ code: WS_CLOSE_CODES.KICKED });

    expect(client.connectionStatus).toBe('kicked');
    expect(status).toBe('kicked');

    // Advance 30 seconds -> no reconnect attempted
    vi.advanceTimersByTime(30000);
    expect(MockWebSocket.instances.length).toBe(1);

    client.destroy();
  });
});
