import { BinaryFrame } from '@tether/shared/protocol/codec';
import { FRAME_KINDS, WS_CLOSE_CODES } from '@tether/shared/constants';

export class ProtocolGuard {
  private hasStep1 = false;
  private hasStep2 = false;
  private lastSeq = 0;

  /**
   * Validates inbound binary frame against the collab wire protocol invariants:
   * 1. The first frame must be SYNC_STEP1.
   * 2. Exactly one SYNC_STEP1 and one SYNC_STEP2 are permitted per connection during handshake.
   * 3. UPDATE frames can only be sent once handshake is complete (both step1 and step2 received).
   * 4. UPDATE sequence numbers must be strictly increasing (seq > lastSeq).
   *
   * Returns a WS close code on violation, or null if valid.
   */
  public checkFrame(frame: BinaryFrame): number | null {
    switch (frame.kind) {
      case FRAME_KINDS.SYNC_STEP1: {
        if (this.hasStep1) {
          return WS_CLOSE_CODES.PROTOCOL_VIOLATION;
        }
        this.hasStep1 = true;
        return null;
      }
      case FRAME_KINDS.SYNC_STEP2: {
        if (!this.hasStep1 || this.hasStep2) {
          return WS_CLOSE_CODES.PROTOCOL_VIOLATION;
        }
        this.hasStep2 = true;
        return null;
      }
      case FRAME_KINDS.UPDATE: {
        if (!this.hasStep1 || !this.hasStep2) {
          return WS_CLOSE_CODES.PROTOCOL_VIOLATION;
        }
        if (frame.seq <= this.lastSeq) {
          return WS_CLOSE_CODES.PROTOCOL_VIOLATION;
        }
        this.lastSeq = frame.seq;
        return null;
      }
      default: {
        return WS_CLOSE_CODES.PROTOCOL_VIOLATION;
      }
    }
  }

  public isHandshakeComplete(): boolean {
    return this.hasStep1 && this.hasStep2;
  }
}
