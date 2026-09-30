import { describe, it, expect, vi } from 'vitest';
import { ServerSyncClient } from './server-sync-client';
import { CommandError } from './types';

interface MockSyncClientOpts {
  onEvent?: (event: unknown) => void;
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
      payload: { bots: 4, seconds: 10 },
      timestamp: new Date().toISOString(),
    });

    const finished = client.storm.get();
    expect(finished.running).toBe(false);
    expect(finished.bots).toBe(0);
    expect(finished.result).toMatchObject({
      durationMs: 10000,
      ops: 1,
      converged: true,
    });

    client.destroy();
  });
});
