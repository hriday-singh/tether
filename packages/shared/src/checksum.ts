import * as Y from 'yjs';

/**
 * Checks whether two Yjs state vectors represent the exact same state,
 * regardless of the order in which clientIDs are encoded in the binary buffer.
 */
export function areStateVectorsEqual(sv1: Uint8Array, sv2: Uint8Array): boolean {
  if (sv1.byteLength === sv2.byteLength) {
    let exactMatch = true;
    for (let i = 0; i < sv1.byteLength; i++) {
      if (sv1[i] !== sv2[i]) {
        exactMatch = false;
        break;
      }
    }
    if (exactMatch) {
      return true;
    }
  }

  const map1 = Y.decodeStateVector(sv1);
  const map2 = Y.decodeStateVector(sv2);

  if (map1.size !== map2.size) {
    return false;
  }

  for (const [clientId, clock] of map1.entries()) {
    if (map2.get(clientId) !== clock) {
      return false;
    }
  }

  return true;
}

/**
 * Computes a deterministic 32-bit FNV-1a hash of a UTF-8 string,
 * returned as an 8-character hex string.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
