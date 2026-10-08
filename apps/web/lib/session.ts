import { ROOM_EXPIRE_IDLE_MS } from '@tether/shared/constants';
import { z } from 'zod';

const SessionSchema = z.object({ token: z.string(), memberId: z.string(), name: z.string(), epoch: z.string() });
export type RoomSession = z.infer<typeof SessionSchema>;

export interface RecentSession {
  roomId: string;
  name: string;
  lastActive: number;
}
const RecentSessionListSchema = z.array(
  z.object({
    roomId: z.string(),
    name: z.string(),
    lastActive: z.number(),
  }),
);

const key = (roomId: string) => `collab:session:${roomId}`;
const NAME_KEY = 'tether:display-name';
const RECENT_KEY = 'tether:recent-rooms';
export const seedKey = (roomId: string) => `tether:seed:${roomId}`;

function read<T>(k: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const sessions = {
  get: (roomId: string) => read(key(roomId), SessionSchema),
  /** The one room to offer "Continue in"; gone once the server would have expired the room for idleness. */
  last(): RecentSession | null {
    // Older builds stored up to 5 rooms; the newest is first.
    const last = read(RECENT_KEY, RecentSessionListSchema)?.[0];
    return last && Date.now() - last.lastActive < ROOM_EXPIRE_IDLE_MS ? last : null;
  },
  set(roomId: string, s: RoomSession) {
    try {
      localStorage.setItem(key(roomId), JSON.stringify(s));
      localStorage.setItem(NAME_KEY, s.name);
      const recent: RecentSession[] = [{ roomId, name: s.name, lastActive: Date.now() }];
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
      // storage quota or blocked
    }
  },
  clear(roomId: string) {
    try {
      localStorage.removeItem(key(roomId));
      if (this.last()?.roomId === roomId) this.forgetRecent();
    } catch {
      // ignore
    }
  },
  forgetRecent() {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
  },
  lastName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  },
};
