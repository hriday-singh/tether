import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { FRAME_KINDS, MAX_FRAME_BYTES } from '../constants.js';

export type SyncStep1Frame = {
  kind: typeof FRAME_KINDS.SYNC_STEP1;
  stateVector: Uint8Array;
};

export type SyncStep2Frame = {
  kind: typeof FRAME_KINDS.SYNC_STEP2;
  seq: number;
  update: Uint8Array;
};

export type UpdateFrame = {
  kind: typeof FRAME_KINDS.UPDATE;
  seq: number;
  docUpdate: Uint8Array;
  awarenessUpdate: Uint8Array;
};

export type BinaryFrame = SyncStep1Frame | SyncStep2Frame | UpdateFrame;

export class CodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodecError';
  }
}

/**
 * Encodes a binary frame into a Uint8Array using lib0 varints and varBuffers.
 */
export function encodeFrame(frame: BinaryFrame): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, frame.kind);

  switch (frame.kind) {
    case FRAME_KINDS.SYNC_STEP1: {
      encoding.writeVarUint8Array(encoder, frame.stateVector);
      break;
    }
    case FRAME_KINDS.SYNC_STEP2: {
      encoding.writeVarUint(encoder, frame.seq);
      encoding.writeVarUint8Array(encoder, frame.update);
      break;
    }
    case FRAME_KINDS.UPDATE: {
      encoding.writeVarUint(encoder, frame.seq);
      encoding.writeVarUint8Array(encoder, frame.docUpdate);
      encoding.writeVarUint8Array(encoder, frame.awarenessUpdate);
      break;
    }
    default: {
      const _exhaustive: never = frame;
      throw new CodecError(`Unsupported frame kind: ${String(_exhaustive)}`);
    }
  }

  const result = encoding.toUint8Array(encoder);
  if (result.byteLength > MAX_FRAME_BYTES) {
    throw new CodecError(`Encoded frame exceeds MAX_FRAME_BYTES (${result.byteLength} > ${MAX_FRAME_BYTES})`);
  }
  return result;
}

/**
 * Decodes a Uint8Array into a typed BinaryFrame.
 */
export function decodeFrame(buffer: Uint8Array): BinaryFrame {
  if (buffer.byteLength > MAX_FRAME_BYTES) {
    throw new CodecError(`Frame exceeds MAX_FRAME_BYTES (${buffer.byteLength} > ${MAX_FRAME_BYTES})`);
  }

  if (buffer.byteLength === 0) {
    throw new CodecError('Cannot decode empty frame');
  }

  const decoder = decoding.createDecoder(buffer);
  const kind = decoding.readVarUint(decoder);

  switch (kind) {
    case FRAME_KINDS.SYNC_STEP1: {
      const stateVector = decoding.readVarUint8Array(decoder);
      return {
        kind: FRAME_KINDS.SYNC_STEP1,
        stateVector,
      };
    }
    case FRAME_KINDS.SYNC_STEP2: {
      const seq = decoding.readVarUint(decoder);
      const update = decoding.readVarUint8Array(decoder);
      return {
        kind: FRAME_KINDS.SYNC_STEP2,
        seq,
        update,
      };
    }
    case FRAME_KINDS.UPDATE: {
      const seq = decoding.readVarUint(decoder);
      const docUpdate = decoding.readVarUint8Array(decoder);
      const awarenessUpdate = decoding.readVarUint8Array(decoder);
      return {
        kind: FRAME_KINDS.UPDATE,
        seq,
        docUpdate,
        awarenessUpdate,
      };
    }
    default:
      throw new CodecError(`Unknown frame kind: ${kind}`);
  }
}
