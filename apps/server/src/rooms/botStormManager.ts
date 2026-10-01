import crypto from 'node:crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SyncClient } from '@tether/sync-client';
import { FaultyWebSocket } from '@tether/sync-client/testing';
import { areStateVectorsEqual, hashString } from '@tether/shared/checksum';
import { JoinService } from '../services/joinService.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { AuditService } from '../services/auditService.js';
import { ChatService } from '../services/chatService.js';
import { RoomRegistry } from './roomRegistry.js';

export interface BotStormDependencies {
  joinService: JoinService;
  memberRepo: MemberRepo;
  roomRepo: RoomRepo;
  auditService: AuditService;
  roomRegistry: RoomRegistry;
  chatService?: ChatService;
}

export interface StartStormOptions {
  roomId: string;
  hostMemberId: string;
  bots: number;
  seconds: number;
  faults: boolean;
  port: number;
}

interface ActiveBot {
  memberId: string;
  name: string;
  colorIndex: number;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  client: SyncClient;
  undoManager: Y.UndoManager;
  hasChatted: boolean;
}

interface ActiveStorm {
  roomId: string;
  bots: ActiveBot[];
  typingTimers: Set<NodeJS.Timeout>;
  stopTimer: NodeJS.Timeout | null;
  stopped: boolean;
  /** Bot edits applied during the storm (server-side count, all bots). */
  ops: number;
  startedAt: number;
  stop: () => Promise<void>;
}

export interface CollabPersona {
  name: string;
  role: string;
  colorIndex: number;
}

export const COLLAB_PERSONAS: CollabPersona[] = [
  { name: 'Alex Chen', role: 'Feature Lead', colorIndex: 0 },
  { name: 'Sarah Jenkins', role: 'Backend Engineer', colorIndex: 2 },
  { name: 'Elena Rostova', role: 'Systems Engineer', colorIndex: 4 },
  { name: 'Marcus Vance', role: 'Frontend Engineer', colorIndex: 6 },
  { name: 'Kenji Sato', role: 'Quality & Testing', colorIndex: 8 },
  { name: 'Priya Sharma', role: 'Full Stack Engineer', colorIndex: 10 },
  { name: 'David Kim', role: 'Reliability Engineer', colorIndex: 1 },
  { name: 'Chloe Dupont', role: 'UI Engineer', colorIndex: 3 },
];

interface CodeSnippet {
  code: string;
  comment: string;
  chatStatus: string;
}

/** Per-role action distribution so bots visually do different things. `code` = threshold for code authoring, `review` = threshold for review (remainder = comment). */
interface ActionWeights { code: number; review: number }
const ROLE_WEIGHTS: Record<string, ActionWeights> = {
  'Feature Lead':       { code: 0.75, review: 0.90 },
  'Backend Engineer':   { code: 0.60, review: 0.85 },
  'Systems Engineer':   { code: 0.45, review: 0.85 },
  'Frontend Engineer':  { code: 0.70, review: 0.88 },
  'Quality & Testing':  { code: 0.25, review: 0.80 },
  'Full Stack Engineer':{ code: 0.65, review: 0.85 },
  'Reliability Engineer':{ code: 0.40, review: 0.82 },
  'UI Engineer':        { code: 0.72, review: 0.90 },
};
const DEFAULT_WEIGHTS: ActionWeights = { code: 0.65, review: 0.85 };

