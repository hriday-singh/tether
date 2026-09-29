import * as Y from 'yjs';
import { PRNG } from './prng.js';
import { ChaosAction } from './types.js';
import { FaultyWebSocket } from './faultyWebSocket.js';
import { SyncClient } from '@tether/sync-client';
import { extractTagsFromText } from './invariants.js';

export interface ChaosClientHandle {
  id: number;
  client: SyncClient;
  doc: Y.Doc;
  activeSocket: FaultyWebSocket | null;
  isDisconnected: boolean;
  outboundTimestamps: number[];
}

export function getSafeInsertPos(text: string, rawPos: number): number {
  if (text.length === 0) return 0;
  const clamped = Math.max(0, Math.min(rawPos, text.length));

  const regex = /⟦c\d+#\d+⟧/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = match.index + match[0].length;
    if (clamped > start && clamped < end) {
      return end;
    }
  }
  return clamped;
}

export class ActionGenerator {
  public activeTags = new Set<string>();
  public allInsertedTags = new Set<string>();
  public deletedTags = new Set<string>();
  private seqPerClient = new Map<number, number>();

  constructor(private prng: PRNG) {}

  public getNextTag(clientId: number): string {
    const seq = (this.seqPerClient.get(clientId) ?? 0) + 1;
    this.seqPerClient.set(clientId, seq);
    const tag = `⟦c${clientId}#${seq}⟧`;
    this.activeTags.add(tag);
    this.allInsertedTags.add(tag);
    return tag;
  }

  public generateAction(
    step: number,
    connectedClientIds: number[],
    allClientIds: number[]
  ): ChaosAction {
    const weightedTypes = [
      { item: 'insert' as const, weight: 45 },
      { item: 'delete' as const, weight: 20 },
      { item: 'burst' as const, weight: 10 },
      { item: 'disconnect' as const, weight: 10 },
      { item: 'reconnect' as const, weight: 10 },
      { item: 'setLatency' as const, weight: 5 },
      { item: 'pauseInbound' as const, weight: 5 },
    ];

    const chosenType = this.prng.pickWeighted(weightedTypes);

    // If no connected clients, we can only reconnect or set latency
    if (connectedClientIds.length === 0) {
      const clientId = this.prng.pick(allClientIds);
      return { type: 'reconnect', step, clientId };
    }

    const clientId = this.prng.pick(connectedClientIds);

    switch (chosenType) {
      case 'insert': {
        const tag = this.getNextTag(clientId);
        return {
          type: 'insert',
          step,
          clientId,
          tag,
          pos: 0, // Pos determined at application time based on current text length
        };
      }
      case 'delete': {
        return {
          type: 'delete',
          step,
          clientId,
          from: 0,
          length: 0,
          removedTags: [],
        };
      }
      case 'burst': {
        const count = this.prng.nextInt(5, 15);
        const tags: string[] = [];
        for (let i = 0; i < count; i++) {
          tags.push(this.getNextTag(clientId));
        }
        return {
          type: 'burst',
          step,
          clientId,
          count,
          tags,
        };
      }
      case 'disconnect': {
        return {
          type: 'disconnect',
          step,
          clientId,
        };
      }
      case 'reconnect': {
        const targetId = this.prng.pick(allClientIds);
        return {
          type: 'reconnect',
          step,
          clientId: targetId,
        };
      }
      case 'setLatency': {
        const latencyMs = this.prng.nextInt(10, 200);
        return {
          type: 'setLatency',
          step,
          clientId,
          latencyMs,
        };
      }
      case 'pauseInbound': {
        const durationMs = this.prng.nextInt(20, 80);
        return {
          type: 'pauseInbound',
          step,
          clientId,
          durationMs,
        };
      }
    }
  }

  public applyAction(
    action: ChaosAction,
    clients: Map<number, ChaosClientHandle>
  ): void {
    const handle = clients.get(action.clientId);
    if (!handle) return;

    switch (action.type) {
      case 'insert': {
        const yText = handle.doc.getText('codemirror');
        const currentStr = yText.toString();
        const rawPos = this.prng.nextInt(0, currentStr.length);
        const pos = getSafeInsertPos(currentStr, rawPos);
        yText.insert(pos, action.tag);
        break;
      }
      case 'delete': {
        const yText = handle.doc.getText('codemirror');
        const textStr = yText.toString();
        const tags = extractTagsFromText(textStr);
        if (tags.length === 0) return;

        const targetTag = this.prng.pick(tags);
        const tagIndex = textStr.indexOf(targetTag);
        if (tagIndex === -1) return;

        const maxConsecutive = Math.min(3, tags.length);
        const countToDelete = this.prng.nextInt(1, maxConsecutive);

        let totalLen = 0;
        let searchIndex = tagIndex;
        const deletedInThisAction: string[] = [];

        for (let i = 0; i < countToDelete; i++) {
          const match = textStr.slice(searchIndex).match(/^⟦c\d+#\d+⟧/);
          if (!match) break;
          const tag = match[0];
          deletedInThisAction.push(tag);
          searchIndex += tag.length;
          totalLen += tag.length;
        }

        if (totalLen > 0) {
          yText.delete(tagIndex, totalLen);
          for (const tag of deletedInThisAction) {
            this.activeTags.delete(tag);
            this.deletedTags.add(tag);
          }
        }
        break;
      }
      case 'burst': {
        const yText = handle.doc.getText('codemirror');
        for (const tag of action.tags) {
          const currentStr = yText.toString();
          const rawPos = this.prng.nextInt(0, currentStr.length);
          const pos = getSafeInsertPos(currentStr, rawPos);
          yText.insert(pos, tag);
        }
        break;
      }
      case 'disconnect': {
        if (!handle.isDisconnected && handle.activeSocket) {
          handle.isDisconnected = true;
          handle.activeSocket.terminate();
        }
        break;
      }
      case 'reconnect': {
        if (handle.isDisconnected) {
          handle.isDisconnected = false;
          handle.client.connect();
        }
        break;
      }
      case 'setLatency': {
        if (handle.activeSocket) {
          handle.activeSocket.setLatency(0, action.latencyMs);
        }
        break;
      }
      case 'pauseInbound': {
        if (handle.activeSocket) {
          handle.activeSocket.pause();
          setTimeout(() => {
            handle.activeSocket?.resume();
          }, action.durationMs);
        }
        break;
      }
    }
  }
}
