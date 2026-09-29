import { hashString } from '@tether/shared';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { StormResult } from '../sync/types';

/**
 * P2 bot storm (demo mode), in-browser edition: each bot is its own Y.Doc peer with its own latency and faults
 * (delay jitter, reordering, short partitions). At the end, every replica must match the host byte for byte.
 * TODO(server M9): the real storm spawns headless bots server-side (docs/08). This fake exercises the same UI.
 */
const SNIPPETS = ['const ', 'let x = 1;', '\n', '// bot\n', 'fn()', ' + ', 'return ', '{}', '[]', 'await ', 'if (ok) '];

export interface StormOptions {
  doc: Y.Doc;
  awareness: Awareness;
  botIds: string[];
  seconds: number;
  faults: boolean;
  onOps(ops: number): void;
  onDone(result: StormResult): void;
  rng?: () => number;
}

interface Bot {
  origin: string;
  doc: Y.Doc;
  awareness: Awareness;
  inbox: number;
}

export function runStorm(o: StormOptions): () => void {
  const rng = o.rng ?? Math.random;
  const started = Date.now();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let ops = 0;
  let stopped = false;
  let typing = true;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!stopped) fn();
    }, ms);
    timers.add(t);
  };
  const delay = () => (o.faults ? 20 + rng() * 280 + (rng() < 0.05 ? 1200 : 0) : 10 + rng() * 30);

  const bots: Bot[] = o.botIds.map((memberId, i) => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(o.doc));
    const awareness = new Awareness(doc);
    awareness.setLocalState({ memberId, cursor: null, highlight: null, typing: true, status: 'active' });
    const bot: Bot = { origin: `bot:${i}`, doc, awareness, inbox: 0 };
    // bot -> host (faulty link: jitter reorders, and rare long stalls act as partitions)
    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'host') return;
      bot.inbox += 1;
      later(() => {
        bot.inbox -= 1;
        Y.applyUpdate(o.doc, update, bot.origin);
      }, delay());
    });
    awareness.on('update', ({ added, updated }: { added: number[]; updated: number[] }) => {
      const upd = encodeAwarenessUpdate(awareness, added.concat(updated));
      later(() => applyAwarenessUpdate(o.awareness, upd, bot.origin), delay());
    });
    return bot;
  });

  // host -> every bot except the originator
  const fanOut = (update: Uint8Array, origin: unknown) => {
    for (const bot of bots) {
      if (origin === bot.origin) continue;
      bot.inbox += 1;
      later(() => {
        bot.inbox -= 1;
        Y.applyUpdate(bot.doc, update, 'host');
      }, delay());
    }
  };
  o.doc.on('update', fanOut);

  const tick = (bot: Bot) => {
    if (!typing) return;
    const text = bot.doc.getText('content');
    const len = text.length;
    const pos = Math.floor(rng() * (len + 1));
    if (len > 40 && rng() < 0.3) {
      text.delete(Math.min(pos, len - 1), Math.min(3, len - pos) || 1);
    } else {
      text.insert(pos, SNIPPETS[Math.floor(rng() * SNIPPETS.length)]!);
    }
    const at = Math.min(pos, text.length);
    const rel = Y.createRelativePositionFromTypeIndex(text, at);
    bot.awareness.setLocalStateField('cursor', { anchor: rel, head: rel });
    ops += 1;
    o.onOps(ops);
    later(() => tick(bot), 120 + rng() * 380);
  };
  bots.forEach((b) => later(() => tick(b), rng() * 400));

  const finish = () => {
    typing = false;
    bots.forEach((b) => b.awareness.setLocalStateField('typing', false));
    const settle = (waited: number) => {
      const drained = bots.every((b) => b.inbox === 0);
      if (!drained && waited < 8000) return later(() => settle(waited + 100), 100);
      const hostText = o.doc.getText('content').toString();
      const converged =
        drained &&
        bots.every((b) => {
          const sameText = b.doc.getText('content').toString() === hostText;
          const sameSv = Y.encodeStateVector(b.doc).toString() === Y.encodeStateVector(o.doc).toString();
          return sameText && sameSv;
        });
      const result: StormResult = {
        bots: bots.length,
        ops,
        durationMs: Date.now() - started,
        converged,
        checksum: hashString(hostText),
      };
      cleanup();
      o.onDone(result);
    };
    settle(0);
  };
  later(finish, o.seconds * 1000);

  function cleanup() {
    stopped = true;
    timers.forEach(clearTimeout);
    o.doc.off('update', fanOut);
    removeAwarenessStates(
      o.awareness,
      bots.map((b) => b.doc.clientID),
      'storm-end',
    );
    bots.forEach((b) => {
      b.awareness.destroy();
      b.doc.destroy();
    });
  }

  return cleanup;
}
