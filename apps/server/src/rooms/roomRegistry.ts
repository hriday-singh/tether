import { Room } from './room.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { UpdateRepo } from '../repo/updateRepo.js';
import { PersistenceService } from '../services/persistenceService.js';
import { AuditService } from '../services/auditService.js';
import { ROOM_EXPIRE_IDLE_MS, ROOM_EXPIRE_SWEEP_MS, ROOM_UNLOAD_IDLE_MS } from '@tether/shared/constants';

export class RoomRegistry {
  private activeRooms = new Map<string, Room>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private lastExpireAt = 0;
  public onBroadcast?: (sourceMemberId: string, timestamp: number) => void;

  constructor(
    private roomRepo: RoomRepo,
    private updateRepo: UpdateRepo,
    private persistenceService: PersistenceService,
    private auditService: AuditService,
    private idleMs: number = ROOM_UNLOAD_IDLE_MS,
    private hostGraceMs?: number,
    private expireIdleMs: number = ROOM_EXPIRE_IDLE_MS
  ) {
    this.sweepTimer = setInterval(() => {
      this.unloadIdleRooms();
      const now = Date.now();
      if (now - this.lastExpireAt >= ROOM_EXPIRE_SWEEP_MS) {
        this.lastExpireAt = now;
        this.expireIdleRooms(now);
      }
    }, 10000);

    this.persistenceService.resolveDoc = (roomId) => this.activeRooms.get(roomId)?.doc;

    this.auditService.onEventLogged = (roomId, event) => {
      const room = this.activeRooms.get(roomId);
      if (room) {
        room.broadcastControl({
          t: 'event',
          event,
        });
      }
    };
  }

  public get(roomId: string): Room | undefined {
    return this.activeRooms.get(roomId);
  }

  public getOrCreate(roomId: string): Room | null {
    const existing = this.activeRooms.get(roomId);
    if (existing) {
      return existing;
    }

    const roomRow = this.roomRepo.findById(roomId);
    if (!roomRow) {
      return null;
    }

    // Replay snapshot + tail updates from repository
    const tailUpdates = this.updateRepo.getTailAfter(roomId, 0).map((u) => u.update_data);
    const room = new Room(
      roomRow.id,
      roomRow.epoch,
      roomRow.snapshot,
      tailUpdates,
      this.persistenceService,
      this.auditService,
      this.onBroadcast,
      this.hostGraceMs
    );

    this.activeRooms.set(roomId, room);
    return room;
  }

  public unloadIdleRooms(now: number = Date.now()): number {
    let unloaded = 0;
    for (const [roomId, room] of this.activeRooms.entries()) {
      if (room.connectionCount === 0 && now - room.lastActiveAt >= this.idleMs) {
        this.persistenceService.flush(roomId, room.doc);
        this.roomRepo.touchLastActive(roomId);
        room.destroy();
        this.activeRooms.delete(roomId);
        this.auditService.forgetRoom(roomId);
        unloaded++;
      }
    }
    return unloaded;
  }

  public get activeRoomCount(): number {
    return this.activeRooms.size;
  }

  /** Deletes rooms nobody has used for `expireIdleMs`. Loaded rooms are touched first so they never expire mid-session. */
  public expireIdleRooms(now: number = Date.now()): number {
    for (const roomId of this.activeRooms.keys()) this.roomRepo.touchLastActive(roomId);
    return this.roomRepo.deleteIdleBefore(new Date(now - this.expireIdleMs).toISOString());
  }

  public destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const [roomId, room] of this.activeRooms.entries()) {
      this.persistenceService.flush(roomId, room.doc);
      room.destroy();
    }
    this.activeRooms.clear();
  }
}
