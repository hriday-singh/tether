/**
 * Server memory/CPU benchmark. Run: pnpm --filter @tether/chaos mem-bench
 *
 * M1 typing  : 5 clients type into a preloaded doc; times the server's inbound hot path
 *              (Room.handleInboundUpdate) directly so in-process client work doesn't blur it.
 * M2 reload  : rows left in room_updates after M1 and the cost of a crash-style reload
 *              (fresh registry, no unload flush) that replays them.
 * M3 churn   : create/load/unload many rooms, then check retained heap after forced GC.
 */
import { performance, PerformanceObserver } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { createDatabase } from '@tether/server/db/database';
import { RoomRepo } from '@tether/server/repo/roomRepo';
import { UpdateRepo } from '@tether/server/repo/updateRepo';
import { MemberRepo } from '@tether/server/repo/memberRepo';
import { AuditRepo } from '@tether/server/repo/auditRepo';
import { JoinService } from '@tether/server/services/joinService';
import { RoomService } from '@tether/server/services/roomService';
import { AuditService } from '@tether/server/services/auditService';
import { ChatRepo } from '@tether/server/repo/chatRepo';
import { ChatService } from '@tether/server/services/chatService';
import { PersistenceService } from '@tether/server/services/persistenceService';
import { RoomRegistry } from '@tether/server/rooms/roomRegistry';
import { Room } from '@tether/server/rooms/room';
import { buildApp } from '@tether/server/http/app';
import { createUpgradeGate } from '@tether/server/ws/upgradeGate';
import { ServerConfig } from '@tether/server/config';
import { SyncClient } from '@tether/sync-client';

const NUM_CLIENTS = 5;
const PRELOAD_CHARS = 80_000; // demo scale: docs under 100 KB
const TYPE_MS = Number(process.env.MEM_BENCH_TYPE_MS ?? 8_000);
const CHARS_PER_SEC = 15;
const CHURN_ROOMS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (b: number) => Number((b / 1024 / 1024).toFixed(2));
const gc = (): void => (globalThis as { gc?: () => void }).gc?.();

async function waitFor(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`memBench: timed out waiting for ${what}`);
}

// Accumulates wall time spent inside a Room method across all calls.
function timeMethod(name: 'handleInboundUpdate' | 'handleInboundSyncStep2'): { ms: number; calls: number } {
  const stat = { ms: 0, calls: 0 };
  const proto = Room.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const original = proto[name]!;
  proto[name] = function (this: unknown, ...args: unknown[]) {
    const t = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      stat.ms += performance.now() - t;
      stat.calls++;
    }
  };
  return stat;
}

