/**
 * Tether Protocol & Sync Constants
 * Single source of truth defined in docs/04-protocol.md
 */

export const PROTOCOL_VERSION = 'collab.v1' as const;

// Throttling & Batching
export const THROTTLE_RATE_PER_SEC = 5;
export const THROTTLE_BURST = 5;
export const CLIENT_BATCH_WINDOW_MS = 200;

// Flood Protection & Limits
export const FLOOD_FRAMES_PER_SEC = 30;
export const FLOOD_WINDOW_SEC = 3;
export const MAX_FRAME_BYTES = 512 * 1024; // 512 KB
export const MAX_DOC_BYTES = 2 * 1024 * 1024; // 2 MB
// Codec bound. Sync/resync frames carry the whole doc, which may overshoot MAX_DOC_BYTES by one update.
// Inbound client frames are still held to MAX_FRAME_BYTES by the server.
export const MAX_SYNC_FRAME_BYTES = MAX_DOC_BYTES + MAX_FRAME_BYTES;
export const MAX_AWARENESS_STATE_BYTES = 2 * 1024; // 2 KB
export const SLOW_CONSUMER_BYTES = 4 * 1024 * 1024; // 4 MB
export const MAX_MEMBERS_PER_ROOM = 32;
export const MAX_CONN_PER_IP = 20;

// Heartbeat & Liveness
export const CLIENT_PING_MS = 5000;
export const CLIENT_DEAD_MS = 12000;
export const SERVER_PING_MS = 15000;
export const WAKE_PROBE_MS = 2000;

// Lifecycle & Persistence
export const HOST_GRACE_MS = 5000;
export const PERSIST_FLUSH_MS = 250;
export const COMPACT_AFTER_ROWS = 500;
export const ROOM_UNLOAD_IDLE_MS = 30000;
/** Rooms with nobody connected for this long are deleted (doc, members, chat, feed). */
export const ROOM_EXPIRE_IDLE_MS = 24 * 60 * 60 * 1000;
export const ROOM_EXPIRE_SWEEP_MS = 60 * 60 * 1000;
export const PERSIST_MAX_QUEUED_PER_ROOM = 64;
export const PERSIST_MAX_BUFFERED_UPDATES = 10000;

// Verification & Feed
export const CHECKSUM_QUIET_MS = 500;
export const FEED_GAP_FILL_MAX = 500;

// Chat (ADR-017). Own bucket per connection, separate from the edit throttle.
export const CHAT_MAX_CHARS = 2000;
export const CHAT_RATE_PER_SEC = 1;
export const CHAT_BURST = 5;
/** Code quoted in a chat message is cut to this many chars; the anchor still covers the full range. */
export const CHAT_REF_SNIPPET_MAX = 500;

// Storm Demo Mode
export const STORM_MAX_BOTS = 8;
export const STORM_MAX_SECONDS = 60;

// WebSocket Close Codes
export const WS_CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  ABNORMAL: 1006,
  RESTART: 1012,
  KICKED: 4003,
  ROOM_DELETED: 4004,
  SLOW_CONSUMER: 4008,
  PROTOCOL_VIOLATION: 4009,
  DOC_TOO_LARGE: 4013,
  FLOOD: 4029,
} as const;

// Binary Frame Kinds
export const FRAME_KINDS = {
  SYNC_STEP1: 0,
  SYNC_STEP2: 1,
  UPDATE: 2,
} as const;
