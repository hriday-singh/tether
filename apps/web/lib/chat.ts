import type { ChatMessage } from '@tether/shared';

/** Messages by the same author closer than this share one header (avatar + name). */
export const CHAT_GROUP_MS = 5 * 60_000;
/** Show the character counter once a draft gets this close to CHAT_MAX_CHARS. */
export const CHAT_COUNTER_FROM = 200;

/** A message typed locally that the server has not confirmed yet. */
export interface PendingChat {
  clientMsgId: string;
  text: string;
  createdAt: string;
  state: 'sending' | 'failed';
  /** CommandError code when failed ('rate_limited', 'offline', ...). */
  error?: string;
}

export interface ChatRowView {
  clientMsgId: string;
  memberId: string;
  name: string;
  colorIndex: number;
  text: string;
  createdAt: string;
  state: 'sent' | 'sending' | 'failed';
  error?: string;
  /** First row of a run by one author within CHAT_GROUP_MS: render avatar + name. */
  head: boolean;
}

/**
 * Confirmed messages (newest first, from FeedStore) plus local pending ones (oldest first) become render rows,
 * newest first for a `flex-col-reverse` list. A pending message disappears as soon as its clientMsgId is confirmed.
 */
export function buildChatRows(
  confirmed: readonly ChatMessage[],
  pending: readonly PendingChat[],
  self: { id: string; name: string; colorIndex: number },
): ChatRowView[] {
  const sentIds = new Set(confirmed.map((m) => m.clientMsgId));
  const oldestFirst: Omit<ChatRowView, 'head'>[] = [
    ...[...confirmed].reverse().map((m) => ({ ...m, state: 'sent' as const })),
    ...pending
      .filter((p) => !sentIds.has(p.clientMsgId))
      .map((p) => ({ ...p, memberId: self.id, name: self.name, colorIndex: self.colorIndex })),
  ];
  return oldestFirst
    .map((row, i) => {
      const prev = oldestFirst[i - 1];
      const head =
        !prev ||
        prev.memberId !== row.memberId ||
        Date.parse(row.createdAt) - Date.parse(prev.createdAt) > CHAT_GROUP_MS;
      return { ...row, head };
    })
    .reverse();
}
