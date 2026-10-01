import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import type { Member } from '@tether/shared';
import { ServerSyncClient } from './server-sync-client';
import { CommandError } from './types';

interface MockSyncClientOpts {
  onRosterChange?: (members: Member[]) => void;
  onHostChange?: (hostId: string | null) => void;
  onEvent?: (event: unknown) => void;
  onChecksum?: (result: { hash: string; matched: boolean }) => void;
  onSyncStateChange?: (state: string) => void;
  onStatusChange?: (status: string) => void;
  onThrottled?: (windowMs: number) => void;
  onToken?: (token: string) => void;
  [key: string]: unknown;
}

let lastCreatedOpts: MockSyncClientOpts | null = null;

// Mock @tether/sync-client
vi.mock('@tether/sync-client', () => {
  return {
    SyncClient: vi.fn().mockImplementation((opts: MockSyncClientOpts) => {
      lastCreatedOpts = opts;
      return {
        url: opts.url,
        token: opts.token,
        doc: opts.doc,
        unackedCount: 0,
        hostId: 'host-1',
        connect: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn(),
        command: vi.fn().mockResolvedValue(undefined),
        queueAwarenessUpdate: vi.fn(),
        killSocket: vi.fn(),
        setOffline: vi.fn(),
        setLatency: vi.fn(),
        wakeManagerInstance: { destroy: vi.fn() },
      };
    }),
  };
});

