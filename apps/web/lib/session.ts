import { z } from 'zod';

const SessionSchema = z.object({ token: z.string(), memberId: z.string(), name: z.string(), epoch: z.string() });
export type RoomSession = z.infer<typeof SessionSchema>;

const key = (roomId: string) => `collab:session:${roomId}`;
const NAME_KEY = 'tether:display-name';

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
  set(roomId: string, s: RoomSession) {
    localStorage.setItem(key(roomId), JSON.stringify(s));
    localStorage.setItem(NAME_KEY, s.name);
  },
  clear: (roomId: string) => localStorage.removeItem(key(roomId)),
  lastName: () => {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  },
};
