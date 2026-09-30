import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { FaultyWebSocket } from './faultyWebSocket.js';

describe('FaultyWebSocket', () => {
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
    const addr = wss.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterEach(() => {
    wss.close();
  });

  it('connects to real WebSocket server and exchanges messages with simulated latency', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', (msg) => {
        ws.send(`echo:${msg.toString()}`);
      });
    });

    const client = new FaultyWebSocket(`ws://127.0.0.1:${port}`, undefined, {
      transportOptions: { minLatencyMs: 10, maxLatencyMs: 20 },
    });

    const received: string[] = [];
    await new Promise<void>((resolve) => {
      client.onopen = () => {
        client.send('hello');
      };
      client.onmessage = (event) => {
        received.push(event.data.toString());
        client.close();
        resolve();
      };
    });

    expect(received).toEqual(['echo:hello']);
  });

  it('supports pause and resume of inbound stream', async () => {
    wss.on('connection', (ws) => {
      ws.on('message', () => {
        ws.send('packet-1');
        ws.send('packet-2');
      });
    });

    const client = new FaultyWebSocket(`ws://127.0.0.1:${port}`);
    client.pause();

    const received: string[] = [];
    client.onmessage = (event) => {
      received.push(event.data.toString());
    };

    await new Promise<void>((resolve) => {
      client.onopen = () => {
        client.send('start');
        resolve();
      };
    });

    // Wait 50ms while paused; no packets should be delivered
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual([]);

    // Resume; packets should now flush in order
    client.resume();
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (received.length === 2) {
          clearInterval(check);
          client.close();
          resolve();
        }
      }, 10);
    });

    expect(received).toEqual(['packet-1', 'packet-2']);
  });
});
