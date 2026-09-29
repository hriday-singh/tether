import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { createDatabase, DatabaseSession } from '@tether/server/db/database';
import { RoomRepo } from '@tether/server/repo/roomRepo';
import { UpdateRepo } from '@tether/server/repo/updateRepo';
import { MemberRepo } from '@tether/server/repo/memberRepo';
import { AuditRepo } from '@tether/server/repo/auditRepo';
import { JoinService } from '@tether/server/services/joinService';
import { RoomService } from '@tether/server/services/roomService';
import { AuditService } from '@tether/server/services/auditService';
import { PersistenceService } from '@tether/server/services/persistenceService';
import { RoomRegistry } from '@tether/server/rooms/roomRegistry';
import { buildApp } from '@tether/server/http/app';
import { createUpgradeGate } from '@tether/server/ws/upgradeGate';
import { ServerConfig } from '@tether/server/config';
import { SyncClient } from '@tether/sync-client';

interface LatencyStats {
  count: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  avgMs: number;
}

interface BenchResults {
  timestamp: string;
  config: {
    numClients: number;
    isolatedEditsCount: number;
    burstCharsPerClient: number;
    burstRateCharsPerSec: number;
  };
  isolatedEdits: LatencyStats;
  burstTyping: LatencyStats;
}

function calculatePercentiles(samples: number[]): LatencyStats {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0, avgMs: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const p = (pct: number) => {
    const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
    return sorted[idx] ?? 0;
  };
  const sum = sorted.reduce((acc, val) => acc + val, 0);

  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;

  return {
    count: sorted.length,
    minMs: Number(min.toFixed(2)),
    p50Ms: Number(p(0.5).toFixed(2)),
    p95Ms: Number(p(0.95).toFixed(2)),
    p99Ms: Number(p(0.99).toFixed(2)),
    maxMs: Number(max.toFixed(2)),
    avgMs: Number((sum / sorted.length).toFixed(2)),
  };
}

