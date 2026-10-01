import { WebSocketServer } from 'ws';
import { loadConfig } from './config.js';
import { createDatabase } from './db/database.js';
import { RoomRepo } from './repo/roomRepo.js';
import { UpdateRepo } from './repo/updateRepo.js';
import { MemberRepo } from './repo/memberRepo.js';
import { AuditRepo } from './repo/auditRepo.js';
import { JoinService } from './services/joinService.js';
import { RoomService } from './services/roomService.js';
import { AuditService } from './services/auditService.js';
import { ChatRepo } from './repo/chatRepo.js';
import { ChatService } from './services/chatService.js';
import { PersistenceService } from './services/persistenceService.js';
import { RoomRegistry } from './rooms/roomRegistry.js';
import { BotStormManager } from './rooms/botStormManager.js';
import { buildApp } from './http/app.js';
import { createUpgradeGate, setDraining } from './ws/upgradeGate.js';

async function main() {
  const config = loadConfig();

  const db = createDatabase(config.SQLITE_PATH);
  const roomRepo = new RoomRepo(db);
  const updateRepo = new UpdateRepo(db);
  const memberRepo = new MemberRepo(db);
  const auditRepo = new AuditRepo(db);

  const joinService = new JoinService(config.JWT_SECRET);
  const auditService = new AuditService(auditRepo);
  const chatService = new ChatService(new ChatRepo(db));
  const roomService = new RoomService(roomRepo, memberRepo, joinService, auditService);
  const persistenceService = new PersistenceService(updateRepo, roomRepo, config.PERSIST_FLUSH_MS);
  const roomRegistry = new RoomRegistry(
    roomRepo,
    updateRepo,
    persistenceService,
    auditService,
    config.ROOM_UNLOAD_IDLE_MS,
    config.HOST_GRACE_MS
  );
  const botStormManager = new BotStormManager({
    joinService,
    memberRepo,
    roomRepo,
    auditService,
    roomRegistry,
    chatService,
  });

  const deps = {
    config,
    roomService,
    joinService,
    auditService,
    roomRegistry,
    roomRepo,
    memberRepo,
    auditRepo,
    chatService,
    persistenceService,
    botStormManager,
    serverPort: config.PORT,
  };

  const app = buildApp(deps);

  // WebSocket Server on the same HTTP server
  const wss = new WebSocketServer({ noServer: true });
  const upgradeHandler = createUpgradeGate(wss, deps);

  app.server.on('upgrade', (req, socket, head) => {
    upgradeHandler(req, socket, head);
  });

  // Graceful shutdown
  let shuttingDown = false;
  const shutdown = async () => {
    // A second Ctrl+C would otherwise double-destroy and close the DB twice.
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down server...');
    setDraining(true);
    await botStormManager.destroyAll();
    roomRegistry.destroy();
    persistenceService.destroy();
    wss.close();
    await app.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  console.log(`Tether server running on http://${config.HOST}:${config.PORT}`);
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
