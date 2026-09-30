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

class MockEventTarget {
  private listeners = new Map<string, Set<(event?: unknown) => void>>();

  public addEventListener(event: string, handler: (event?: unknown) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  public removeEventListener(event: string, handler: (event?: unknown) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  public dispatchEvent(event: string, payload?: unknown): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload));
  }
}

class MockDocumentTarget extends MockEventTarget {
  public visibilityState: string = 'visible';
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
    const now = 1000;
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

  it('records RTT latency when receiving server pong and emits onStatsChange', () => {
    const doc = new Y.Doc();
    let now = 2000;
    const statsCallback = vi.fn();

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      clock: () => now,
      onStatsChange: statsCallback,
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;

    // Server sends pong for a ping sent at ts = 1950
    now = 2000;
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'pong',
        id: 123,
        ts: 1950,
        serverQueueMs: 0,
      })
    );

    expect(client.stats.rtt.sampleCount).toBe(1);
    expect(client.stats.rtt.latestMs).toBe(50);
    expect(client.stats.rtt.p50Ms).toBe(50);
    expect(statsCallback).toHaveBeenCalledTimes(1);

    client.destroy();
  });

  it('records Ack latency when receiving server ack and emits onStatsChange', () => {
    const doc = new Y.Doc();
    let now = 1000;
    const statsCallback = vi.fn();

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      clock: () => now,
      onStatsChange: statsCallback,
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;

    // Make edit at now = 1000 -> sends UPDATE seq 1
    doc.getText('codemirror').insert(0, 'Hello');
    expect(client.unackedCount).toBe(1);

    // Ack arrives at now = 1120 (latency = 120ms)
    now = 1120;
    ws.simulateServerMessage(JSON.stringify({ t: 'ack', seq: 1 }));

    expect(client.unackedCount).toBe(0);
    expect(client.stats.ackLatency.sampleCount).toBe(1);
    expect(client.stats.ackLatency.latestMs).toBe(120);
    expect(client.stats.ackLatency.p50Ms).toBe(120);
    expect(statsCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        ackLatency: expect.objectContaining({ latestMs: 120, sampleCount: 1 }),
      })
    );

    client.destroy();
  });

  it('sends immediate ping on wake event when connected and starts wake probe', () => {
    const doc = new Y.Doc();
    const mockWindow = new MockEventTarget();
    const mockDocument = new MockDocumentTarget();

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      wakeTarget: { window: mockWindow, document: mockDocument },
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;
    // Simulate server welcome so status is connected
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'welcome',
        self: { id: 'u1', name: 'User 1', colorIndex: 0, joinedAt: new Date().toISOString(), status: 'active', isHost: true, isBot: false },
        members: [],
        hostId: 'u1',
        room: { id: 'demo', language: 'javascript', locked: false, hasPasscode: false, epoch: '123e4567-e89b-12d3-a456-426614174000' },
        token: 'token',
        eventSeq: 0,
      })
    );
    expect(client.connectionStatus).toBe('connected');

    ws.sentFrames = [];

    // Trigger focus event on mockWindow
    mockWindow.dispatchEvent('focus');

    // Should have sent ping frame immediately
    expect(ws.sentFrames.length).toBe(1);
    const sentMsg = JSON.parse(ws.sentFrames[0] as string);
    expect(sentMsg.t).toBe('ping');
    expect(client.wakeManagerInstance?.isProbing).toBe(true);

    // Pong clears probe
    ws.simulateServerMessage(JSON.stringify({ t: 'pong', id: sentMsg.id, ts: sentMsg.ts, serverQueueMs: 0 }));
    expect(client.wakeManagerInstance?.isProbing).toBe(false);

    client.destroy();
  });

  it('reconnects with zero backoff when wake probe times out', () => {
    const doc = new Y.Doc();
    const mockWindow = new MockEventTarget();
    const mockDocument = new MockDocumentTarget();

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      wakeTarget: { window: mockWindow, document: mockDocument },
    });

    client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'welcome',
        self: { id: 'u1', name: 'User 1', colorIndex: 0, joinedAt: new Date().toISOString(), status: 'active', isHost: true, isBot: false },
        members: [],
        hostId: 'u1',
        room: { id: 'demo', language: 'javascript', locked: false, hasPasscode: false, epoch: '123e4567-e89b-12d3-a456-426614174000' },
        token: 'token',
        eventSeq: 0,
      })
    );

    // Wake event triggers probe
    mockWindow.dispatchEvent('focus');
    expect(client.wakeManagerInstance?.isProbing).toBe(true);

    // Timeout (2000ms) without pong -> force close and immediate reconnect
    vi.advanceTimersByTime(2000);

    // New WebSocket instance created immediately (zero backoff)
    expect(MockWebSocket.instances.length).toBe(2);
    expect(client.connectionStatus).toBe('connecting');

    client.destroy();
  });

  it('switches status to offline immediately on browser offline event', () => {
    const doc = new Y.Doc();
    const mockWindow = new MockEventTarget();
    const mockDocument = new MockDocumentTarget();
    let status = '';

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      wakeTarget: { window: mockWindow, document: mockDocument },
      onStatusChange: (s) => {
        status = s;
      },
    });

    client.connect();
    vi.runOnlyPendingTimers();

    mockWindow.dispatchEvent('offline');
    expect(client.connectionStatus).toBe('offline');
    expect(status).toBe('offline');

    client.destroy();
  });

  it('probes admission on pre-welcome close and emits onReauthRequired without reconnecting', async () => {
    const doc = new Y.Doc();
    doc.getText('codemirror').insert(0, 'my local unsaved edits');
    let reauthReason: string | undefined;
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ status: 'reauth', reason: 'passcode_changed' }),
    });

    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      apiUrl: 'http://localhost:3000',
      roomId: 'demo',
      token: 'jwt.token',
      doc,
      fetchFn: mockFetch as unknown as typeof fetch,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      onReauthRequired: (reason) => {
        reauthReason = reason;
      },
    });

    await client.connect();
    vi.runOnlyPendingTimers();

    const ws = MockWebSocket.instances[0]!;
    // Socket closes abnormally before receiving welcome message
    ws.onclose?.({ code: WS_CLOSE_CODES.ABNORMAL });
    // Allow promise ticks for probeAdmission and callback
    await vi.waitFor(() => {
      expect(reauthReason).toBe('passcode_changed');
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/rooms/demo/admission',
      expect.anything()
    );
    expect(client.connectionStatus).toBe('disconnected');
    // In-memory doc edits must be preserved!
    expect(doc.getText('codemirror').toString()).toBe('my local unsaved edits');

    client.destroy();
  });

  it('restores snapshot from storage before connecting', async () => {
    const initialDoc = new Y.Doc();
    initialDoc.getText('codemirror').insert(0, 'restored from idb');
    const update = Y.encodeStateAsUpdate(initialDoc);

    const mockIdb: any = {
      open: () => {
        const req: any = {
          onsuccess: null,
          result: {
            transaction: () => ({
              objectStore: () => ({
                get: () => {
                  const getReq: any = {
                    onsuccess: null,
                    result: { snapshot: update },
                  };
                  queueMicrotask(() => getReq.onsuccess?.());
                  return getReq;
                },
              }),
            }),
          },
        };
        queueMicrotask(() => req.onsuccess?.());
        return req;
      },
    };

    const doc = new Y.Doc();
    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      storage: {
        roomId: 'demo',
        roomEpoch: 'epoch-1',
        idbFactory: mockIdb,
      },
    });

    await client.connect();
    expect(doc.getText('codemirror').toString()).toBe('restored from idb');
    client.destroy();
  });

  it('triggers onAwarenessUpdate, onRoomUpdate, onEvent, onChat and handles command promises', async () => {
    let capturedAwareness: Uint8Array | null = null;
    let capturedRoomUpdate: any = null;
    let capturedEvent: any = null;
    let capturedChat: any = null;

    const doc = new Y.Doc();
    const client = new SyncClient({
      url: 'ws://localhost:3000/ws/rooms/demo',
      token: 'jwt.token',
      doc,
      webSocketFactory: (url, p) => new MockWebSocket(url, p) as unknown as WebSocket,
      onAwarenessUpdate: (aw) => {
        capturedAwareness = aw;
      },
      onRoomUpdate: (settings) => {
        capturedRoomUpdate = settings;
      },
      onEvent: (event) => {
        capturedEvent = event;
      },
      onChat: (msg) => {
        capturedChat = msg;
      },
    });

    await client.connect();
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;

    // 1. Simulate welcome
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'welcome',
        self: { id: 'm1', name: 'Alice', colorIndex: 0, joinedAt: '2026-01-01', status: 'active', isHost: true, isBot: false },
        members: [{ id: 'm1', name: 'Alice', colorIndex: 0, joinedAt: '2026-01-01', status: 'active', isHost: true, isBot: false }],
        hostId: 'm1',
        room: { id: 'demo', language: 'javascript', locked: false, hasPasscode: false, epoch: '11111111-1111-1111-1111-111111111111' },
        token: 'new-token',
        eventSeq: 1,
        chatSeq: 2,
      })
    );

    expect(client.connectionStatus).toBe('connected');

    // 2. Inbound UPDATE with awarenessUpdate
    const dummyAwareness = new Uint8Array([1, 2, 3, 4]);
    const { encodeFrame } = await import('@tether/shared/protocol/codec');
    const updateFrame = encodeFrame({
      kind: FRAME_KINDS.UPDATE,
      seq: 0,
      docUpdate: new Uint8Array(0),
      awarenessUpdate: dummyAwareness,
    });
    ws.simulateServerMessage(updateFrame);
    expect(capturedAwareness).toEqual(dummyAwareness);

    // 3. Inbound room.updated
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'room.updated',
        settings: { locked: true, language: 'python' },
      })
    );
    expect(capturedRoomUpdate).toEqual({ locked: true, language: 'python' });
    expect(client.room?.locked).toBe(true);
    expect(client.room?.language).toBe('python');

    // 4. Inbound event
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'event',
        event: {
          id: 10,
          roomId: 'demo',
          seq: 5,
          type: 'member.joined',
          actorMemberId: 'm2',
          actorName: 'Bob',
          payload: {},
          createdAt: '2026-01-01',
        },
      })
    );
    expect(capturedEvent?.type).toBe('member.joined');

    // 5. Inbound chat.msg
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'chat.msg',
        message: {
          id: 1,
          roomId: 'demo',
          seq: 3,
          clientMsgId: '11111111-1111-1111-1111-111111111111',
          memberId: 'm2',
          name: 'Bob',
          colorIndex: 1,
          text: 'Hello world',
          createdAt: '2026-01-01',
        },
      })
    );
    expect(capturedChat?.text).toBe('Hello world');

    // 6. Command resolving on ok
    const cmdPromise = client.command({
      t: 'host.lock',
      rid: '33333333-3333-3333-3333-333333333333',
      locked: true,
    });
    ws.simulateServerMessage(JSON.stringify({ t: 'ok', rid: '33333333-3333-3333-3333-333333333333' }));
    await expect(cmdPromise).resolves.toBeUndefined();

    // 7. Command rejecting on error
    const errPromise = client.command({
      t: 'host.lock',
      rid: '44444444-4444-4444-4444-444444444444',
      locked: false,
    });
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'error',
        rid: '44444444-4444-4444-4444-444444444444',
        code: 'forbidden',
        message: 'Not host',
      })
    );
    await expect(errPromise).rejects.toThrow('forbidden');
    client.destroy();
  });
});
