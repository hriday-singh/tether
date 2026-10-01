import { z } from 'zod';
import { CHAT_MAX_CHARS, CHAT_REF_SNIPPET_MAX, MAX_AWARENESS_STATE_BYTES, STORM_MAX_BOTS, STORM_MAX_SECONDS } from '../constants.js';

// --- Shared Primitive Schemas ---

// Control, bidi-override and zero-width characters can spoof or garble names in the member list (docs/05).
const NAME_STRIP_RE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/gu;
export const DISPLAY_NAME_MAX = 32;
export const DisplayNameSchema = z
  .string()
  .transform((s) => s.replace(NAME_STRIP_RE, '').trim())
  .pipe(z.string().min(1, 'Enter a display name').max(DISPLAY_NAME_MAX, `Max ${DISPLAY_NAME_MAX} characters`));

export const MemberStatusSchema = z.enum(['active', 'idle', 'away', 'reconnecting']);
export type MemberStatus = z.infer<typeof MemberStatusSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(50),
  colorIndex: z.number().int().min(0),
  joinedAt: z.string(),
  status: MemberStatusSchema,
  isHost: z.boolean(),
  isBot: z.boolean(),
});
export type Member = z.infer<typeof MemberSchema>;

export const RoomMetadataSchema = z.object({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/),
  language: z.string().min(1).max(50),
  locked: z.boolean(),
  hasPasscode: z.boolean(),
  epoch: z.string().uuid(),
});
export type RoomMetadata = z.infer<typeof RoomMetadataSchema>;

