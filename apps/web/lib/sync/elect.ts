import type { Member } from '@tether/shared';

/**
 * Host election: the longest-present active human wins, with ties broken by id. The function is pure, so every tab
 * computes the same answer. TODO(server M7): the server's electHost becomes the authority, and this remains the fake's copy.
 */
export function electHost(members: readonly Member[], exclude?: string): string | null {
  const candidates = members.filter((m) => m.id !== exclude && !m.isBot && m.status !== 'reconnecting');
  candidates.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}
