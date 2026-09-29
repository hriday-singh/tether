import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { AwarenessStateSchema } from '@tether/shared/protocol/schemas';
import { WS_CLOSE_CODES } from '@tether/shared/constants';

export class AwarenessBinding {
  private claimedClientID: number | null = null;
  private droppedCount = 0;

  constructor(
    public readonly memberId: string,
    private existingClaimedClientIDs: Map<number, string>
  ) {}

  /**
   * Filters and validates an incoming awareness update buffer.
   * Drops spoofed clientIDs and invalid memberIds.
   * If > 10 dropped entries, returns WS_CLOSE_CODES.PROTOCOL_VIOLATION.
   */
  public filterAwarenessUpdate(update: Uint8Array): {
    validUpdate: Uint8Array | null;
    closeCode: number | null;
  } {
    if (update.byteLength === 0) {
      return { validUpdate: null, closeCode: null };
    }

    try {
      const decoder = decoding.createDecoder(update);
      const encoder = encoding.createEncoder();
      const length = decoding.readVarUint(decoder);

      let validEntriesCount = 0;
      const validEntries: Array<{
        clientID: number;
        clock: number;
        jsonStr: string;
      }> = [];

      for (let i = 0; i < length; i++) {
        const clientID = decoding.readVarUint(decoder);
        const clock = decoding.readVarUint(decoder);
        const jsonStr = decoding.readVarString(decoder);

        // Check 1: Claim clientID on first entry, reject changes or clashes
        if (this.claimedClientID === null) {
          const owner = this.existingClaimedClientIDs.get(clientID);
          if (owner && owner !== this.memberId) {
            this.droppedCount++;
            continue;
          }
          this.claimedClientID = clientID;
          this.existingClaimedClientIDs.set(clientID, this.memberId);
        } else if (clientID !== this.claimedClientID) {
          this.droppedCount++;
          continue;
        }

        // Check 2: Parse JSON state and validate memberId match
        try {
          const raw = JSON.parse(jsonStr);
          if (raw !== null) {
            const parsed = AwarenessStateSchema.parse(raw);
            if (parsed.memberId !== this.memberId) {
              this.droppedCount++;
              continue;
            }
          }
        } catch {
          this.droppedCount++;
          continue;
        }

        validEntries.push({ clientID, clock, jsonStr });
        validEntriesCount++;
      }

      if (this.droppedCount > 10) {
        return { validUpdate: null, closeCode: WS_CLOSE_CODES.PROTOCOL_VIOLATION };
      }

      if (validEntriesCount === 0) {
        return { validUpdate: null, closeCode: null };
      }

      encoding.writeVarUint(encoder, validEntriesCount);
      for (const entry of validEntries) {
        encoding.writeVarUint(encoder, entry.clientID);
        encoding.writeVarUint(encoder, entry.clock);
        encoding.writeVarString(encoder, entry.jsonStr);
      }

      return {
        validUpdate: encoding.toUint8Array(encoder),
        closeCode: null,
      };
    } catch {
      return { validUpdate: null, closeCode: WS_CLOSE_CODES.PROTOCOL_VIOLATION };
    }
  }

  public getClaimedClientID(): number | null {
    return this.claimedClientID;
  }

  public cleanup(): void {
    if (this.claimedClientID !== null) {
      this.existingClaimedClientIDs.delete(this.claimedClientID);
    }
  }
}