export const SNIPPETS_BY_LANG: Record<string, CodeSnippet[]> = {
  javascript: [
    {
      code: `\n// Helper: clamp numeric value within bounds\nfunction clamp(val, min, max) {\n  return Math.min(Math.max(val, min), max);\n}\n`,
      comment: '// TODO: verify NaN handling in clamp\n',
      chatStatus: 'Adding the clamp helper function.',
    },
    {
      code: `\n// Helper: exponential backoff delay\nasync function backoff(attempt, baseMs = 100) {\n  const delay = baseMs * Math.pow(2, attempt);\n  return new Promise((resolve) => setTimeout(resolve, delay));\n}\n`,
      comment: '// Exponential backoff with jitter\n',
      chatStatus: 'Implemented backoff delay utility.',
    },
    {
      code: `\n// Validation: check payload integrity\nfunction isValidPayload(payload) {\n  return Boolean(payload && typeof payload === 'object' && payload.id);\n}\n`,
      comment: '// Validates payload shape\n',
      chatStatus: 'Adding payload validation checks.',
    },
    {
      code: `\n// Helper: debounce function calls\nfunction debounce(fn, waitMs) {\n  let timer;\n  return (...args) => {\n    clearTimeout(timer);\n    timer = setTimeout(() => fn(...args), waitMs);\n  };\n}\n`,
      comment: '// Debounce for high-frequency events\n',
      chatStatus: 'Added debounce utility function.',
    },
    {
      code: `\n// Helper: deep equality check for plain objects\nfunction deepEqual(a, b) {\n  if (a === b) return true;\n  if (!a || !b || typeof a !== 'object') return false;\n  const keys = Object.keys(a);\n  if (keys.length !== Object.keys(b).length) return false;\n  return keys.every((k) => deepEqual(a[k], b[k]));\n}\n`,
      comment: '// Recursive equality: plain objects only\n',
      chatStatus: 'Implemented deep equality comparison.',
    },
    {
      code: `\n// Utility: simple event emitter\nfunction createEmitter() {\n  const listeners = new Map();\n  return {\n    on(event, fn) { const s = listeners.get(event) ?? new Set(); s.add(fn); listeners.set(event, s); },\n    off(event, fn) { listeners.get(event)?.delete(fn); },\n    emit(event, ...args) { listeners.get(event)?.forEach((fn) => fn(...args)); },\n  };\n}\n`,
      comment: '// Lightweight pub/sub emitter\n',
      chatStatus: 'Created lightweight event emitter.',
    },
    {
      code: `\n// Helper: throttle to limit invocation rate\nfunction throttle(fn, limitMs) {\n  let last = 0;\n  return (...args) => {\n    const now = Date.now();\n    if (now - last >= limitMs) {\n      last = now;\n      return fn(...args);\n    }\n  };\n}\n`,
      comment: '// Rate-limit calls to limitMs interval\n',
      chatStatus: 'Throttle utility for rate-limited calls.',
    },
    {
      code: `\n// Utility: group array items by a key function\nfunction groupBy(arr, keyFn) {\n  return arr.reduce((map, item) => {\n    const key = keyFn(item);\n    const group = map.get(key) ?? [];\n    group.push(item);\n    map.set(key, group);\n    return map;\n  }, new Map());\n}\n`,
      comment: '// Groups items into Map buckets\n',
      chatStatus: 'Added groupBy collection helper.',
    },
  ],
  typescript: [
    {
      code: `\n// Utility: clamp numeric value within range\nexport function clamp(val: number, min: number, max: number): number {\n  return Math.min(Math.max(val, min), max);\n}\n`,
      comment: '// Clamp utility for bounded calculations\n',
      chatStatus: 'Adding typed clamp helper function.',
    },
    {
      code: `\n// Type definition for worker peer status\nexport interface PeerStatus {\n  id: string;\n  online: boolean;\n  lastHeartbeat: number;\n  rttMs: number;\n}\n`,
      comment: '// Peer status interface contract\n',
      chatStatus: 'Defined PeerStatus interface.',
    },
    {
      code: `\n// Helper: retry with exponential backoff\nexport async function retry<T>(task: () => Promise<T>, attempts = 3): Promise<T> {\n  for (let i = 0; i < attempts; i++) {\n    try {\n      return await task();\n    } catch (err) {\n      if (i === attempts - 1) throw err;\n    }\n  }\n  throw new Error('All retries failed');\n}\n`,
      comment: '// Resilient retry utility\n',
      chatStatus: 'Added typed retry helper with backoff.',
    },
    {
      code: `\n// Discriminated union for operation results\nexport type Result<T, E = Error> =\n  | { ok: true; value: T }\n  | { ok: false; error: E };\n\nexport const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });\nexport const err = <E>(error: E): Result<never, E> => ({ ok: false, error });\n`,
      comment: '// Rust-style Result type\n',
      chatStatus: 'Added Result<T,E> discriminated union.',
    },
    {
      code: `\n// Typed event bus with subscriber map\nexport class EventBus<Events extends Record<string, unknown>> {\n  private subs = new Map<keyof Events, Set<(data: unknown) => void>>();\n  on<K extends keyof Events>(event: K, fn: (data: Events[K]) => void): () => void {\n    const set = this.subs.get(event) ?? new Set();\n    set.add(fn as (data: unknown) => void);\n    this.subs.set(event, set);\n    return () => set.delete(fn as (data: unknown) => void);\n  }\n  emit<K extends keyof Events>(event: K, data: Events[K]): void {\n    this.subs.get(event)?.forEach((fn) => fn(data));\n  }\n}\n`,
      comment: '// Type-safe publish/subscribe\n',
      chatStatus: 'Implemented typed EventBus class.',
    },
    {
      code: `\n// Simple TTL cache for expensive lookups\nexport class TtlCache<K, V> {\n  private store = new Map<K, { value: V; expiresAt: number }>();\n  constructor(private readonly ttlMs: number) {}\n  get(key: K): V | undefined {\n    const entry = this.store.get(key);\n    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return undefined; }\n    return entry.value;\n  }\n  set(key: K, value: V): void {\n    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });\n  }\n}\n`,
      comment: '// Cache entries expire after TTL\n',
      chatStatus: 'Built TTL cache for repeated lookups.',
    },
    {
      code: `\n// Assertion helper for narrowing types\nexport function assert(condition: unknown, msg?: string): asserts condition {\n  if (!condition) throw new Error(msg ?? 'Assertion failed');\n}\n\nexport function assertDefined<T>(val: T | null | undefined, name = 'value'): T {\n  assert(val != null, \`Expected \${name} to be defined\`);\n  return val;\n}\n`,
      comment: '// Narrowing assertions for runtime safety\n',
      chatStatus: 'Added assertion helpers for type narrowing.',
    },
    {
      code: `\n// Minimal logger with structured output\nexport const logger = {\n  info: (msg: string, ctx?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', msg, ...ctx })),\n  warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(JSON.stringify({ level: 'warn', msg, ...ctx })),\n  error: (msg: string, ctx?: Record<string, unknown>) => console.error(JSON.stringify({ level: 'error', msg, ...ctx })),\n};\n`,
      comment: '// Structured JSON logger\n',
      chatStatus: 'Set up structured logging utility.',
    },
  ],
  python: [
    {
      code: `\n# Helper: calculate moving average\ndef moving_average(values: list[float], window: int) -> list[float]:\n    if window <= 0 or not values:\n        return []\n    return [sum(values[i:i+window]) / window for i in range(len(values) - window + 1)]\n`,
      comment: '# O(n) moving average calculation\n',
      chatStatus: 'Added moving average helper in Python.',
    },
    {
      code: `\n# Utility: exponential backoff retry\ndef retry_operation(fn, max_retries: int = 3):\n    for attempt in range(max_retries):\n        try:\n            return fn()\n        except Exception:\n            if attempt == max_retries - 1:\n                raise\n`,
      comment: '# Handled retry logic\n',
      chatStatus: 'Added retry_operation utility.',
    },
    {
      code: `\n# Decorator: memoize pure function results\nfrom functools import wraps\ndef memoize(fn):\n    cache = {}\n    @wraps(fn)\n    def wrapper(*args):\n        if args not in cache:\n            cache[args] = fn(*args)\n        return cache[args]\n    return wrapper\n`,
      comment: '# Cache pure function calls\n',
      chatStatus: 'Implemented memoize decorator.',
    },
    {
      code: `\n# Helper: process items in fixed-size batches\ndef batched(iterable, n: int):\n    from itertools import islice\n    it = iter(iterable)\n    while batch := list(islice(it, n)):\n        yield batch\n`,
      comment: '# Chunked iteration for batch processing\n',
      chatStatus: 'Added batch processing generator.',
    },
  ],
  rust: [
    {
      code: `\npub fn clamp_num<T: PartialOrd>(val: T, min: T, max: T) -> T {\n    if val < min { min } else if val > max { max } else { val }\n}\n`,
      comment: '// Generic clamp range helper\n',
      chatStatus: 'Added clamp_num implementation in Rust.',
    },
    {
      code: `\n/// Retry a fallible operation with exponential backoff.\npub fn retry<F, T, E>(mut f: F, max: usize) -> Result<T, E>\nwhere\n    F: FnMut() -> Result<T, E>,\n{\n    let mut last_err = None;\n    for _ in 0..max {\n        match f() {\n            Ok(v) => return Ok(v),\n            Err(e) => last_err = Some(e),\n        }\n    }\n    Err(last_err.unwrap())\n}\n`,
      comment: '// Retry up to max attempts\n',
      chatStatus: 'Added retry helper in Rust.',
    },
  ],
  go: [
    {
      code: `\n// ClampInt restricts a value within min and max\nfunc ClampInt(val, min, max int) int {\n\tif val < min {\n\t\treturn min\n\t}\n\tif val > max {\n\t\treturn max\n\t}\n\treturn val\n}\n`,
      comment: '// Clamps integer to range\n',
      chatStatus: 'Implemented ClampInt helper in Go.',
    },
    {
      code: `\n// SafeGo runs fn in a goroutine and recovers panics.\nfunc SafeGo(fn func()) {\n\tgo func() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tlog.Printf("recovered panic: %v", r)\n\t\t\t}\n\t\t}()\n\t\tfn()\n\t}()\n}\n`,
      comment: '// Panic-safe goroutine launcher\n',
      chatStatus: 'Added SafeGo panic recovery wrapper.',
    },
  ],
  html: [
    {
      code: `\n<!-- Collaborator banner -->\n<div class="banner">\n  <p>Live pair-programming session in progress</p>\n</div>\n`,
      comment: '<!-- Header status banner -->\n',
      chatStatus: 'Added status banner markup.',
    },
    {
      code: `\n<!-- Notification toast container -->\n<div id="toasts" role="alert" aria-live="polite">\n  <template id="toast-tmpl">\n    <div class="toast"><span class="toast-msg"></span></div>\n  </template>\n</div>\n`,
      comment: '<!-- Accessible toast region -->\n',
      chatStatus: 'Added accessible toast container.',
    },
  ],
  css: [
    {
      code: `\n/* Flexbox layout utility */\n.flex-center {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n`,
      comment: '/* Center alignment utility */\n',
      chatStatus: 'Added flexbox alignment rules.',
    },
    {
      code: `\n/* Smooth fade-in animation */\n@keyframes fade-in {\n  from { opacity: 0; transform: translateY(4px); }\n  to   { opacity: 1; transform: translateY(0); }\n}\n.fade-in {\n  animation: fade-in 0.2s ease-out;\n}\n`,
      comment: '/* Entry animation keyframes */\n',
      chatStatus: 'Added fade-in animation keyframes.',
    },
  ],
  default: [
    {
      code: `\n// Utility function for data processing\nfunction formatDuration(ms) {\n  const s = Math.floor(ms / 1000);\n  const m = Math.floor(s / 60);\n  return \`\${m}m \${s % 60}s\`;\n}\n`,
      comment: '// Format duration in minutes and seconds\n',
      chatStatus: 'Added duration formatting utility.',
    },
    {
      code: `\n// Utility: generate short unique IDs\nfunction uniqueId(prefix = '') {\n  return prefix + Math.random().toString(36).slice(2, 10);\n}\n`,
      comment: '// Random short ID generator\n',
      chatStatus: 'Added unique ID generator.',
    },
  ],
};

