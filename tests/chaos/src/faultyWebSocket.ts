import WebSocket from 'ws';
import { FaultyTransport, FaultyTransportOptions } from '@tether/sync-client/testing';

export interface FaultyWebSocketOptions {
  transportOptions?: FaultyTransportOptions;
}

/**
 * FaultyWebSocket adapts a real Node.js ws.WebSocket to simulate
 * network faults (latency jitter, pause/resume, abrupt termination)
 * on both inbound and outbound paths while preserving TCP FIFO packet order.
 */
export class FaultyWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public readyState: number = FaultyWebSocket.CONNECTING;
  public binaryType = 'arraybuffer';

  public onopen: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: ArrayBuffer | Uint8Array | string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;
  public onclose: ((event: { code: number }) => void) | null = null;

  public readonly realWs: WebSocket;
  public readonly inboundTransport: FaultyTransport;
  public readonly outboundTransport: FaultyTransport;

  public outboundFrameTimestamps: number[] = [];
  private isClosed = false;

  constructor(url: string, protocols?: string | string[], options: FaultyWebSocketOptions = {}) {
    this.inboundTransport = new FaultyTransport(options.transportOptions);
    this.outboundTransport = new FaultyTransport(options.transportOptions);

    this.inboundTransport.onMessage((data) => {
      if (this.onmessage) {
        if (typeof data === 'string') {
          this.onmessage({ data });
        } else {
          this.onmessage({ data: data instanceof Uint8Array ? data : new Uint8Array(data) });
        }
      }
    });

    this.outboundTransport.onMessage((data) => {
      if (this.realWs.readyState === WebSocket.OPEN) {
        this.realWs.send(data);
      }
    });

    this.realWs = new WebSocket(url, protocols);
    this.realWs.binaryType = 'arraybuffer';

    this.realWs.on('open', () => {
      this.readyState = FaultyWebSocket.OPEN;
      this.onopen?.({});
    });

    this.realWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
      if (isBinary) {
        const u8 = data instanceof Buffer ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);
        this.inboundTransport.send(u8);
      } else {
        this.inboundTransport.send(data.toString('utf-8'));
      }
    });

    this.realWs.on('error', (err) => {
      this.onerror?.(err);
    });

    this.realWs.on('close', (code) => {
      this.triggerClose(code);
    });
  }

  private triggerClose(code: number): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.readyState = FaultyWebSocket.CLOSED;
    this.inboundTransport.kill();
    this.outboundTransport.kill();
    this.onclose?.({ code });
  }

  public send(data: Uint8Array | string): void {
    if (this.readyState !== FaultyWebSocket.OPEN && this.realWs.readyState !== WebSocket.OPEN) {
      return;
    }
    this.outboundFrameTimestamps.push(Date.now());
    this.outboundTransport.send(data);
  }

  public setLatency(minMs: number, maxMs: number): void {
    this.inboundTransport.minLatencyMs = minMs;
    this.inboundTransport.maxLatencyMs = maxMs;
    this.outboundTransport.minLatencyMs = minMs;
    this.outboundTransport.maxLatencyMs = maxMs;
  }

  public pause(): void {
    this.inboundTransport.pause();
  }

  public resume(): void {
    this.inboundTransport.resume();
  }

  public terminate(): void {
    this.triggerClose(1006);
    this.realWs.terminate();
  }

  public close(code = 1000): void {
    this.readyState = FaultyWebSocket.CLOSING;
    this.realWs.close(code);
  }
}
