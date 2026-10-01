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
  ],
  rust: [
    {
      code: `\npub fn clamp_num<T: PartialOrd>(val: T, min: T, max: T) -> T {\n    if val < min { min } else if val > max { max } else { val }\n}\n`,
      comment: '// Generic clamp range helper\n',
      chatStatus: 'Added clamp_num implementation in Rust.',
    },
  ],
  go: [
    {
      code: `\n// ClampInt restricts a value within min and max\nfunc ClampInt(val, min, max int) int {\n\tif val < min {\n\t\treturn min\n\t}\n\tif val > max {\n\t\treturn max\n\t}\n\treturn val\n}\n`,
      comment: '// Clamps integer to range\n',
      chatStatus: 'Implemented ClampInt helper in Go.',
    },
  ],
  html: [
    {
      code: `\n<!-- Collaborator banner -->\n<div class="banner">\n  <p>Live pair-programming session in progress</p>\n</div>\n`,
      comment: '<!-- Header status banner -->\n',
      chatStatus: 'Added status banner markup.',
    },
  ],
  css: [
    {
      code: `\n/* Flexbox layout utility */\n.flex-center {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n`,
      comment: '/* Center alignment utility */\n',
      chatStatus: 'Added flexbox alignment rules.',
    },
  ],
  default: [
    {
      code: `\n// Utility function for data processing\nfunction formatDuration(ms) {\n  const s = Math.floor(ms / 1000);\n  const m = Math.floor(s / 60);\n  return \`\${m}m \${s % 60}s\`;\n}\n`,
      comment: '// Format duration in minutes and seconds\n',
      chatStatus: 'Added duration formatting utility.',
    },
  ],
};

function findSafeInsertPos(yText: Y.Text): number {
  const len = yText.length;
  if (len === 0) return 0;
  // 65% chance to append at end of file (natural for human collaboration)
  if (Math.random() < 0.65) {
    return len;
  }
  const str = yText.toString();
  const lineEnds: number[] = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\n') {
      lineEnds.push(i + 1);
    }
  }
  if (lineEnds.length > 0) {
    return lineEnds[Math.floor(Math.random() * lineEnds.length)]!;
  }
  return len;
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

    const stop = async () => {
      if (activeStorm.stopped) return;
      activeStorm.stopped = true;

      if (activeStorm.stopTimer) {
        clearTimeout(activeStorm.stopTimer);
        activeStorm.stopTimer = null;
      }

      for (const t of activeStorm.typingTimers) {
        clearTimeout(t);
      }
      activeStorm.typingTimers.clear();

      // Undo changes made by each bot and clear presence
      for (const bot of activeStorm.bots) {
        bot.awareness.setLocalStateField('typing', false);
        bot.awareness.setLocalStateField('cursor', null);
        bot.awareness.setLocalStateField('highlight', null);
        while (bot.undoManager.canUndo()) {
          bot.undoManager.undo();
        }
        bot.client.flushBatch();
      }

      // Wait for every bot replica to match the server's before judging convergence.
      const durationMs = Date.now() - activeStorm.startedAt;
      const { converged, checksum } = await waitForConvergence(loadedRoom.doc, activeStorm.bots.map((b) => b.doc));

      for (const bot of activeStorm.bots) {
        bot.client.destroy();
        bot.awareness.destroy();
        bot.doc.destroy();
        // Bot ids are single-use; leaving rows behind fills the 32-seat capacity after a few storms.
        this.deps.memberRepo.deleteMember(options.roomId, bot.memberId);
      }

      this.deps.auditService.logEvent(options.roomId, {
        type: 'demo.storm_completed',
        actorMemberId: null,
        actorName: null,
        payload: { bots: options.bots, seconds: options.seconds, durationMs, ops: activeStorm.ops, converged, checksum },
      });

      this.activeStorms.delete(options.roomId);
      // Guarantees a checksum after the completion event so every browser verifies its own replica too.
      loadedRoom.scheduleChecksum();
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
        const scheduleNextAction = (initialDelay = 150 + Math.random() * 250) => {
          if (activeStorm.stopped) return;

          const actionTimer = setTimeout(() => {
            activeStorm.typingTimers.delete(actionTimer);
            if (activeStorm.stopped) return;

            const roll = Math.random();
            const snippet = snippets[Math.floor(Math.random() * snippets.length)] ?? {
              code: `\n// Collab update by ${botName}\n`,
              comment: `// Reviewing code...\n`,
              chatStatus: 'Working on current module.',
            };

            // 65% Author a code snippet / block via progressive typing
            if (roll < 0.65) {
              const insertPos = findSafeInsertPos(yText);
              const textToType = snippet.code;
              let typedIndex = 0;
              let currentPos = insertPos;

              const streamChunk = () => {
                if (activeStorm.stopped) return;
                const chunkSize = Math.min(textToType.length - typedIndex, 3 + Math.floor(Math.random() * 4));
                const chunk = textToType.slice(typedIndex, typedIndex + chunkSize);

                botDoc.transact(() => {
                  yText.insert(currentPos, chunk);
                }, botId);
                activeStorm.ops++;
                currentPos += chunk.length;
                typedIndex += chunkSize;

                const at = Math.min(currentPos, yText.length);
                const rel = Y.createRelativePositionFromTypeIndex(yText, at);
                botAwareness.setLocalStateField('cursor', { anchor: rel, head: rel });
                botAwareness.setLocalStateField('typing', true);

                if (typedIndex < textToType.length) {
                  const chunkTimer = setTimeout(streamChunk, 35 + Math.random() * 40);
                  activeStorm.typingTimers.add(chunkTimer);
                } else {
                  botAwareness.setLocalStateField('typing', false);
                  if (!activeBot.hasChatted) {
                    activeBot.hasChatted = true;
                    sendBotChat(botId, botName, colorIndex, snippet.chatStatus);
                  }
                  scheduleNextAction(400 + Math.random() * 500);
                }
              };

              streamChunk();
              return;
            }

            // 20% Code Review: set selection range and optional line highlight
            if (roll < 0.85 && yText.length > 10) {
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

            // 15% Inline comment authoring
            const commentPos = findSafeInsertPos(yText);
            const commentText = snippet.comment;
            botDoc.transact(() => {
              yText.insert(commentPos, commentText);
            }, botId);
            activeStorm.ops++;

            const at = Math.min(commentPos + commentText.length, yText.length);
            const rel = Y.createRelativePositionFromTypeIndex(yText, at);
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
