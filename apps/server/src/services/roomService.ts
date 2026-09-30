import crypto from 'node:crypto';
import { RoomRepo, RoomRow } from '../repo/roomRepo.js';
import { MemberRepo } from '../repo/memberRepo.js';
import { JoinService } from './joinService.js';
import { AuditService } from './auditService.js';

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

const ADJECTIVES = ['swift', 'quiet', 'bright', 'calm', 'rapid', 'silent', 'bold', 'vivid'];
const NOUNS = ['river', 'ember', 'falcon', 'harbor', 'forest', 'summit', 'meadow', 'beacon'];

export function generateRoomSlug(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]!;
  const digits = Math.floor(1000 + Math.random() * 9000);
  return `${adj}-${noun}-${digits}`;
}

export interface CreateRoomResult {
  room: {
    id: string;
    epoch: string;
    language: string;
    locked: boolean;
    hasPasscode: boolean;
  };
  token: string;
  memberId: string;
  isExisting?: boolean;
}

export class RoomService {
  constructor(
    private roomRepo: RoomRepo,
    private memberRepo: MemberRepo,
    private joinService: JoinService,
    private auditService: AuditService
  ) {}

  public async createRoom(params: {
    roomId?: string;
    passcode?: string | null;
    creatorName: string;
    language?: string;
    createKey?: string | null;
  }): Promise<CreateRoomResult | { error: 'room_taken'; suggestion: string }> {
    const slug = params.roomId ? params.roomId.toLowerCase().trim() : generateRoomSlug();

    if (!SLUG_REGEX.test(slug)) {
      throw new Error('Invalid roomId format. Must be 3-32 lowercase alphanumeric characters or hyphens.');
    }

    // Check Idempotency-Key
    if (params.createKey) {
      const existingByKey = this.roomRepo.findByCreateKey(params.createKey);
      if (existingByKey) {
        const creatorMember = this.memberRepo.getMember(existingByKey.id, existingByKey.created_by);
        const token = await this.joinService.issueRoomToken({
          memberId: existingByKey.created_by,
          roomId: existingByKey.id,
          displayName: creatorMember?.display_name ?? params.creatorName,
          passcodeVersion: existingByKey.passcode_version,
          roomEpoch: existingByKey.epoch,
        });

        return {
          room: {
            id: existingByKey.id,
            epoch: existingByKey.epoch,
            language: existingByKey.language,
            locked: existingByKey.locked === 1,
            hasPasscode: existingByKey.passcode_hash !== null,
          },
          token,
          memberId: existingByKey.created_by,
          isExisting: true,
        };
      }
    }

    // Check if slug taken
    const existing = this.roomRepo.findById(slug);
    if (existing) {
      const suggestion = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
      return { error: 'room_taken', suggestion };
    }

    const epoch = crypto.randomUUID();
    const creatorMemberId = crypto.randomUUID();
    let passcodeHash: string | null = null;

    if (params.passcode && params.passcode.trim().length > 0) {
      passcodeHash = await this.joinService.hashPasscode(params.passcode.trim());
    }

    const language = params.language ?? 'javascript';

    this.roomRepo.create({
      id: slug,
      epoch,
      createdBy: creatorMemberId,
      passcodeHash,
      passcodeVersion: passcodeHash ? 1 : 0,
      language,
      locked: false,
      createKey: params.createKey,
    });

    this.memberRepo.upsertMember({
      roomId: slug,
      memberId: creatorMemberId,
      displayName: params.creatorName,
      colorIndex: 0,
    });

    this.auditService.logEvent(slug, {
      type: 'room.created',
      actorMemberId: creatorMemberId,
      actorName: params.creatorName,
      payload: {
        language,
        hasPasscode: passcodeHash !== null,
      },
    });

    const token = await this.joinService.issueRoomToken({
      memberId: creatorMemberId,
      roomId: slug,
      displayName: params.creatorName,
      passcodeVersion: passcodeHash ? 1 : 0,
      roomEpoch: epoch,
    });

    return {
      room: {
        id: slug,
        epoch,
        language,
        locked: false,
        hasPasscode: passcodeHash !== null,
      },
      token,
      memberId: creatorMemberId,
    };
  }

  public getRoom(id: string): RoomRow | undefined {
    return this.roomRepo.findById(id);
  }
}
