import { describe, it, expect, beforeEach } from 'vitest';
import { ProtocolGuard } from './protocolGuard.js';
import { FRAME_KINDS, WS_CLOSE_CODES } from '@tether/shared/constants';
import { BinaryFrame } from '@tether/shared/protocol/codec';

describe('ProtocolGuard', () => {
  let guard: ProtocolGuard;

  beforeEach(() => {
    guard = new ProtocolGuard();
  });

  it('rejects first frame if not SYNC_STEP1', () => {
    const updateFrame: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 1,
      docUpdate: new Uint8Array([1, 2, 3]),
      awarenessUpdate: new Uint8Array(0),
    };
    expect(guard.checkFrame(updateFrame)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);

    const step2Frame: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP2,
      seq: 0,
      update: new Uint8Array([1, 2]),
    };
    expect(guard.checkFrame(step2Frame)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
  });

  it('allows SYNC_STEP1 as first frame, rejects duplicate SYNC_STEP1', () => {
    const step1: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: new Uint8Array(0),
    };
    expect(guard.checkFrame(step1)).toBeNull();

    // Duplicate SYNC_STEP1 must be rejected
    expect(guard.checkFrame(step1)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
  });

  it('rejects UPDATE before handshake completes with SYNC_STEP2', () => {
    const step1: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: new Uint8Array(0),
    };
    expect(guard.checkFrame(step1)).toBeNull();

    const update: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 1,
      docUpdate: new Uint8Array([1]),
      awarenessUpdate: new Uint8Array(0),
    };
    expect(guard.checkFrame(update)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
  });

  it('rejects duplicate SYNC_STEP2', () => {
    const step1: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: new Uint8Array(0),
    };
    expect(guard.checkFrame(step1)).toBeNull();

    const step2: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP2,
      seq: 0,
      update: new Uint8Array(0),
    };
    expect(guard.checkFrame(step2)).toBeNull();
    expect(guard.isHandshakeComplete()).toBe(true);

    // Duplicate SYNC_STEP2 must be rejected
    expect(guard.checkFrame(step2)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);
  });

  it('enforces strictly increasing sequence numbers on UPDATE frames', () => {
    guard.checkFrame({
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: new Uint8Array(0),
    });
    guard.checkFrame({
      kind: FRAME_KINDS.SYNC_STEP2,
      seq: 0,
      update: new Uint8Array(0),
    });

    const update1: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 1,
      docUpdate: new Uint8Array([1]),
      awarenessUpdate: new Uint8Array(0),
    };
    expect(guard.checkFrame(update1)).toBeNull();

    // Same seq 1 rejected
    expect(guard.checkFrame(update1)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);

    // Lower seq 0 rejected
    const updateOld: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 0,
      docUpdate: new Uint8Array([1]),
      awarenessUpdate: new Uint8Array(0),
    };
    expect(guard.checkFrame(updateOld)).toBe(WS_CLOSE_CODES.PROTOCOL_VIOLATION);

    // Strictly higher seq 2 accepted
    const update2: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 2,
      docUpdate: new Uint8Array([2]),
      awarenessUpdate: new Uint8Array(0),
    };
    expect(guard.checkFrame(update2)).toBeNull();
  });
});