async function runBenchmark(): Promise<void> {
  console.log('====================================================');
  console.log('  Tether Milestone M5: Latency Distribution Benchmark');
  console.log('====================================================\n');

  const config: ServerConfig = {
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    SQLITE_PATH: ':memory:',
    DATABASE_DRIVER: 'sqlite',
    ALLOWED_ORIGINS: ['*'],
    JWT_SECRET: 'benchmark-jwt-secret-at-least-32-chars-long-tether!',
    HOST_GRACE_MS: 5000,
    PERSIST_FLUSH_MS: 50,
    ROOM_UNLOAD_IDLE_MS: 60000,
    DEMO_MODE: false,
  };

  const db: DatabaseSession = createDatabase(':memory:');
  const roomRepo = new RoomRepo(db);
  const updateRepo = new UpdateRepo(db);
  const memberRepo = new MemberRepo(db);
  const auditRepo = new AuditRepo(db);

  const joinService = new JoinService(config.JWT_SECRET);
  const auditService = new AuditService(auditRepo);
  const roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
  const persistenceService = new PersistenceService(updateRepo, roomRepo, config.PERSIST_FLUSH_MS);
  const roomRegistry = new RoomRegistry(roomRepo, updateRepo, persistenceService, auditService, config.ROOM_UNLOAD_IDLE_MS);

  const deps = {
    config,
    roomService,
    joinService,
    auditService,
    roomRegistry,
    roomRepo,
    memberRepo,
    auditRepo,
  };

  const app = buildApp(deps);
  const wss = new WebSocketServer({ noServer: true });
  const upgradeHandler = createUpgradeGate(wss, deps);

  app.server.on('upgrade', (req, socket, head) => {
    upgradeHandler(req, socket, head);
  });

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const wsUrlBase = `ws://127.0.0.1:${port}/ws/rooms/`;

  const roomId = 'bench-room-1';
  const createRes = await roomService.createRoom({
    roomId,
    creatorName: 'BenchHost',
  });
  if ('error' in createRes) {
    throw new Error(`Failed to create benchmark room: ${JSON.stringify(createRes)}`);
  }
  const roomEpoch = createRes.room.epoch;
  const serverRoom = roomRegistry.getOrCreate(roomId);
  if (!serverRoom) {
    throw new Error(`Failed to create server room: ${roomId}`);
  }

  const numClients = 5;
  interface ClientState {
    id: number;
    client: SyncClient;
    doc: Y.Doc;
    yText: Y.Text;
  }

  const clients: ClientState[] = [];

  // Phase tracking
  const isolatedSamples: number[] = [];
  const burstSamples: number[] = [];

  // Expected tokens map: token -> sendTime
  const pendingTokens = new Map<string, { sendTime: number; senderId: number; peersReceived: Set<number> }>();

  for (let i = 1; i <= numClients; i++) {
    const memberId = `bench-member-${i}`;
    const token = await joinService.issueRoomToken({
      roomId,
      memberId,
      displayName: `BenchUser${i}`,
      roomEpoch,
      passcodeVersion: 0,
    });

    const clientDoc = new Y.Doc();
    const yText = clientDoc.getText('codemirror');

    const client = new SyncClient({
      url: `${wsUrlBase}${roomId}`,
      token,
      doc: clientDoc,
      batchWindowMs: 10, // low batch window for reactive benchmark
      webSocketFactory: (url, protocols) => new WebSocket(url, protocols),
    });

    const state: ClientState = { id: i, client, doc: clientDoc, yText };
    clients.push(state);

    // Observer to measure peer arrival latency
    yText.observe(() => {
      const now = performance.now();
      const currentText = yText.toString();

      for (const [tokenStr, meta] of pendingTokens.entries()) {
        if (meta.senderId !== i && !meta.peersReceived.has(i)) {
          if (currentText.includes(tokenStr)) {
            meta.peersReceived.add(i);
            const latency = now - meta.sendTime;
            if (tokenStr.startsWith('⟦iso:')) {
              isolatedSamples.push(latency);
            } else if (tokenStr.startsWith('⟦bst:')) {
              burstSamples.push(latency);
            }
          }
        }
      }
    });
  }

  // Connect all clients and wait for connected status
  for (const c of clients) {
    c.client.connect();
  }

  const waitForConnection = async (): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      if (clients.every((c) => c.client.connectionStatus === 'connected')) {
        return;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Benchmark: Failed to connect all clients within 5s');
  };

  await waitForConnection();
  console.log(`Connected ${numClients} benchmark clients successfully.`);

  // ---------------------------------------------------------
  // PHASE 1: Isolated Edits (1 edit/sec across clients)
  // ---------------------------------------------------------
  const totalIsolatedEdits = 50;
  console.log(`\nStarting Phase 1: ${totalIsolatedEdits} isolated edits (round-robin)...`);

  for (let i = 0; i < totalIsolatedEdits; i++) {
    const sender = clients[i % numClients];
    if (!sender) continue;
    const tokenStr = `⟦iso:${sender.id}:${i}⟧`;
    const sendTime = performance.now();

    pendingTokens.set(tokenStr, {
      sendTime,
      senderId: sender.id,
      peersReceived: new Set<number>(),
    });

    sender.yText.insert(sender.yText.length, tokenStr);

    // Wait until all 4 peer clients receive this edit
    const deadline = performance.now() + 2000;
    while (performance.now() < deadline) {
      const meta = pendingTokens.get(tokenStr);
      if (meta && meta.peersReceived.size === numClients - 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 5));
    }

    pendingTokens.delete(tokenStr);
    await new Promise((r) => setTimeout(r, 20));
  }

  const isoStats = calculatePercentiles(isolatedSamples);
  console.log(`Phase 1 Complete: ${isoStats.count} peer arrival samples collected.`);
  console.log(`  p50: ${isoStats.p50Ms}ms | p95: ${isoStats.p95Ms}ms | p99: ${isoStats.p99Ms}ms | avg: ${isoStats.avgMs}ms`);

  // ---------------------------------------------------------
  // PHASE 2: Burst Typing (15 chars/sec/client concurrent)
  // ---------------------------------------------------------
  const charsPerClient = 25;
  const burstIntervalMs = Math.round(1000 / 15); // ~66ms
  console.log(`\nStarting Phase 2: Burst typing (${charsPerClient} chars/client at 15 chars/sec concurrent)...`);

  const clientBurstPromises = clients.map(async (sender) => {
    for (let j = 0; j < charsPerClient; j++) {
      const tokenStr = `⟦bst:${sender.id}:${j}⟧`;
      const sendTime = performance.now();

      pendingTokens.set(tokenStr, {
        sendTime,
        senderId: sender.id,
        peersReceived: new Set<number>(),
      });

      sender.yText.insert(sender.yText.length, tokenStr);
      await new Promise((r) => setTimeout(r, burstIntervalMs));
    }
  });

  await Promise.all(clientBurstPromises);

  // Wait for all burst tokens to settle across all peers
  const burstDeadline = performance.now() + 5000;
  while (performance.now() < burstDeadline) {
    let allReceived = true;
    for (const meta of pendingTokens.values()) {
      if (meta.peersReceived.size < numClients - 1) {
        allReceived = false;
        break;
      }
    }
    if (allReceived) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const burstStats = calculatePercentiles(burstSamples);
  console.log(`Phase 2 Complete: ${burstStats.count} peer arrival samples collected.`);
  console.log(`  p50: ${burstStats.p50Ms}ms | p95: ${burstStats.p95Ms}ms | p99: ${burstStats.p99Ms}ms | avg: ${burstStats.avgMs}ms`);

  // ---------------------------------------------------------
  // Report & Persistence
  // ---------------------------------------------------------
  const results: BenchResults = {
    timestamp: new Date().toISOString(),
    config: {
      numClients,
      isolatedEditsCount: totalIsolatedEdits,
      burstCharsPerClient: charsPerClient,
      burstRateCharsPerSec: 15,
    },
    isolatedEdits: isoStats,
    burstTyping: burstStats,
  };

  const outputPaths = [
    path.resolve(process.cwd(), 'bench-results.json'),
    path.resolve(process.cwd(), 'tests', 'chaos', 'bench-results.json'),
  ];

  for (const outPath of outputPaths) {
    try {
      fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
      console.log(`Wrote benchmark results to ${outPath}`);
    } catch {
      // ignore
    }
  }

  // Teardown
  for (const c of clients) {
    c.client.destroy();
    c.doc.destroy();
  }
  for (const ws of wss.clients) {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
  }
  serverRoom.destroy();
  roomRegistry.destroy();
  persistenceService.destroy();
  wss.close();
  await app.close();
  db.close();

  console.log('\nBenchmark completed successfully.');
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