async function main(): Promise<void> {
  if (!(globalThis as { gc?: unknown }).gc) throw new Error('run with node --expose-gc');

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
    TRUST_PROXY_HOPS: 0,
    DEMO_MODE: false,
  };
  const db = createDatabase(':memory:');
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
    chatService: new ChatService(new ChatRepo(db)),
    persistenceService,
  };
  const app = buildApp(deps);
  const wss = new WebSocketServer({ noServer: true });
  const upgrade = createUpgradeGate(wss, deps);
  app.server.on('upgrade', (req, socket, head) => upgrade(req, socket, head));
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  // ---------------- M1 typing ----------------
  const roomId = 'mem-bench-room';
  const created = await roomService.createRoom({ roomId, creatorName: 'Bench' });
  if ('error' in created) throw new Error(JSON.stringify(created));
  const serverRoom = roomRegistry.getOrCreate(roomId)!;
  const serverText = serverRoom.doc.getText('codemirror');

  const clients: { client: SyncClient; doc: Y.Doc; text: Y.Text }[] = [];
  for (let i = 1; i <= NUM_CLIENTS; i++) {
    const token = await joinService.issueRoomToken({
      roomId,
      memberId: `m${i}`,
      displayName: `U${i}`,
      roomEpoch: created.room.epoch,
      passcodeVersion: 0,
    });
    const doc = new Y.Doc();
    const client = new SyncClient({
      url: `ws://127.0.0.1:${port}/ws/rooms/${roomId}`,
      token,
      doc,
      batchWindowMs: 30,
      webSocketFactory: (url: string, protocols?: string | string[]) => new WebSocket(url, protocols),
    });
    clients.push({ client, doc, text: doc.getText('codemirror') });
    client.connect();
  }
  await waitFor(() => clients.every((c) => c.client.connectionStatus === 'connected'), 5000, 'connect');

  // Preload in 8 KB chunks so no frame trips the flood/size guards.
  const line = 'const value = computeSomething(input, options); // filler\n';
  const preload = line.repeat(Math.ceil(PRELOAD_CHARS / line.length)).slice(0, PRELOAD_CHARS);
  for (let off = 0; off < preload.length; off += 8192) {
    clients[0]!.text.insert(off, preload.slice(off, off + 8192));
    await sleep(100);
  }
  await waitFor(() => clients.every((c) => c.text.length === PRELOAD_CHARS), 10000, 'preload sync');
  await sleep(500);

  const hot = timeMethod('handleInboundUpdate');
  let gcCount = 0;
  let gcMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      gcCount++;
      gcMs += e.duration;
    }
  });
  obs.observe({ entryTypes: ['gc'] });
  gc();
  let heapPeak = 0;
  const sampler = setInterval(() => {
    heapPeak = Math.max(heapPeak, process.memoryUsage().heapUsed);
  }, 20);
  const cpu0 = process.cpuUsage();

  const intervalMs = Math.round(1000 / CHARS_PER_SEC);
  await Promise.all(
    clients.map(async (c) => {
      const end = Date.now() + TYPE_MS;
      while (Date.now() < end) {
        c.text.insert(Math.floor(Math.random() * c.text.length), 'x');
        await sleep(intervalMs);
      }
    })
  );
  await waitFor(() => clients.every((c) => c.text.length === serverText.length), 10000, 'typing sync');
  await sleep(300);

  const cpu = process.cpuUsage(cpu0);
  clearInterval(sampler);
  obs.disconnect();

  const m1 = {
    serverUpdates: hot.calls,
    hotPathTotalMs: Number(hot.ms.toFixed(1)),
    hotPathPerUpdateUs: Number(((hot.ms / Math.max(1, hot.calls)) * 1000).toFixed(1)),
    processCpuMs: Math.round((cpu.user + cpu.system) / 1000),
    gcCount,
    gcMs: Number(gcMs.toFixed(1)),
    heapPeakMb: mb(heapPeak),
    docBytes: Y.encodeStateAsUpdate(serverRoom.doc).byteLength,
  };

  // ---------------- M2 reload after crash ----------------
  await sleep(200); // let the last persistence window flush
  const rowsWhileActive = updateRepo.countUpdates(roomId);
  gc();
  const heapBeforeReload = process.memoryUsage().heapUsed;
  const crashRegistry = new RoomRegistry(roomRepo, updateRepo, new PersistenceService(updateRepo, roomRepo, 50), auditService);
  const t0 = performance.now();
  const reloaded = crashRegistry.getOrCreate(roomId)!;
  const reloadMs = performance.now() - t0;
  const reloadOk = reloaded.doc.getText('codemirror').toString() === serverText.toString();
  const reloadHeapMb = mb(process.memoryUsage().heapUsed - heapBeforeReload);
  crashRegistry.destroy();
  const m2 = { rowsWhileActive, reloadMs: Number(reloadMs.toFixed(1)), reloadHeapMb, reloadOk };

  for (const c of clients) {
    c.client.destroy();
    c.doc.destroy();
  }
  for (const ws of wss.clients) ws.terminate();

  // ---------------- M3 churn ----------------
  roomRegistry.unloadIdleRooms(Date.now() + config.ROOM_UNLOAD_IDLE_MS * 2);
  gc();
  const heapBeforeChurn = process.memoryUsage().heapUsed;
  for (let i = 0; i < CHURN_ROOMS; i++) {
    const id = `churn-${i}`;
    await roomService.createRoom({ roomId: id, creatorName: 'C' });
    roomRegistry.getOrCreate(id);
  }
  roomRegistry.unloadIdleRooms(Date.now() + config.ROOM_UNLOAD_IDLE_MS * 2);
  await sleep(100);
  gc();
  const seqCounters = (auditService as unknown as { seqCounters: Map<string, number> }).seqCounters;
  const m3 = {
    rooms: CHURN_ROOMS,
    activeAfterUnload: roomRegistry.activeRoomCount,
    retainedHeapKb: Math.round((process.memoryUsage().heapUsed - heapBeforeChurn) / 1024),
    auditSeqCacheEntries: seqCounters.size,
  };

  console.log(JSON.stringify({ m1, m2, m3 }, null, 2));

  roomRegistry.destroy();
  persistenceService.destroy();
  wss.close();
  await app.close();
  db.close();
}

main().catch((err) => {
  console.error('memBench failed:', err);
  process.exit(1);
});
