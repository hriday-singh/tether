import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  encodeFrame,
  decodeFrame,
  CodecError,
  BinaryFrame,
} from './codec.js';
import { FRAME_KINDS, MAX_FRAME_BYTES, MAX_SYNC_FRAME_BYTES } from '../constants.js';

describe('Binary Frame Codec', () => {
  it('should roundtrip SYNC_STEP1 frame', () => {
    const original: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP1,
      stateVector: new Uint8Array([1, 2, 3, 4, 5, 255]),
    };
    const encoded = encodeFrame(original);
    const decoded = decodeFrame(encoded);

    expect(decoded.kind).toBe(FRAME_KINDS.SYNC_STEP1);
    if (decoded.kind === FRAME_KINDS.SYNC_STEP1) {
      expect(Array.from(decoded.stateVector)).toEqual(Array.from(original.stateVector));
    }
  });

  it('should roundtrip SYNC_STEP2 frame', () => {
    const original: BinaryFrame = {
      kind: FRAME_KINDS.SYNC_STEP2,
      seq: 42,
      update: new Uint8Array([10, 20, 30, 40]),
    };
    const encoded = encodeFrame(original);
    const decoded = decodeFrame(encoded);

    expect(decoded.kind).toBe(FRAME_KINDS.SYNC_STEP2);
    if (decoded.kind === FRAME_KINDS.SYNC_STEP2) {
      expect(decoded.seq).toBe(42);
      expect(Array.from(decoded.update)).toEqual(Array.from(original.update));
    }
  });

  it('should roundtrip UPDATE frame with both doc and awareness updates', () => {
    const original: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 101,
      docUpdate: new Uint8Array([1, 2, 3]),
      awarenessUpdate: new Uint8Array([4, 5, 6, 7]),
    };
    const encoded = encodeFrame(original);
    const decoded = decodeFrame(encoded);

    expect(decoded.kind).toBe(FRAME_KINDS.UPDATE);
    if (decoded.kind === FRAME_KINDS.UPDATE) {
      expect(decoded.seq).toBe(101);
      expect(Array.from(decoded.docUpdate)).toEqual(Array.from(original.docUpdate));
      expect(Array.from(decoded.awarenessUpdate)).toEqual(Array.from(original.awarenessUpdate));
    }
  });

  it('should roundtrip UPDATE frame with empty buffers', () => {
    const original: BinaryFrame = {
      kind: FRAME_KINDS.UPDATE,
      seq: 0,
      docUpdate: new Uint8Array(0),
      awarenessUpdate: new Uint8Array(0),
    };
    const encoded = encodeFrame(original);
    const decoded = decodeFrame(encoded);

    expect(decoded.kind).toBe(FRAME_KINDS.UPDATE);
    if (decoded.kind === FRAME_KINDS.UPDATE) {
      expect(decoded.seq).toBe(0);
      expect(decoded.docUpdate.byteLength).toBe(0);
      expect(decoded.awarenessUpdate.byteLength).toBe(0);
    }
  });

  it('should reject decoding empty buffer', () => {
    expect(() => decodeFrame(new Uint8Array(0))).toThrow(CodecError);
  });

  it('should reject frame exceeding MAX_SYNC_FRAME_BYTES on decode', () => {
    const oversized = new Uint8Array(MAX_SYNC_FRAME_BYTES + 1);
    expect(() => decodeFrame(oversized)).toThrow(CodecError);
  });

  it('round-trips a whole-doc sync frame larger than MAX_FRAME_BYTES', () => {
    const update = new Uint8Array(MAX_FRAME_BYTES * 2).fill(7);
    const decoded = decodeFrame(encodeFrame({ kind: FRAME_KINDS.SYNC_STEP2, seq: 0, update }));
    expect(decoded.kind === FRAME_KINDS.SYNC_STEP2 && decoded.update.byteLength).toBe(update.byteLength);
  });

  it('should reject unknown frame kinds', () => {
    const badFrame = new Uint8Array([99, 1, 2]);
    expect(() => decodeFrame(badFrame)).toThrow(CodecError);
  });

  describe('Property-based roundtrip testing with fast-check', () => {
    it('roundtrips arbitrary SYNC_STEP1 payloads', () => {
      fc.assert(
        fc.property(fc.uint8Array({ minLength: 0, maxLength: 5000 }), (bytes) => {
          const frame: BinaryFrame = {
            kind: FRAME_KINDS.SYNC_STEP1,
            stateVector: bytes,
          };
          const decoded = decodeFrame(encodeFrame(frame));
          expect(decoded.kind).toBe(FRAME_KINDS.SYNC_STEP1);
          if (decoded.kind === FRAME_KINDS.SYNC_STEP1) {
            expect(Array.from(decoded.stateVector)).toEqual(Array.from(bytes));
          }
        })
      );
    });

    it('roundtrips arbitrary SYNC_STEP2 payloads', () => {
      fc.assert(
        fc.property(
          fc.nat(1000000),
          fc.uint8Array({ minLength: 0, maxLength: 5000 }),
          (seq, bytes) => {
            const frame: BinaryFrame = {
              kind: FRAME_KINDS.SYNC_STEP2,
              seq,
              update: bytes,
            };
            const decoded = decodeFrame(encodeFrame(frame));
            expect(decoded.kind).toBe(FRAME_KINDS.SYNC_STEP2);
            if (decoded.kind === FRAME_KINDS.SYNC_STEP2) {
              expect(decoded.seq).toBe(seq);
              expect(Array.from(decoded.update)).toEqual(Array.from(bytes));
            }
          }
        )
      );
    });

    it('roundtrips arbitrary UPDATE payloads', () => {
      fc.assert(
        fc.property(
          fc.nat(1000000),
          fc.uint8Array({ minLength: 0, maxLength: 2500 }),
          fc.uint8Array({ minLength: 0, maxLength: 2500 }),
          (seq, docBytes, awarenessBytes) => {
            const frame: BinaryFrame = {
              kind: FRAME_KINDS.UPDATE,
              seq,
              docUpdate: docBytes,
              awarenessUpdate: awarenessBytes,
            };
            const decoded = decodeFrame(encodeFrame(frame));
            expect(decoded.kind).toBe(FRAME_KINDS.UPDATE);
            if (decoded.kind === FRAME_KINDS.UPDATE) {
              expect(decoded.seq).toBe(seq);
              expect(Array.from(decoded.docUpdate)).toEqual(Array.from(docBytes));
              expect(Array.from(decoded.awarenessUpdate)).toEqual(Array.from(awarenessBytes));
            }
          }
        )
      );
    });
  });
});
