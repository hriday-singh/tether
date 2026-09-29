import * as Y from 'yjs';
import { DatabaseSession } from '@tether/server/db/database';

export const TAG_REGEX = /⟦c\d+#\d+⟧/g;

export function extractTagsFromText(text: string): string[] {
  const matches = text.match(TAG_REGEX);
  return matches ?? [];
}

/**
 * Invariant I1: Convergence
 * All connected client documents and the server document must have identical text.
 */
export function assertI1Convergence(serverDoc: Y.Doc, clientDocs: Y.Doc[]): void {
  const serverText = serverDoc.getText('codemirror').toString();

  for (let i = 0; i < clientDocs.length; i++) {
    const clientText = clientDocs[i]!.getText('codemirror').toString();
    if (clientText !== serverText) {
      throw new Error(
        `Invariant I1 Violation: Client #${i} text does not match server text.\n` +
          `Server length: ${serverText.length}, Client #${i} length: ${clientText.length}\n` +
          `Server text preview: "${serverText.slice(0, 100)}"\n` +
          `Client text preview: "${clientText.slice(0, 100)}"`
      );
    }
  }
}

/**
 * Invariant I2: No Loss
 * Every tag inserted that was not explicitly deleted must exist in the final text.
 */
export function assertI2NoLoss(text: string, activeTags: Set<string>): void {
  const presentTags = new Set(extractTagsFromText(text));

  const missing: string[] = [];
  for (const tag of activeTags) {
    if (!presentTags.has(tag)) {
      missing.push(tag);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Invariant I2 Violation (Data Loss): ${missing.length} active tag(s) missing from final text.\n` +
        `Missing tags (up to 10): ${missing.slice(0, 10).join(', ')}\n` +
        `Final text: "${text}"`
    );
  }
}

/**
 * Invariant I3: No Duplication
 * No tag appears more than once in the converged text.
 */
export function assertI3NoDuplication(text: string): void {
  const tags = extractTagsFromText(text);
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const tag of tags) {
    if (seen.has(tag)) {
      duplicates.push(tag);
    }
    seen.add(tag);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `Invariant I3 Violation (Duplication): ${duplicates.length} tag(s) appeared more than once.\n` +
        `Duplicates: ${duplicates.slice(0, 10).join(', ')}`
    );
  }
}

/**
 * Invariant I4: Throttle Bound
 * No single connection source causes peers to receive more than 5 broadcast frames in any sliding 1000ms window.
 */
export function assertI4ThrottleBound(
  broadcastTimestampsPerSource: Map<string, number[]>,
  maxPerSecond = 5
): void {
  for (const [sourceId, timestamps] of broadcastTimestampsPerSource.entries()) {
    if (timestamps.length <= maxPerSecond) continue;

    const sorted = [...timestamps].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      let windowEndIndex = i;
      while (
        windowEndIndex < sorted.length &&
        sorted[windowEndIndex]! - sorted[i]! < 1000
      ) {
        windowEndIndex++;
      }
      const count = windowEndIndex - i;
      if (count > maxPerSecond) {
        throw new Error(
          `Invariant I4 Violation (Throttle Bound): Source '${sourceId}' emitted ${count} frames in <1000ms ` +
            `window (${sorted[i]}ms to ${sorted[windowEndIndex - 1]}ms, max allowed is ${maxPerSecond}).`
        );
      }
    }
  }
}

/**
 * Invariant I6 / Durability: All acks received
 * All client updates have been acked by server persistence.
 */
export function assertDurabilityAndAcks(
  clients: { unackedCount: number }[]
): void {
  for (let i = 0; i < clients.length; i++) {
    const unacked = clients[i]!.unackedCount;
    if (unacked > 0) {
      throw new Error(
        `Invariant I6 Violation: Client #${i} still has ${unacked} unacknowledged sequence(s).`
      );
    }
  }
}

/**
 * Database Rehydration Check:
 * A freshly created Y.Doc replaying the snapshot + tail updates from SQLite matches the converged server doc.
 */
export function assertDbReloadMatch(
  serverDoc: Y.Doc,
  db: DatabaseSession,
  roomId: string
): void {
  const roomRow = db
    .prepare<{ snapshot: Uint8Array | null }>(
      'SELECT snapshot FROM rooms WHERE id = ?'
    )
    .get(roomId);

  if (!roomRow) {
    throw new Error(`Room '${roomId}' not found in database.`);
  }

  const updateRows = db
    .prepare<{ update_data: Uint8Array }>(
      'SELECT update_data FROM room_updates WHERE room_id = ? ORDER BY id ASC'
    )
    .all(roomId);

  const reloadedDoc = new Y.Doc();
  if (roomRow.snapshot && roomRow.snapshot.byteLength > 0) {
    Y.applyUpdate(reloadedDoc, roomRow.snapshot);
  }
  for (const row of updateRows) {
    if (row.update_data && row.update_data.byteLength > 0) {
      Y.applyUpdate(reloadedDoc, row.update_data);
    }
  }

  const serverText = serverDoc.getText('codemirror').toString();
  const reloadedText = reloadedDoc.getText('codemirror').toString();

  if (reloadedText !== serverText) {
    throw new Error(
      `Database Rehydration Mismatch: Text restored from DB does not match in-memory server doc.\n` +
        `Server length: ${serverText.length}, DB length: ${reloadedText.length}\n` +
        `Server text: "${serverText}"\n` +
        `DB text:     "${reloadedText}"`
    );
  }

  reloadedDoc.destroy();
}

/**
 * Checksum Invariant:
 * Connected clients in quiet state have matching checksum and verified 'synced' state.
 */
export function assertQuietChecksumVerified(
  clients: { currentSyncState: string }[]
): void {
  for (let i = 0; i < clients.length; i++) {
    const state = clients[i]!.currentSyncState;
    if (state !== 'synced') {
      throw new Error(
        `Quiet Checksum Violation: Client #${i} is in state '${state}', expected 'synced'.`
      );
    }
  }
}