/**
 * Next index for a bot's chunk. Bots type in chunks while peers edit concurrently, so a stored integer
 * index goes stale and chunks land inside other bots' text. The anchor is pinned (assoc -1) to the bot's
 * own last typed char, keeping each snippet contiguous. No anchor = new block, appended at end of file.
 */
export function resolveInsertPos(yText: Y.Text, doc: Y.Doc, anchor: Y.RelativePosition | null): number {
  if (!anchor) return yText.length;
  return Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index ?? yText.length;
}

export class BotStormManager {
  private activeStorms = new Map<string, ActiveStorm>();

  constructor(private deps: BotStormDependencies) {}

  public isStormActive(roomId: string): boolean {
    return this.activeStorms.has(roomId);
  }

  public async startStorm(options: StartStormOptions): Promise<void> {
    if (this.activeStorms.has(options.roomId)) {
      throw new Error(`Bot storm already active in room '${options.roomId}'`);
    }

    const roomRow = this.deps.roomRepo.findById(options.roomId);
    if (!roomRow) {
      throw new Error(`Room '${options.roomId}' not found`);
    }

    const loadedRoom = this.deps.roomRegistry.getOrCreate(options.roomId);
    if (!loadedRoom) {
      throw new Error(`Room '${options.roomId}' could not be loaded`);
    }

    const activeStorm: ActiveStorm = {
      roomId: options.roomId,
      bots: [],
      typingTimers: new Set<NodeJS.Timeout>(),
      stopTimer: null,
      stopped: false,
      ops: 0,
      startedAt: Date.now(),
      stop: async () => {},
    };

    let activeAuthorId: string | null = null;

    const stop = async () => {
      if (activeStorm.stopped) return;
      activeStorm.stopped = true;
      activeAuthorId = null;

      try {
        if (activeStorm.stopTimer) {
          clearTimeout(activeStorm.stopTimer);
          activeStorm.stopTimer = null;
        }

        for (const t of activeStorm.typingTimers) {
          clearTimeout(t);
        }
        activeStorm.typingTimers.clear();

        // 1. Immediately zero out artificial network latency on all bot sockets
        for (const bot of activeStorm.bots) {
          try {
            const ws = (bot.client as unknown as { ws?: { setLatency?: (min: number, max: number) => void } }).ws;
            if (ws && typeof ws.setLatency === 'function') {
              ws.setLatency(0, 0);
            }
            bot.awareness.setLocalStateField('typing', false);
            bot.awareness.setLocalStateField('cursor', null);
            bot.awareness.setLocalStateField('highlight', null);
          } catch {}
        }

        // 2. Undo changes made by each bot and flush updates
        for (const bot of activeStorm.bots) {
          try {
            while (bot.undoManager.canUndo()) {
              bot.undoManager.undo();
            }
            bot.client.flushBatch();
          } catch (e) {
            console.error(`[botStorm] Undo error for bot ${bot.name}:`, e);
          }
        }

        // 3. Wait for every bot replica to match the server's before judging convergence
        const durationMs = Date.now() - activeStorm.startedAt;
        let convergenceResult = { converged: true, checksum: '--------' };
        try {
          convergenceResult = await waitForConvergence(loadedRoom.doc, activeStorm.bots.map((b) => b.doc));
        } catch (e) {
          console.error('[botStorm] waitForConvergence error:', e);
        }

        // 4. Destroy bot clients, remove DB rows, evict from host elector, and broadcast member.left
        for (const bot of activeStorm.bots) {
          try {
            bot.client.destroy();
            bot.awareness.destroy();
            bot.doc.destroy();
            this.deps.memberRepo.deleteMember(options.roomId, bot.memberId);
            loadedRoom.hostElector.evict(bot.memberId);
            loadedRoom.broadcastControl({
              t: 'member.left',
              memberId: bot.memberId,
              reason: 'leave',
            });
          } catch (e) {
            console.error(`[botStorm] Bot cleanup error for bot ${bot.name}:`, e);
          }
        }

        this.deps.auditService.logEvent(options.roomId, {
          type: 'demo.storm_completed',
          actorMemberId: null,
          actorName: null,
          payload: {
            bots: options.bots,
            seconds: options.seconds,
            durationMs,
            ops: activeStorm.ops,
            converged: convergenceResult.converged,
            checksum: convergenceResult.checksum,
          },
        });
      } finally {
        this.activeStorms.delete(options.roomId);
        loadedRoom.scheduleChecksum();
      }
    };

    activeStorm.stop = stop;
    this.activeStorms.set(options.roomId, activeStorm);

    const lang = (roomRow.language ?? 'javascript').toLowerCase();
    const snippets = SNIPPETS_BY_LANG[lang] ?? SNIPPETS_BY_LANG.default ?? [];

    const sendBotChat = (botId: string, botName: string, colorIndex: number, text: string) => {
      if (!this.deps.chatService || activeStorm.stopped) return;
      try {
        const { message, created } = this.deps.chatService.post(options.roomId, {
          clientMsgId: crypto.randomUUID(),
          memberId: botId,
          name: botName,
          colorIndex,
          text,
        });
        if (created) {
          loadedRoom.broadcastControl({ t: 'chat.msg', message });
        }
      } catch {
        // Chat posting is non-critical to sync convergence
      }
    };

    try {
      for (let i = 0; i < options.bots; i++) {
        const persona = COLLAB_PERSONAS[i % COLLAB_PERSONAS.length]!;
        const botId = `bot-${i + 1}-${crypto.randomUUID().slice(0, 8)}`;
        const botName = persona.name;
        const colorIndex = persona.colorIndex;

        loadedRoom.markBot(botId);
        this.deps.memberRepo.upsertMember({
          roomId: options.roomId,
          memberId: botId,
          displayName: botName,
          colorIndex,
        });

        const token = await this.deps.joinService.issueRoomToken({
          memberId: botId,
          roomId: options.roomId,
          displayName: botName,
          passcodeVersion: roomRow.passcode_version,
          roomEpoch: roomRow.epoch,
        });

        const botDoc = new Y.Doc();
        const botAwareness = new awarenessProtocol.Awareness(botDoc);
        botAwareness.setLocalState({
          memberId: botId,
          cursor: null,
          highlight: null,
          typing: false,
          status: 'active',
        });

        const client = new SyncClient({
          url: `ws://127.0.0.1:${options.port}/ws/rooms/${options.roomId}`,
          token,
          doc: botDoc,
          webSocketFactory: (url: string, protocols?: string | string[]) => {
            if (options.faults) {
              return new FaultyWebSocket(url, protocols, {
                transportOptions: { minLatencyMs: 15, maxLatencyMs: 100 },
              }) as unknown as WebSocket;
            }
            return new WebSocket(url, protocols);
          },
          onAwarenessUpdate: (update: Uint8Array) => {
            awarenessProtocol.applyAwarenessUpdate(botAwareness, update, 'server');
          },
        });

        botAwareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
          const changed = added.concat(updated).concat(removed);
          const encoded = awarenessProtocol.encodeAwarenessUpdate(botAwareness, changed);
          client.queueAwarenessUpdate(encoded);
        });

        await client.connect();

        const yText = botDoc.getText('codemirror');
        const undoManager = new Y.UndoManager(yText, {
          trackedOrigins: new Set([botId]),
        });

        const activeBot: ActiveBot = {
          memberId: botId,
          name: botName,
          colorIndex,
          doc: botDoc,
          awareness: botAwareness,
          client,
          undoManager,
          hasChatted: false,
        };
        activeStorm.bots.push(activeBot);

        // Schedule realistic collaborative actions for this bot
        const weights = ROLE_WEIGHTS[persona.role] ?? DEFAULT_WEIGHTS;
        let snippetCursor = i; // each bot starts at a different offset so they write unique code
        const scheduleNextAction = (initialDelay = 150 + Math.random() * 250) => {
          if (activeStorm.stopped) return;

          const actionTimer = setTimeout(() => {
            activeStorm.typingTimers.delete(actionTimer);
            if (activeStorm.stopped) return;

            const roll = Math.random();
            const snippet = snippets[snippetCursor % snippets.length] ?? {
              code: `\n// Collab update by ${botName}\n`,
              comment: `// Reviewing code...\n`,
              chatStatus: 'Working on current module.',
            };
            snippetCursor++;

            // Action distribution driven by persona role
            const canAuthorCode = roll < weights.code && (activeAuthorId === null || activeAuthorId === botId);
            if (canAuthorCode) {
              activeAuthorId = botId;
              const textToType = snippet.code;
              let typedIndex = 0;
              let anchor: Y.RelativePosition | null = null;

              const streamChunk = () => {
                if (activeStorm.stopped) {
                  if (activeAuthorId === botId) activeAuthorId = null;
                  return;
                }
                try {
                  const chunkSize = Math.min(textToType.length - typedIndex, 3 + Math.floor(Math.random() * 4));
                  const chunk = textToType.slice(typedIndex, typedIndex + chunkSize);

                  const pos = resolveInsertPos(yText, botDoc, anchor);
                  botDoc.transact(() => {
                    yText.insert(pos, chunk);
                  }, botId);
                  activeStorm.ops++;
                  typedIndex += chunkSize;
                  anchor = Y.createRelativePositionFromTypeIndex(yText, pos + chunk.length, -1);
                  const rel = anchor;
                  botAwareness.setLocalStateField('cursor', { anchor: rel, head: rel });
                  botAwareness.setLocalStateField('typing', true);

                  if (typedIndex < textToType.length) {
                    const chunkTimer = setTimeout(streamChunk, 35 + Math.random() * 40);
                    activeStorm.typingTimers.add(chunkTimer);
                  } else {
                    if (activeAuthorId === botId) activeAuthorId = null;
                    botAwareness.setLocalStateField('typing', false);
                    if (!activeBot.hasChatted) {
                      activeBot.hasChatted = true;
                      sendBotChat(botId, botName, colorIndex, snippet.chatStatus);
                    }
                    scheduleNextAction(400 + Math.random() * 500);
                  }
                } catch {
                  if (activeAuthorId === botId) activeAuthorId = null;
                }
              };

              streamChunk();
              return;
            }

            // Code Review: set selection range and optional line highlight
            if (roll < weights.review && yText.length > 10) {
              const str = yText.toString();
              const lines: { start: number; end: number }[] = [];
              let lineStart = 0;
              for (let idx = 0; idx < str.length; idx++) {
                if (str[idx] === '\n') {
                  if (idx > lineStart) lines.push({ start: lineStart, end: idx });
                  lineStart = idx + 1;
                }
              }

              if (lines.length > 0) {
                const targetLine = lines[Math.floor(Math.random() * lines.length)]!;
                const fromRel = Y.createRelativePositionFromTypeIndex(yText, targetLine.start);
                const toRel = Y.createRelativePositionFromTypeIndex(yText, targetLine.end);

                // Remote selection display
                botAwareness.setLocalStateField('cursor', { anchor: fromRel, head: toRel });
                botAwareness.setLocalStateField('typing', false);

                // Broadcast line highlight 35% of the time
                const shouldHighlight = Math.random() < 0.35;
                if (shouldHighlight) {
                  botAwareness.setLocalStateField('highlight', { from: fromRel, to: toRel });
                }

                const reviewTimer = setTimeout(() => {
                  activeStorm.typingTimers.delete(reviewTimer);
                  if (activeStorm.stopped) return;

                  if (shouldHighlight) {
                    botAwareness.setLocalStateField('highlight', null);
                  }
                  botAwareness.setLocalStateField('cursor', { anchor: toRel, head: toRel });
                  scheduleNextAction(300 + Math.random() * 400);
                }, 700 + Math.random() * 600);

                activeStorm.typingTimers.add(reviewTimer);
                return;
              }
            }

            // Inline comment authoring (remaining probability)
            if (activeAuthorId !== null && yText.length > 0) {
              // Avoid conflicting with an active author stream
              scheduleNextAction(300 + Math.random() * 400);
              return;
            }
            const commentPos = yText.length;
            const endsWithNewline = commentPos === 0 || yText.toString().endsWith('\n');
            const commentText = (endsWithNewline ? '' : '\n') + snippet.comment;
            botDoc.transact(() => {
              yText.insert(commentPos, commentText);
            }, botId);
            activeStorm.ops++;

            const rel = Y.createRelativePositionFromTypeIndex(yText, commentPos + commentText.length, -1);
            botAwareness.setLocalStateField('cursor', { anchor: rel, head: rel });
            botAwareness.setLocalStateField('typing', false);

            scheduleNextAction(400 + Math.random() * 400);
          }, initialDelay);

          activeStorm.typingTimers.add(actionTimer);
        };

        scheduleNextAction(100 + i * 80);
      }

