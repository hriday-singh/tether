import crypto from 'node:crypto';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { SyncClient } from '@tether/sync-client';
import { FaultyWebSocket } from '@tether/sync-client/testing';
import { JoinService } from '../services/joinService.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { AuditService } from '../services/auditService.js';
import { RoomRegistry } from './roomRegistry.js';

export interface BotStormDependencies {
  joinService: JoinService;
  memberRepo: MemberRepo;
  roomRepo: RoomRepo;
  auditService: AuditService;
  roomRegistry: RoomRegistry;
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
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  client: SyncClient;
  undoManager: Y.UndoManager;
}

interface ActiveStorm {
  roomId: string;
  bots: ActiveBot[];
  typingTimers: Set<NodeJS.Timeout>;
  stopTimer: NodeJS.Timeout | null;
  stopped: boolean;
  stop: () => Promise<void>;
}

const BOT_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta'];
const SNIPPETS = ['const ', 'let x = 1;', '\n', '// bot\n', 'fn()', ' + ', 'return ', '{}', '[]', 'await ', 'if (ok) '];

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

      // Undo changes made by each bot
      for (const bot of activeStorm.bots) {
        bot.awareness.setLocalStateField('typing', false);
        while (bot.undoManager.canUndo()) {
          bot.undoManager.undo();
        }
        bot.client.flushBatch();
      }

      // Small pause for updates to propagate and persist
      await new Promise((r) => setTimeout(r, 200));

      for (const bot of activeStorm.bots) {
        bot.client.destroy();
        bot.awareness.destroy();
        bot.doc.destroy();
      }

      this.deps.auditService.logEvent(options.roomId, {
        type: 'demo.storm_completed',
        actorMemberId: null,
        actorName: null,
        payload: { bots: options.bots, seconds: options.seconds },
      });

      this.activeStorms.delete(options.roomId);
    };

    activeStorm.stop = stop;
    this.activeStorms.set(options.roomId, activeStorm);

    try {
      for (let i = 0; i < options.bots; i++) {
        const botId = `bot-${i + 1}-${crypto.randomUUID().slice(0, 8)}`;
        const botName = `Bot ${BOT_NAMES[i] ?? i + 1}`;
        const colorIndex = (i + 4) % 12;

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
          typing: true,
          status: 'active',
        });

        const client = new SyncClient({
          url: `ws://127.0.0.1:${options.port}/ws/rooms/${options.roomId}`,
          token,
          doc: botDoc,
          webSocketFactory: (url, protocols) => {
            if (options.faults) {
              return new FaultyWebSocket(url, protocols, {
                transportOptions: { minLatencyMs: 15, maxLatencyMs: 100 },
              }) as unknown as WebSocket;
            }
            return new WebSocket(url, protocols);
          },
          onAwarenessUpdate: (update) => {
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

        activeStorm.bots.push({
          memberId: botId,
          doc: botDoc,
          awareness: botAwareness,
          client,
          undoManager,
        });

        const scheduleTyping = () => {
          if (activeStorm.stopped) return;
          const delay = 100 + Math.random() * 200;
          const t = setTimeout(() => {
            activeStorm.typingTimers.delete(t);
            if (activeStorm.stopped) return;

            const len = yText.length;
            const pos = Math.floor(Math.random() * (len + 1));
            const snippet = SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)]!;
            botDoc.transact(() => {
              yText.insert(pos, snippet);
            }, botId);

            const at = Math.min(pos, yText.length);
            const rel = Y.createRelativePositionFromTypeIndex(yText, at);
            botAwareness.setLocalStateField('cursor', { anchor: rel, head: rel });
            botAwareness.setLocalStateField('typing', true);

            scheduleTyping();
          }, delay);
          activeStorm.typingTimers.add(t);
        };

        scheduleTyping();
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
