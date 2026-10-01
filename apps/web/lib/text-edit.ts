import { MAX_FRAME_BYTES } from '@tether/shared/constants';

// The server closes the socket on any client frame over MAX_FRAME_BYTES (docs/03); the margin covers
// Yjs/frame headers and awareness riding in the same frame.
// ponytail: checks one edit; several big edits merged into one send batch can still cross the cap.
const EDIT_LIMIT_BYTES = MAX_FRAME_BYTES - 64 * 1024;

/** True when inserting `text` in one edit would produce a frame the server rejects. */
export function exceedsEditLimit(text: string): boolean {
  if (text.length > EDIT_LIMIT_BYTES) return true; // >= 1 UTF-8 byte per UTF-16 unit
  if (text.length * 3 <= EDIT_LIMIT_BYTES) return false; // <= 3 UTF-8 bytes per UTF-16 unit
  return new TextEncoder().encode(text).byteLength > EDIT_LIMIT_BYTES;
}

/** Smallest single replace turning `prev` into `next`: delete `deleteCount` at `index`, then insert `insert`. */
export function diffText(prev: string, next: string): { index: number; deleteCount: number; insert: string } {
  let start = 0;
  const max = Math.min(prev.length, next.length);
  while (start < max && prev[start] === next[start]) start++;
  let end = 0;
  while (end < max - start && prev[prev.length - 1 - end] === next[next.length - 1 - end]) end++;
  return { index: start, deleteCount: prev.length - start - end, insert: next.slice(start, next.length - end) };
}
