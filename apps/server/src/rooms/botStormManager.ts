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
import { snippetsFor, type CodeSnippet } from './botSnippets.js';

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
  /** Next block in the shared queue; each block is typed once, in order. */
  nextSnippet: number;
  startedAt: number;
  stop: () => Promise<void>;
}

export interface CollabPersona {
  name: string;
  colorIndex: number;
}

export const COLLAB_PERSONAS: CollabPersona[] = [
  { name: 'Alex Chen', colorIndex: 0 },
  { name: 'Sarah Jenkins', colorIndex: 2 },
  { name: 'Elena Rostova', colorIndex: 4 },
  { name: 'Marcus Vance', colorIndex: 6 },
  { name: 'Kenji Sato', colorIndex: 8 },
  { name: 'Priya Sharma', colorIndex: 10 },
  { name: 'David Kim', colorIndex: 1 },
  { name: 'Chloe Dupont', colorIndex: 3 },
];

/**
 * Where every new block starts: right after the last char of the storm-start content, or before the
 * `</body>` line of an HTML page so the page stays valid. Pinned (assoc -1) to that char, never to a
 * bot's typing tail: concurrent inserts at one spot are ordered by Yjs client id, which would splice a
 * new block into a half-typed one. Each new block lands above the ones already typed, so the queue is
 * fed in reverse. null = empty doc, start at 0.
 * ponytail: two blocks started within one network round trip can swap places; both stay intact.
 */
export function blockInsertAnchor(yText: Y.Text): Y.RelativePosition | null {
  const text = yText.toString();
  const body = text.lastIndexOf('</body>');
  const at = body === -1 ? text.length : text.lastIndexOf('\n', body) + 1;
  return at === 0 ? null : Y.createRelativePositionFromTypeIndex(yText, at, -1);
}

/**
 * Index for a bot's next chunk: its own anchor (pinned to its last typed char, keeping each block
 * contiguous while peers edit) or, for a block's first chunk, the storm's blockInsertAnchor.
 * null = the anchor's char has not reached this replica yet (bot still syncing); try again shortly.
 */
export function resolveInsertPos(doc: Y.Doc, anchor: Y.RelativePosition | null): number | null {
  if (!anchor) return 0;
  return Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index ?? null;
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
      nextSnippet: 0,
      startedAt: Date.now(),
      stop: async () => {},
    };

    const stop = async () => {
      if (activeStorm.stopped) return;
      activeStorm.stopped = true;

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

    const queue = [...snippetsFor(roomRow.language ?? 'javascript')].reverse(); // see blockInsertAnchor
    const insertAt = blockInsertAnchor(loadedRoom.doc.getText('codemirror'));

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

        // Each bot types the next queued block a few chars at a time, then picks up another. Blocks are
        // self-contained and start where the previous one did, so concurrent typing still reads in order.
        const typeBlock = (snippet: CodeSnippet) => {
          let typedIndex = 0;
          let anchor: Y.RelativePosition | null = null;
          const streamChunk = () => {
            if (activeStorm.stopped) return;
            const pos = resolveInsertPos(botDoc, anchor ?? insertAt);
            if (pos === null) {
              const waitTimer = setTimeout(() => {
                activeStorm.typingTimers.delete(waitTimer);
                streamChunk();
              }, 100);
              activeStorm.typingTimers.add(waitTimer);
              return;
            }
            const chunk = snippet.code.slice(typedIndex, typedIndex + 3 + Math.floor(Math.random() * 4));
            botDoc.transact(() => yText.insert(pos, chunk), botId);
            activeStorm.ops++;
            typedIndex += chunk.length;
            anchor = Y.createRelativePositionFromTypeIndex(yText, pos + chunk.length, -1);
            botAwareness.setLocalStateField('cursor', { anchor, head: anchor });
            botAwareness.setLocalStateField('typing', true);

            if (typedIndex < snippet.code.length) {
              const chunkTimer = setTimeout(() => {
                activeStorm.typingTimers.delete(chunkTimer);
                streamChunk();
              }, 35 + Math.random() * 40);
              activeStorm.typingTimers.add(chunkTimer);
              return;
            }
            botAwareness.setLocalStateField('typing', false);
            if (!activeBot.hasChatted) {
              activeBot.hasChatted = true;
              sendBotChat(botId, botName, colorIndex, snippet.chatStatus);
            }
            scheduleNext(400 + Math.random() * 500);
          };
          streamChunk();
        };

        const scheduleNext = (delayMs: number) => {
          if (activeStorm.stopped) return;
          const timer = setTimeout(() => {
            activeStorm.typingTimers.delete(timer);
            if (activeStorm.stopped) return;
            const snippet = queue[activeStorm.nextSnippet];
            if (snippet) {
              activeStorm.nextSnippet++;
              typeBlock(snippet);
              return;
            }
            // ponytail: queue empty = bots just move their cursors; repeating blocks would redeclare functions.
            const rel = Y.createRelativePositionFromTypeIndex(yText, Math.floor(Math.random() * (yText.length + 1)));
            botAwareness.setLocalStateField('cursor', { anchor: rel, head: rel });
            scheduleNext(800 + Math.random() * 1200);
          }, delayMs);
          activeStorm.typingTimers.add(timer);
        };

        scheduleNext(200 + i * 400); // more than a round trip apart, so first blocks keep queue order
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