describe('ServerSyncClient', () => {
  const options = {
    roomId: 'test-room',
    memberId: 'mem-1',
    token: 'jwt-token',
    epoch: '11111111-1111-1111-1111-111111111111',
  };

  it('initializes stores with proper initial state', () => {
    const client = new ServerSyncClient(options);

    expect(client.doc).toBeDefined();
    expect(client.text).toBeDefined();
    expect(client.scratchpadText).toBeDefined();
    expect(client.awareness).toBeDefined();

    expect(client.status.get().connection).toBe('restoring');
    expect(client.room.get().room.id).toBe('test-room');
    expect(client.roster.get()).toEqual([]);
    expect(client.presence.get().has('mem-1')).toBe(true);
    expect(client.presence.get().size).toBe(1);

    client.destroy();
  });

  it('handles pause and resume', () => {
    const client = new ServerSyncClient(options);

    client.pause();
    expect(client.status.get().connection).toBe('paused');

    client.resume();
    client.destroy();
  });

  it('forwards command with generated rid', async () => {
    const client = new ServerSyncClient(options);
    const mockProtocol = (client as unknown as { protocolClient: { command: ReturnType<typeof vi.fn> } }).protocolClient;

    await client.command({ t: 'host.lock', locked: true });

    expect(mockProtocol.command).toHaveBeenCalledWith(
      expect.objectContaining({
        t: 'host.lock',
        locked: true,
        rid: expect.any(String),
      }),
    );

    client.destroy();
  });

  it('sendChat forwards chat.send and rejects on error', async () => {
    const client = new ServerSyncClient(options);
    const mockProtocol = (client as unknown as { protocolClient: { command: ReturnType<typeof vi.fn> } }).protocolClient;

    await client.sendChat('msg-1', 'hello');
    expect(mockProtocol.command).toHaveBeenCalledWith({
      t: 'chat.send',
      rid: 'msg-1',
      text: 'hello',
    });

    mockProtocol.command.mockRejectedValueOnce(new Error('rate_limited'));
    await expect(client.sendChat('msg-2', 'spam')).rejects.toThrow(CommandError);

    client.destroy();
  });

  it('onEvent and onChat register listeners and cleanup', () => {
    const client = new ServerSyncClient(options);
    const eventHandler = vi.fn();
    const chatHandler = vi.fn();

    const unsubEvent = client.onEvent(eventHandler);
    const unsubChat = client.onChat(chatHandler);

    expect(typeof unsubEvent).toBe('function');
    expect(typeof unsubChat).toBe('function');

    unsubEvent();
    unsubChat();
    client.destroy();
  });

  it('initializes local awareness state and updates typing status on text insert', () => {
    vi.useFakeTimers();
    const client = new ServerSyncClient(options);

    const localState = client.awareness.getLocalState();
    expect(localState).toMatchObject({
      memberId: 'mem-1',
      status: 'active',
      typing: false,
    });

    client.text.insert(0, 'A');
    expect(client.awareness.getLocalState()?.typing).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(client.awareness.getLocalState()?.typing).toBe(false);

    client.destroy();
    vi.useRealTimers();
  });

  it('moves the roster host flag on a live host change', () => {
    const client = new ServerSyncClient(options);
    const member = (id: string, isHost: boolean): Member => ({ id, name: id, colorIndex: 0, joinedAt: '', isHost, isBot: false, status: 'active' });
    lastCreatedOpts?.onHostChange?.('a');
    lastCreatedOpts?.onRosterChange?.([member('a', true), member('b', false)]);
    lastCreatedOpts?.onHostChange?.('b');
    expect(client.roster.get().map((m) => [m.id, m.isHost])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('updates storm store on demo.storm and demo.storm_completed events', () => {
    const client = new ServerSyncClient(options);
    expect(client.storm.get().running).toBe(false);

    lastCreatedOpts?.onEvent?.({
      id: 1,
      roomId: 'test-room',
      seq: 1,
      type: 'demo.storm',
      actorMemberId: 'mem-1',
      actorName: 'Host',
      payload: { bots: 4, seconds: 10, faults: true },
      timestamp: new Date().toISOString(),
    });

    const active = client.storm.get();
    expect(active.running).toBe(true);
    expect(active.bots).toBe(4);
    expect(active.endsAt).toBeGreaterThan(Date.now());
    expect(active.ops).toBe(0);

    // Simulate typing during storm
    client.text.insert(0, 'hello');
    expect(client.storm.get().ops).toBe(1);

    lastCreatedOpts?.onEvent?.({
      id: 2,
      roomId: 'test-room',
      seq: 2,
      type: 'demo.storm_completed',
      actorMemberId: null,
      actorName: null,
      payload: { bots: 4, seconds: 10, durationMs: 9800, ops: 57, converged: true, checksum: 'abcd1234' },
      timestamp: new Date().toISOString(),
    });

    // Server says bot replicas converged; this browser's replica is still unverified.
    const finished = client.storm.get();
    expect(finished.running).toBe(false);
    expect(finished.bots).toBe(0);
    expect(finished.result).toMatchObject({ durationMs: 9800, ops: 57, converged: null, checksum: 'abcd1234' });

    lastCreatedOpts?.onChecksum?.({ hash: 'abcd1234', matched: true });
    expect(client.storm.get().result).toMatchObject({ converged: true, checksum: 'abcd1234' });

    client.destroy();
  });

  it('reports a storm as diverged when this replica never matches a server checksum', () => {
    vi.useFakeTimers();
    const client = new ServerSyncClient(options);
    lastCreatedOpts?.onEvent?.({
      id: 2, roomId: 'test-room', seq: 2, type: 'demo.storm_completed', actorMemberId: null, actorName: null,
      payload: { bots: 2, ops: 10, durationMs: 5000, converged: true, checksum: 'abcd1234' },
      timestamp: new Date().toISOString(),
    });
    lastCreatedOpts?.onChecksum?.({ hash: 'ffff0000', matched: false });
    vi.advanceTimersByTime(5000);
    expect(client.storm.get().result?.converged).toBe(false);
    client.destroy();
    vi.useRealTimers();
  });

  it('marks the replica verified only on a server checksum match, and new local edits clear it', () => {
    const client = new ServerSyncClient(options);
    lastCreatedOpts?.onStatusChange?.('connected');
    lastCreatedOpts?.onSyncStateChange?.('synced');
    expect(client.status.get().verifiedAt).toBeNull();

    lastCreatedOpts?.onChecksum?.({ hash: '0badf00d', matched: true });
    expect(client.status.get()).toMatchObject({ checksum: '0badf00d' });
    expect(client.status.get().verifiedAt).not.toBeNull();

    lastCreatedOpts?.onSyncStateChange?.('saving');
    expect(client.status.get().verifiedAt).toBeNull();
    client.destroy();
  });

  it('surfaces server throttling for its window and forwards token refreshes', () => {
    vi.useFakeTimers();
    const onToken = vi.fn();
    const client = new ServerSyncClient({ ...options, onToken });
    lastCreatedOpts?.onThrottled?.(1000);
    expect(client.status.get().throttled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(client.status.get().throttled).toBe(false);

    lastCreatedOpts?.onToken?.('fresh');
    expect(onToken).toHaveBeenCalledWith('fresh');
    client.destroy();
    vi.useRealTimers();
  });

  it('does not mark us typing on remote edits', () => {
    const client = new ServerSyncClient(options);
    const remote = new Y.Doc();
    remote.getText('codemirror').insert(0, 'from a peer');
    Y.applyUpdate(client.doc, Y.encodeStateAsUpdate(remote), 'remote');
    expect(client.awareness.getLocalState()?.typing).toBe(false);
    client.destroy();
  });

  it('lab methods forward to protocol client', () => {
    const client = new ServerSyncClient(options);
    const mockProtocol = (client as unknown as { protocolClient: { killSocket: ReturnType<typeof vi.fn>; setOffline: ReturnType<typeof vi.fn> } }).protocolClient;

    client.lab.killSocket();
    expect(mockProtocol.killSocket).toHaveBeenCalledTimes(1);

    client.lab.setOffline(true);
    expect(mockProtocol.setOffline).toHaveBeenCalledWith(true);

    client.lab.setOffline(false);
    expect(mockProtocol.setOffline).toHaveBeenCalledWith(false);

    client.lab.setLatency(150);
    expect((mockProtocol as unknown as { setLatency: ReturnType<typeof vi.fn> }).setLatency).toHaveBeenCalledWith(150);
    expect(client.stats.get().latencyMs).toBe(150);

    client.destroy();
  });
});
