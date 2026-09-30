import type { AuditEvent, ChatMessage } from '@tether/shared';
import { randomId } from '../utils';

/**
 * ponytail: in-browser stand-in for apps/server state (rooms, members, audit log), kept in localStorage.
 * Read-modify-write is not atomic across tabs. Fine for a local demo; the real server owns this state.
 */
export interface FakeMember {
  name: string;
  colorIndex: number;
  joinedAt: string;
  isBot: boolean;
  token: string;
}

export interface FakeRoom {
  id: string;
  language: string;
  locked: boolean;
  passcodeHash: string | null;
  passcodeVersion: number;
  epoch: string;
  createdAt: string;
  hostId: string | null;
  members: Record<string, FakeMember>;
  banned: string[];
  nextColor: number;
  eventSeq: number;
  /** Absent on rooms created before chat existed. */
  chatSeq?: number;
  idempotencyKey: string | null;
}

const ROOMS_KEY = 'tether:fake:rooms';
const eventsKey = (roomId: string) => `tether:fake:events:${roomId}`;
const chatKey = (roomId: string) => `tether:fake:chat:${roomId}`;
const MAX_EVENTS = 2000;

function readRooms(): Record<string, FakeRoom> {
  try {
    return JSON.parse(localStorage.getItem(ROOMS_KEY) ?? '{}') as Record<string, FakeRoom>;
  } catch {
    return {};
  }
}

export const registry = {
  get(roomId: string): FakeRoom | null {
    return readRooms()[roomId] ?? null;
  },
  put(room: FakeRoom): void {
    const rooms = readRooms();
    rooms[room.id] = room;
    localStorage.setItem(ROOMS_KEY, JSON.stringify(rooms));
  },
  mutate(roomId: string, fn: (room: FakeRoom) => void): FakeRoom | null {
    const room = registry.get(roomId);
    if (!room) return null;
    fn(room);
    registry.put(room);
    return room;
  },
  findByIdempotencyKey(key: string): FakeRoom | null {
    return Object.values(readRooms()).find((r) => r.idempotencyKey === key) ?? null;
  },
  events(roomId: string): AuditEvent[] {
    try {
      return JSON.parse(localStorage.getItem(eventsKey(roomId)) ?? '[]') as AuditEvent[];
    } catch {
      return [];
    }
  },
  /** Assigns the next gapless per-room seq and appends (docs/04 feed delivery). */
  appendEvent(
    roomId: string,
    type: string,
    actor: { id: string; name: string } | null,
    payload: Record<string, unknown> = {},
  ): AuditEvent | null {
    const room = registry.mutate(roomId, (r) => {
      r.eventSeq += 1;
    });
    if (!room) return null;
    const event: AuditEvent = {
      id: room.eventSeq,
      roomId,
      seq: room.eventSeq,
      type,
      actorMemberId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      payload,
      createdAt: new Date().toISOString(),
    };
    const all = registry.events(roomId);
    all.push(event);
    localStorage.setItem(eventsKey(roomId), JSON.stringify(all.slice(-MAX_EVENTS)));
    return event;
  },
  chat(roomId: string): ChatMessage[] {
    try {
      return JSON.parse(localStorage.getItem(chatKey(roomId)) ?? '[]') as ChatMessage[];
    } catch {
      return [];
    }
  },
  /** Gapless per-room chat seq. Same clientMsgId twice returns the stored message (resend is a no-op). */
  appendChat(
    roomId: string,
    msg: Omit<ChatMessage, 'id' | 'roomId' | 'seq' | 'createdAt'>,
  ): { message: ChatMessage; created: boolean } | null {
    const all = registry.chat(roomId);
    const existing = all.find((m) => m.clientMsgId === msg.clientMsgId);
    if (existing) return { message: existing, created: false };
    const room = registry.mutate(roomId, (r) => {
      r.chatSeq = (r.chatSeq ?? 0) + 1;
    });
    if (!room?.chatSeq) return null;
    const message: ChatMessage = { ...msg, id: room.chatSeq, roomId, seq: room.chatSeq, createdAt: new Date().toISOString() };
    all.push(message);
    localStorage.setItem(chatKey(roomId), JSON.stringify(all.slice(-MAX_EVENTS)));
    return { message, created: true };
  },
  newRoom(id: string, language: string, passcodeHash: string | null, idempotencyKey: string | null): FakeRoom {
    return {
      id,
      language,
      locked: false,
      passcodeHash,
      passcodeVersion: 1,
      epoch: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      hostId: null,
      members: {},
      banned: [],
      nextColor: 0,
      eventSeq: 0,
      chatSeq: 0,
      idempotencyKey,
    };
  },
  newToken: () => `fake.${randomId(16)}`,
};

export async function hashPasscode(roomId: string, passcode: string): Promise<string> {
  // ponytail: SHA-256 is fine for the in-browser fake. The server uses scrypt (docs/05).
  const data = new TextEncoder().encode(`${roomId}:${passcode}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Duplicate display names get a numeric suffix: "Ravi", "Ravi (2)". */
export function uniqueName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  let n = 2;
  while (taken.includes(`${name} (${n})`)) n += 1;
  return `${name} (${n})`;
}