export const AuditEventSchema = z.object({
  id: z.number().int().positive(),
  roomId: z.string(),
  seq: z.number().int().positive(),
  type: z.string(),
  actorMemberId: z.string().nullable(),
  actorName: z.string().nullable(),
  payload: z.record(z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * A code range quoted in chat. `from`/`to` are base64 Y.RelativePosition so the range follows later edits;
 * lines and snippet are what the author saw (label + fallback when the code is gone).
 */
export const ChatCodeRefSchema = z.object({
  from: z.string().min(1).max(256),
  to: z.string().min(1).max(256),
  line: z.number().int().positive(),
  endLine: z.number().int().positive(),
  snippet: z.string().max(CHAT_REF_SNIPPET_MAX),
});
export type ChatCodeRef = z.infer<typeof ChatCodeRefSchema>;

export const ChatMessageSchema = z.object({
  id: z.number().int().positive(),
  roomId: z.string(),
  seq: z.number().int().positive(),
  clientMsgId: z.string().uuid(),
  memberId: z.string(),
  name: z.string(),
  colorIndex: z.number().int().min(0),
  text: z.string().min(1).max(CHAT_MAX_CHARS),
  ref: ChatCodeRefSchema.nullable().default(null),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Relative Position schema matching Yjs RelativePosition JSON
export const RelPosSchema = z.object({
  type: z.unknown().nullable().optional(),
  tname: z.string().nullable().optional(),
  item: z.unknown().nullable().optional(),
  assoc: z.number().optional(),
});
export type RelPos = z.infer<typeof RelPosSchema>;

export const AwarenessStateSchema = z
  .object({
    memberId: z.string().min(1),
    cursor: z
      .object({
        anchor: RelPosSchema,
        head: RelPosSchema,
      })
      .nullable(),
    highlight: z
      .object({
        from: RelPosSchema,
        to: RelPosSchema,
      })
      .nullable(),
    typing: z.boolean(),
    status: z.enum(['active', 'idle', 'away']),
  })
  .passthrough()
  .refine(
    (data) => JSON.stringify(data).length <= MAX_AWARENESS_STATE_BYTES,
    `Awareness state exceeds ${MAX_AWARENESS_STATE_BYTES} bytes`
  );
export type AwarenessState = z.infer<typeof AwarenessStateSchema>;

// --- Client -> Server Control Messages ---

export const ClientPingSchema = z.object({
  t: z.literal('ping'),
  id: z.number(),
  ts: z.number(),
});

export const ClientLeaveSchema = z.object({
  t: z.literal('leave'),
});

export const ClientHostKickSchema = z.object({
  t: z.literal('host.kick'),
  rid: z.string().uuid(),
  memberId: z.string().min(1),
});

export const ClientHostLockSchema = z.object({
  t: z.literal('host.lock'),
  rid: z.string().uuid(),
  locked: z.boolean(),
});

export const ClientHostPasscodeSchema = z.object({
  t: z.literal('host.passcode'),
  rid: z.string().uuid(),
  passcode: z.string().min(4).max(64).nullable(),
});

export const ClientHostTransferSchema = z.object({
  t: z.literal('host.transfer'),
  rid: z.string().uuid(),
  memberId: z.string().min(1),
});

export const ClientRoomLanguageSchema = z.object({
  t: z.literal('room.language'),
  rid: z.string().uuid(),
  language: z.string().min(1).max(50),
});

export const ClientVerifyMismatchSchema = z.object({
  t: z.literal('verify.mismatch'),
  sv: z.string(),
  hash: z.string(),
});

export const ClientDemoStormSchema = z.object({
  t: z.literal('demo.storm'),
  rid: z.string().uuid(),
  bots: z.number().int().min(1).max(STORM_MAX_BOTS),
  seconds: z.number().int().min(1).max(STORM_MAX_SECONDS),
  faults: z.boolean(),
});

export const ClientDemoStormStopSchema = z.object({
  t: z.literal('demo.storm_stop'),
  rid: z.string().uuid(),
});

// rid doubles as the message's idempotency key: a resend after reconnect returns the stored message.
export const ClientChatSendSchema = z.object({
  t: z.literal('chat.send'),
  rid: z.string().uuid(),
  text: z.string().trim().min(1).max(CHAT_MAX_CHARS),
  ref: ChatCodeRefSchema.optional(),
});

export const ClientControlMessageSchema = z.discriminatedUnion('t', [
  ClientPingSchema,
  ClientLeaveSchema,
  ClientHostKickSchema,
  ClientHostLockSchema,
  ClientHostPasscodeSchema,
  ClientHostTransferSchema,
  ClientRoomLanguageSchema,
  ClientVerifyMismatchSchema,
  ClientDemoStormSchema,
  ClientDemoStormStopSchema,
  ClientChatSendSchema,
]);
export type ClientControlMessage = z.infer<typeof ClientControlMessageSchema>;

// --- Server -> Client Control Messages ---

export const ServerWelcomeSchema = z.object({
  t: z.literal('welcome'),
  self: MemberSchema,
  members: z.array(MemberSchema),
  hostId: z.string().nullable(),
  room: RoomMetadataSchema,
  token: z.string(),
  eventSeq: z.number().int().nonnegative(),
  chatSeq: z.number().int().nonnegative().default(0),
});

export const ServerPongSchema = z.object({
  t: z.literal('pong'),
  id: z.number(),
  ts: z.number(),
  serverQueueMs: z.number(),
});

export const ServerAckSchema = z.object({
  t: z.literal('ack'),
  seq: z.number().int().positive(),
});

export const ServerMemberJoinedSchema = z.object({
  t: z.literal('member.joined'),
  member: MemberSchema,
});

export const ServerMemberLeftSchema = z.object({
  t: z.literal('member.left'),
  memberId: z.string(),
  reason: z.enum(['leave', 'timeout', 'kicked']),
});

export const ServerMemberStatusSchema = z.object({
  t: z.literal('member.status'),
  memberId: z.string(),
  status: MemberStatusSchema,
});

export const ServerHostChangedSchema = z.object({
  t: z.literal('host.changed'),
  hostId: z.string().nullable(),
  reason: z.enum(['creator', 'handover-leave', 'handover-timeout', 'manual']),
});

export const ServerRoomUpdatedSchema = z.object({
  t: z.literal('room.updated'),
  settings: z.object({
    locked: z.boolean().optional(),
    hasPasscode: z.boolean().optional(),
    language: z.string().optional(),
  }),
});

export const ServerEventSchema = z.object({
  t: z.literal('event'),
  event: AuditEventSchema,
});

export const ServerThrottledSchema = z.object({
  t: z.literal('throttled'),
  windowMs: z.number(),
});

export const ServerTokenSchema = z.object({
  t: z.literal('token'),
  token: z.string(),
});

export const ServerErrorSchema = z.object({
  t: z.literal('error'),
  code: z.string(),
  message: z.string(),
  rid: z.string().uuid().optional(),
});

export const ServerOkSchema = z.object({
  t: z.literal('ok'),
  rid: z.string().uuid(),
});

export const ServerChecksumSchema = z.object({
  t: z.literal('checksum'),
  sv: z.string(),
  hash: z.string(),
});

export const ServerChatMsgSchema = z.object({
  t: z.literal('chat.msg'),
  message: ChatMessageSchema,
});

export const ServerControlMessageSchema = z.discriminatedUnion('t', [
  ServerWelcomeSchema,
  ServerPongSchema,
  ServerAckSchema,
  ServerMemberJoinedSchema,
  ServerMemberLeftSchema,
  ServerMemberStatusSchema,
  ServerHostChangedSchema,
  ServerRoomUpdatedSchema,
  ServerEventSchema,
  ServerThrottledSchema,
  ServerTokenSchema,
  ServerErrorSchema,
  ServerOkSchema,
  ServerChecksumSchema,
  ServerChatMsgSchema,
]);
export type ServerControlMessage = z.infer<typeof ServerControlMessageSchema>;

// REST Standard Error Response Schema
export const StandardErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type StandardErrorResponse = z.infer<typeof StandardErrorResponseSchema>;
