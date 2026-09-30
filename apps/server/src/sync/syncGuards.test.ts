import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { FloodGuard } from './floodGuard.js';
import { AwarenessBinding } from './awarenessBinding.js';
import { WS_CLOSE_CODES } from '@tether/shared/constants';

describe('Sync Guards & Protocol Protection', () => {
  describe('FloodGuard', () => {
    it('detects oversized frames and returns 4009', () => {
      const guard = new FloodGuard();
      const code = guard.checkFrame(512 * 1024 + 1);
      expect(code).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
    });

    it('detects frame rate flooding and returns 4029', () => {
      const now = 1000;
      // 30 frames/s over 3s = 90 frames max
      const guard = new FloodGuard({
        framesPerSec: 10,
        windowSec: 1,
        clock: () => now,
      });

      // Send 10 frames within 1s -> allowed
      for (let i = 0; i < 10; i++) {
        expect(guard.checkFrame(100)).toBeNull();
      }

      // 11th frame triggers flood
      expect(guard.checkFrame(100)).toBe(WS_CLOSE_CODES.FLOOD);
    });
  });

  describe('AwarenessBinding', () => {
    function createAwarenessBuffer(entries: Array<{ clientID: number; clock: number; state: unknown }>): Uint8Array {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, entries.length);
      for (const e of entries) {
        encoding.writeVarUint(encoder, e.clientID);
        encoding.writeVarUint(encoder, e.clock);
        encoding.writeVarString(encoder, JSON.stringify(e.state));
      }
      return encoding.toUint8Array(encoder);
    }

    it('claims clientID on first entry and drops spoofed clientIDs', () => {
      const claimedMap = new Map<number, string>();
      const binding = new AwarenessBinding('user-1', claimedMap);

      const validState = {
        memberId: 'user-1',
        cursor: null,
        highlight: null,
        typing: false,
        status: 'active',
      };

      const buf1 = createAwarenessBuffer([{ clientID: 100, clock: 1, state: validState }]);
      const res1 = binding.filterAwarenessUpdate(buf1);
      expect(res1.validUpdate).toBeDefined();
      expect(claimedMap.get(100)).toBe('user-1');

      // Attempt to send update for clientID 200 from same connection -> dropped
      const buf2 = createAwarenessBuffer([{ clientID: 200, clock: 2, state: validState }]);
      const res2 = binding.filterAwarenessUpdate(buf2);
      expect(res2.validUpdate).toBeNull();

      binding.cleanup();
      expect(claimedMap.has(100)).toBe(false);
    });

    it('drops entries where memberId does not match authenticated user', () => {
      const claimedMap = new Map<number, string>();
      const binding = new AwarenessBinding('user-1', claimedMap);

      const spoofedState = {
        memberId: 'user-victim', // Impersonation attempt!
        cursor: null,
        highlight: null,
        typing: false,
        status: 'active',
      };

      const buf = createAwarenessBuffer([{ clientID: 100, clock: 1, state: spoofedState }]);
      const res = binding.filterAwarenessUpdate(buf);
      expect(res.validUpdate).toBeNull();

      binding.cleanup();
    });

    it('closes socket with 4009 after more than 10 dropped entries', () => {
      const claimedMap = new Map<number, string>();
      const binding = new AwarenessBinding('user-1', claimedMap);

      const badBuf = createAwarenessBuffer([
        {
          clientID: 999,
          clock: 1,
          state: { memberId: 'wrong', typing: false, status: 'active', cursor: null, highlight: null },
        },
      ]);

      let lastCode: number | null = null;
      for (let i = 0; i < 12; i++) {
        const res = binding.filterAwarenessUpdate(badBuf);
        if (res.closeCode) {
          lastCode = res.closeCode;
          break;
        }
      }

      expect(lastCode).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
      binding.cleanup();
    });
  });
});
