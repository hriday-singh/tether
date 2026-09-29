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
import { PRNG } from './prng.js';
import { ActionGenerator, ChaosClientHandle } from './actions.js';
import { FaultyWebSocket } from './faultyWebSocket.js';
import { ChaosRunOptions, ChaosRunSummary } from './types.js';
import {
  assertI1Convergence,
  assertI2NoLoss,
  assertI3NoDuplication,
  assertI4ThrottleBound,
  assertDurabilityAndAcks,
  assertDbReloadMatch,
  assertQuietChecksumVerified,
} from './invariants.js';

export async function runChaosSession(options: ChaosRunOptions = {}): Promise<ChaosRunSummary> {
  const seed = options.seed ?? Math.floor(Math.random() * 1000000);
  const numClients = options.numClients ?? 5;
  const steps = options.steps ?? 100;
  const quiescenceMs = options.quiescenceMs ?? 2000;
  const verbose = options.verbose ?? false;

  const prng = new PRNG(seed);
  const actionGen = new ActionGenerator(prng);

  const config: ServerConfig = {
    PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    SQLITE_PATH: ':memory:',
    DATABASE_DRIVER: 'sqlite',
    ALLOWED_ORIGINS: ['*'],
    JWT_SECRET: 'chaos-test-jwt-secret-at-least-32-chars-long-tether!',
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

  const roomId = `chaos-room-${seed}`;
  const createRes = await roomService.createRoom({
    roomId,
    creatorName: 'ChaosHost',
  });
  if ('error' in createRes) {
    throw new Error(`Failed to create chaos room: ${JSON.stringify(createRes)}`);
  }
  const roomEpoch = createRes.room.epoch;

  // Retrieve in-memory server Room
  const serverRoom = roomRegistry.getOrCreate(roomId);
  if (!serverRoom) {
    throw new Error(`Failed to create server room: ${roomId}`);
  }
  const serverDoc = serverRoom.doc;

  const clientHandles = new Map<number, ChaosClientHandle>();
  const allClientIds: number[] = [];
  const outboundTimestampsMap = new Map<string, number[]>();
  roomRegistry.onBroadcast = (memberId, ts) => {
    let list = outboundTimestampsMap.get(memberId);
    if (!list) {
      list = [];
      outboundTimestampsMap.set(memberId, list);
    }
    list.push(ts);
  };

  // Initialize N clients
  for (let i = 1; i <= numClients; i++) {
    allClientIds.push(i);
    const memberId = `chaos-member-${i}`;
    const token = await joinService.issueRoomToken({
      roomId,
      memberId,
      displayName: `User${i}`,
      roomEpoch,
      passcodeVersion: 0,
    });

    const clientDoc = new Y.Doc();
    const timestamps: number[] = [];

    const client = new SyncClient({
      url: `${wsUrlBase}${roomId}`,
      token,
      doc: clientDoc,
      batchWindowMs: 100,
      webSocketFactory: (url, protocols) => {
        const sock = new FaultyWebSocket(url, protocols, {
          transportOptions: {
            rng: () => prng.nextFloat(),
          },
        });
        const handle = clientHandles.get(i);
        if (handle) {
          handle.activeSocket = sock;
        }
        return sock as unknown as WebSocket;
      },
    });

    const handle: ChaosClientHandle = {
      id: i,
      client,
      doc: clientDoc,
      activeSocket: null,
      isDisconnected: false,
      outboundTimestamps: timestamps,
    };
    clientHandles.set(i, handle);
  }

  // Connect all clients and wait for initial 'connected' state
  for (const handle of clientHandles.values()) {
    handle.client.connect();
  }

  const waitForAllConnected = async (timeoutMs = 5000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const allConnected = Array.from(clientHandles.values()).every(
        (h) => h.isDisconnected || h.client.connectionStatus === 'connected'
      );
      if (allConnected) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Timed out waiting for initial client connections');
  };

  await waitForAllConnected();

  // Execute stochastic chaos actions
  for (let step = 1; step <= steps; step++) {
    const connectedIds = Array.from(clientHandles.values())
      .filter((h) => !h.isDisconnected && h.client.connectionStatus === 'connected')
      .map((h) => h.id);

    const action = actionGen.generateAction(step, connectedIds, allClientIds);
    actionGen.applyAction(action, clientHandles);

    if (verbose && step % 25 === 0) {
      console.log(`[Chaos seed=${seed}] Executed step ${step}/${steps} (action: ${action.type})`);
    }

    // Yield small tick to allow async IO interleaving
    await new Promise((r) => setTimeout(r, 2));
  }

  // Healing phase
  const healStart = Date.now();
  for (const handle of clientHandles.values()) {
    if (handle.activeSocket) {
      handle.activeSocket.setLatency(0, 0);
      handle.activeSocket.resume();
    }
    handle.isDisconnected = false;
    if (handle.client.connectionStatus !== 'connected') {
      handle.client.connect();
    }
  }

  // Wait for quiescence & full convergence
  let converged = false;
  const quiescenceDeadline = Date.now() + quiescenceMs + 5000;
  let lastServerText = '';
  let stableTicks = 0;

  while (Date.now() < quiescenceDeadline) {
    const allConnected = Array.from(clientHandles.values()).every(
      (h) => h.client.connectionStatus === 'connected'
    );
    const allAcked = Array.from(clientHandles.values()).every(
      (h) => h.client.unackedCount === 0
    );

    const currentServerText = serverDoc.getText('codemirror').toString();
    const allTextsMatch = Array.from(clientHandles.values()).every(
      (h) => h.doc.getText('codemirror').toString() === currentServerText
    );

    if (allConnected && allAcked && allTextsMatch) {
      if (currentServerText === lastServerText) {
        stableTicks++;
        if (stableTicks >= 5) {
          converged = true;
          break;
        }
      } else {
        lastServerText = currentServerText;
        stableTicks = 0;
      }
    }

    await new Promise((r) => setTimeout(r, 100));
  }

  const clientDocs = Array.from(clientHandles.values()).map((h) => h.doc);
  const clientsList = Array.from(clientHandles.values()).map((h) => h.client);
  const serverText = serverDoc.getText('codemirror').toString();

  try {
    if (!converged) {
      throw new Error(
        `Quiescence timeout: Clients did not converge within ${quiescenceMs}ms after healing.\n` +
          `Server length: ${serverText.length}\n` +
          `Client texts: ${clientDocs.map((d, idx) => `[#${idx + 1}: ${d.getText('codemirror').length}]`).join(', ')}`
      );
    }

    // Invariant assertions
    assertI1Convergence(serverDoc, clientDocs);
    assertI2NoLoss(serverText, actionGen.activeTags);
    assertI3NoDuplication(serverText);
    assertI4ThrottleBound(outboundTimestampsMap, 9);
    assertDurabilityAndAcks(clientsList);
    persistenceService.flush(roomId, serverDoc);
    assertDbReloadMatch(serverDoc, db, roomId);
    assertQuietChecksumVerified(clientsList);
  } finally {
    // Teardown
    for (const handle of clientHandles.values()) {
      try {
        handle.activeSocket?.terminate();
      } catch {
        // ignore
      }
      handle.client.destroy();
      handle.doc.destroy();
    }
    for (const clientWs of wss.clients) {
      try {
        clientWs.terminate();
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
  }

  return {
    seed,
    stepsExecuted: steps,
    activeTagsCount: actionGen.activeTags.size,
    deletedTagsCount: actionGen.deletedTags.size,
    totalTagsInserted: actionGen.allInsertedTags.size,
    convergedLength: serverText.length,
    clientsConverged: numClients,
    quiescenceDurationMs: Date.now() - healStart,
  };
}