      activeStorm.stopTimer = setTimeout(() => {
        void stop();
      }, options.seconds * 1000);
    } catch (err) {
      await stop();
      throw err;
    }
  }

  public async stopStorm(roomId: string): Promise<void> {
    const storm = this.activeStorms.get(roomId);
    if (storm) {
      await storm.stop();
    }
  }

  public async destroyAll(): Promise<void> {
    const storms = Array.from(this.activeStorms.values());
    await Promise.all(storms.map((s) => s.stop()));
    this.activeStorms.clear();
  }
}

const CONVERGE_POLL_MS = 100;
const CONVERGE_TIMEOUT_MS = 3000;

/** Polls until every bot replica has the server's state vector and text, or the timeout passes (= diverged). */
export async function waitForConvergence(serverDoc: Y.Doc, replicas: Y.Doc[]): Promise<{ converged: boolean; checksum: string }> {
  const deadline = Date.now() + CONVERGE_TIMEOUT_MS;
  for (;;) {
    const sv = Y.encodeStateVector(serverDoc);
    const checksum = hashString(serverDoc.getText('codemirror').toString());
    const converged = replicas.every(
      (d) => areStateVectorsEqual(Y.encodeStateVector(d), sv) && hashString(d.getText('codemirror').toString()) === checksum,
    );
    if (converged || Date.now() >= deadline) return { converged, checksum };
    await new Promise((r) => setTimeout(r, CONVERGE_POLL_MS));
  }
}
