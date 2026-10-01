import { CHAT_REF_SNIPPET_MAX, type ChatCodeRef } from '@tether/shared';
import * as Y from 'yjs';

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

const lineOf = (text: string, pos: number) => text.slice(0, pos).split('\n').length;

/**
 * Quote [from, to) of the shared doc for chat. Anchors are Yjs relative positions, so the range keeps
 * pointing at the same code while people edit around it.
 */
export function makeCodeRef(ytext: Y.Text, from: number, to: number): ChatCodeRef {
  const text = ytext.toString();
  // A trailing newline in the selection belongs to the previous line, not the next.
  const end = to > from && text[to - 1] === '\n' ? to - 1 : to;
  const rel = (pos: number, assoc: number) => toB64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, pos, assoc)));
  return {
    // assoc 0 / -1: text typed right at either edge stays outside the range.
    from: rel(from, 0),
    to: rel(to, -1),
    line: lineOf(text, from),
    endLine: lineOf(text, end),
    snippet: text.slice(from, to).slice(0, CHAT_REF_SNIPPET_MAX),
  };
}

/** Current [from, to) of a ref, or null when the code was deleted or the anchors are unreadable. */
export function resolveCodeRef(ytext: Y.Text, ref: ChatCodeRef): { from: number; to: number } | null {
  const doc = ytext.doc;
  if (!doc) return null;
  try {
    const abs = (b64: string) => Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(fromB64(b64)), doc);
    const a = abs(ref.from);
    const b = abs(ref.to);
    if (!a || !b || a.type !== ytext || b.type !== ytext || b.index <= a.index) return null;
    return { from: a.index, to: b.index };
  } catch {
    return null;
  }
}

export const codeRefLabel = (ref: Pick<ChatCodeRef, 'line' | 'endLine'>) =>
  ref.line === ref.endLine ? `L${ref.line}` : `L${ref.line}–${ref.endLine}`;
