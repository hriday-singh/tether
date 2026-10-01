import { describe, it, expect } from 'vitest';
import { IncomingMessage } from 'node:http';
import { clientIp } from './upgradeGate.js';

function req(remoteAddress: string, xff?: string): IncomingMessage {
  return { socket: { remoteAddress }, headers: xff ? { 'x-forwarded-for': xff } : {} } as unknown as IncomingMessage;
}

describe('clientIp', () => {
  it('ignores X-Forwarded-For when no proxy is trusted (client could spoof it)', () => {
    expect(clientIp(req('10.0.0.5', '1.2.3.4'), 0)).toBe('10.0.0.5');
  });

  it('takes the entry our proxy appended, not the client-supplied prefix', () => {
    expect(clientIp(req('10.0.0.1', 'spoofed, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIp(req('10.0.0.1', 'spoofed, 203.0.113.9, 10.0.0.2'), 2)).toBe('203.0.113.9');
  });

  it('falls back to the socket peer without the header', () => {
    expect(clientIp(req('10.0.0.5'), 1)).toBe('10.0.0.5');
  });
});
