import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import WebSocket from 'ws';
import { SyncClient } from './syncClient.js';
import { WS_CLOSE_CODES } from '@tether/shared/constants';

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

describe('SyncClient Network Lab & Offline Controls', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('killSocket terminates active socket abruptly and initiates reconnect backoff', () => {
    const doc = new Y.Doc();
    let status = 'disconnected';
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
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws.simulateServerMessage(
      JSON.stringify({
        t: 'welcome',
        self: { id: 'u1', name: 'User 1', colorIndex: 0, joinedAt: '', status: 'active', isHost: true, isBot: false },
        members: [],
        hostId: 'u1',
        room: { id: 'demo', language: 'javascript', locked: false, hasPasscode: false, epoch: '123e4567-e89b-12d3-a456-426614174000' },
        token: 'token',
        eventSeq: 0,
      })
    );
    expect(status).toBe('connected');
    expect(ws.readyState).toBe(WebSocket.OPEN);

    client.killSocket();
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    expect(status).toBe('reconnecting');
    client.destroy();
  });

  it('setOffline severs socket, suppresses reconnect, and resumes when brought online', () => {
    const doc = new Y.Doc();
    let status = 'disconnected';
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
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    const welcome = JSON.stringify({
      t: 'welcome',
      self: { id: 'u1', name: 'User 1', colorIndex: 0, joinedAt: '', status: 'active', isHost: true, isBot: false },
      members: [],
      hostId: 'u1',
      room: { id: 'demo', language: 'javascript', locked: false, hasPasscode: false, epoch: '123e4567-e89b-12d3-a456-426614174000' },
      token: 'token',
      eventSeq: 0,
    });
    ws.simulateServerMessage(welcome);
    expect(status).toBe('connected');

    // Go offline
    client.setOffline(true);
    expect(client.connectionStatus).toBe('offline');
    expect(status).toBe('offline');

    // Advance timers - should NOT reconnect while offline
    vi.advanceTimersByTime(10000);
    expect(client.connectionStatus).toBe('offline');

    // Bring online
    const instanceCountBefore = MockWebSocket.instances.length;
    client.setOffline(false);
    expect(MockWebSocket.instances.length).toBe(instanceCountBefore + 1);
    vi.runOnlyPendingTimers();
    const ws2 = MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
    ws2.simulateServerMessage(welcome);
    expect(status).toBe('connected');

    client.destroy();
  });
});
