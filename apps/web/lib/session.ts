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
  recent(): RecentSession[] {
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (raw !== null) {
        const parsed = RecentSessionListSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      }
      // Discover any existing session keys in storage if RECENT_KEY has never been initialized
      const discovered: RecentSession[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('collab:session:')) {
          const rId = k.replace('collab:session:', '');
          const s = this.get(rId);
          if (s) {
            discovered.push({ roomId: rId, name: s.name, lastActive: Date.now() });
          }
        }
      }
      return discovered;
    } catch {
      return [];
    }
  },
  last(): RecentSession | null {
    const list = this.recent();
    return list[0] ?? null;
  },
  set(roomId: string, s: RoomSession) {
    try {
      localStorage.setItem(key(roomId), JSON.stringify(s));
      localStorage.setItem(NAME_KEY, s.name);
      const existing = this.recent().filter((r) => r.roomId !== roomId);
      const updated: RecentSession[] = [{ roomId, name: s.name, lastActive: Date.now() }, ...existing].slice(0, 5);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {
      // storage quota or blocked
    }
  },
  clear(roomId: string) {
    try {
      localStorage.removeItem(key(roomId));
      this.forgetRecent(roomId);
    } catch {
      // ignore
    }
  },
  forgetRecent(roomId?: string) {
    try {
      if (roomId) {
        const remaining = this.recent().filter((r) => r.roomId !== roomId);
        localStorage.setItem(RECENT_KEY, JSON.stringify(remaining));
      } else {
        localStorage.setItem(RECENT_KEY, JSON.stringify([]));
      }
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
