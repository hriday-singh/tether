import { DisplayNameSchema, type AuditEvent, type ChatMessage, type RoomMetadata } from '@tether/shared';
import { z } from 'zod';
import { LANGUAGE_IDS } from '../languages';

// Mirrors the docs/05 REST contract. TODO(server M2): move these input schemas into @tether/shared once apps/server defines them.
export const ROOM_ID_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;
export { DisplayNameSchema };
export const RoomIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(ROOM_ID_RE, '3–32 chars: lowercase letters, digits, dashes (not at the ends)');
export const PasscodeSchema = z.string().min(4, 'At least 4 characters').max(64, 'Max 64 characters');

export const CreateRoomInputSchema = z.object({
  name: DisplayNameSchema,
  roomId: RoomIdSchema.optional(),
  passcode: PasscodeSchema.optional(),
  language: z.enum(LANGUAGE_IDS),
});
export type CreateRoomInput = z.infer<typeof CreateRoomInputSchema>;

export const JoinRoomInputSchema = z.object({
  name: DisplayNameSchema,
  passcode: z.string().max(64).optional(),
  memberId: z.string().optional(),
});
export type JoinRoomInput = z.infer<typeof JoinRoomInputSchema>;

export interface RoomInfo {
  id: string;
  hasPasscode: boolean;
  locked: boolean;
  memberCount: number;
  language: string;
}

export interface JoinResult {
  room: RoomMetadata;
  token: string;
  memberId: string;
}

export type AdmissionStatus = 'ok' | 'reauth' | 'banned' | 'locked' | 'full' | 'draining';

export interface EventsQuery {
  before?: number;
  after?: number;
  limit?: number;
}
export interface EventsPage {
  items: AuditEvent[];
  nextBefore: number | null;
  nextAfter: number | null;
}
/** GET /api/rooms/:id/chat, same paging as events (ADR-017). */
export interface ChatPage {
  items: ChatMessage[];
  nextBefore: number | null;
  nextAfter: number | null;
}

export type ApiErrorCode =
  | 'not_found'
  | 'room_taken'
  | 'bad_passcode'
  | 'locked'
  | 'banned'
  | 'full'
  | 'rate_limited'
  | 'invalid'
  | 'unauthorized'
  | 'network';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface Api {
  createRoom(input: CreateRoomInput, idempotencyKey: string): Promise<JoinResult>;
  getRoom(roomId: string): Promise<RoomInfo>;
  joinRoom(roomId: string, input: JoinRoomInput): Promise<JoinResult>;
  events(roomId: string, token: string, query: EventsQuery): Promise<EventsPage>;
  chat(roomId: string, token: string, query: EventsQuery): Promise<ChatPage>;
  admission(roomId: string, token: string): Promise<AdmissionStatus>;
}
