import { MAX_MEMBERS_PER_ROOM } from '@tether/shared';
import {
  ApiError,
  CreateRoomInputSchema,
  JoinRoomInputSchema,
  type AdmissionStatus,
  type Api,
  type CreateRoomInput,
  type EventsPage,
  type EventsQuery,
  type JoinRoomInput,
  type JoinResult,
  type RoomInfo,
} from '../api/types';
import { randomId } from '../utils';
import { hashPasscode, registry, uniqueName, type FakeRoom } from './registry';

const networkDelay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

function metadata(room: FakeRoom): JoinResult['room'] {
  return {
    id: room.id,
    language: room.language,
    locked: room.locked,
    hasPasscode: room.passcodeHash !== null,
    epoch: room.epoch,
  };
}

export function suggestRoomId(base: string): string {
  const stem = base.slice(0, 27).replace(/-+$/, '') || 'room';
  for (;;) {
    const candidate = `${stem}-${Math.floor(Math.random() * 900 + 100)}`;
    if (!registry.get(candidate)) return candidate;
  }
}

function admit(room: FakeRoom, name: string, memberId?: string): JoinResult {
  const existing = memberId ? room.members[memberId] : undefined;
  if (memberId && existing) {
    existing.token = registry.newToken();
    registry.put(room);
    return { room: metadata(room), token: existing.token, memberId };
  }
  const id = `m_${randomId(6)}`;
  const taken = Object.values(room.members).map((m) => m.name);
  room.members[id] = {
    name: uniqueName(name, taken),
    colorIndex: room.nextColor % 8,
    joinedAt: new Date().toISOString(),
    isBot: false,
    token: registry.newToken(),
  };
  room.nextColor += 1;
  if (!room.hostId) room.hostId = id;
  registry.put(room);
  return { room: metadata(room), token: room.members[id]!.token, memberId: id };
}

function requireRoom(roomId: string): FakeRoom {
  const room = registry.get(roomId);
  if (!room) throw new ApiError(404, 'not_found', `Room "${roomId}" does not exist or has expired.`);
  return room;
}

export const fakeApi: Api = {
  async createRoom(input: CreateRoomInput, idempotencyKey: string) {
    await networkDelay();
    const parsed = CreateRoomInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'invalid', parsed.error.issues[0]?.message ?? 'Invalid input');
    const data = parsed.data;
    const replay = registry.findByIdempotencyKey(idempotencyKey);
    const creator = replay?.hostId ? replay.members[replay.hostId] : undefined;
    if (replay && creator) return { room: metadata(replay), token: creator.token, memberId: replay.hostId! };

    const id = data.roomId ?? suggestRoomId('room');
    if (registry.get(id)) {
      throw new ApiError(409, 'room_taken', `Room "${id}" is taken.`, { suggestion: suggestRoomId(id) });
    }
    const hash = data.passcode ? await hashPasscode(id, data.passcode) : null;
    registry.put(registry.newRoom(id, data.language, hash, idempotencyKey));
    const result = admit(requireRoom(id), data.name);
    registry.appendEvent(id, 'room.created', { id: result.memberId, name: data.name }, {
      language: data.language,
      hasPasscode: hash !== null,
    });
    return result;
  },

  async getRoom(roomId: string): Promise<RoomInfo> {
    await networkDelay();
    const room = requireRoom(roomId);
    return {
      id: room.id,
      hasPasscode: room.passcodeHash !== null,
      locked: room.locked,
      memberCount: Object.values(room.members).filter((m) => !m.isBot).length,
      language: room.language,
    };
  },

  async joinRoom(roomId: string, input: JoinRoomInput) {
    await networkDelay();
    const parsed = JoinRoomInputSchema.safeParse(input);
    if (!parsed.success) throw new ApiError(400, 'invalid', parsed.error.issues[0]?.message ?? 'Invalid input');
    const data = parsed.data;
    const room = requireRoom(roomId);
    if (data.memberId && room.banned.includes(data.memberId)) {
      throw new ApiError(403, 'banned', 'The host removed you from this room.');
    }
    const returning = data.memberId !== undefined && room.members[data.memberId] !== undefined;
    if (!returning && room.locked) {
      throw new ApiError(423, 'locked', 'The host has locked this room. Please request access from the host.');
    }
    if (room.passcodeHash && !returning) {
      const ok = data.passcode ? (await hashPasscode(roomId, data.passcode)) === room.passcodeHash : false;
      if (!ok) throw new ApiError(401, 'bad_passcode', 'That passcode is not right.');
    }
    if (!returning && Object.keys(room.members).length >= MAX_MEMBERS_PER_ROOM) {
      throw new ApiError(503, 'full', 'This room is full.');
    }
    return admit(room, data.name, returning ? data.memberId : undefined);
  },

  async events(roomId: string, token: string, q: EventsQuery): Promise<EventsPage> {
    await networkDelay();
    const room = requireRoom(roomId);
    if (!Object.values(room.members).some((m) => m.token === token)) {
      throw new ApiError(401, 'unauthorized', 'Session expired');
    }
    const limit = Math.min(q.limit ?? 50, 100);
    const all = registry.events(roomId);
    if (q.after !== undefined) {
      const after = q.after;
      const items = all.filter((e) => e.seq > after).slice(0, limit);
      const last = items.at(-1);
      return { items, nextBefore: null, nextAfter: items.length === limit && last ? last.seq : null };
    }
    const before = q.before ?? Number.POSITIVE_INFINITY;
    const items = all
      .filter((e) => e.seq < before)
      .slice(-limit)
      .reverse();
    const oldest = items.at(-1);
    return { items, nextBefore: oldest && oldest.seq > 1 ? oldest.seq : null, nextAfter: null };
  },

  async admission(roomId: string, token: string): Promise<AdmissionStatus> {
    const room = requireRoom(roomId);
    const entry = Object.entries(room.members).find(([, m]) => m.token === token);
    if (!entry) return room.locked ? 'locked' : 'reauth';
    return room.banned.includes(entry[0]) ? 'banned' : 'ok';
  },
};
