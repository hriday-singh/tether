import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, DatabaseSession } from '../db/database.js';
import { ChatRepo } from '../repo/chatRepo.js';
import { RoomRepo } from '../repo/roomRepo.js';
import { ChatService } from './chatService.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = (n: number, text = `msg ${n}`) => ({
  clientMsgId: uuid(n),
  memberId: 'm1',
  name: 'Alice',
  colorIndex: 3,
  text,
});

describe('ChatService', () => {
  let db: DatabaseSession;
  let chat: ChatService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    const rooms = new RoomRepo(db);
    rooms.create({ id: 'room-a', epoch: 'e', createdBy: 'm1', createKey: null });
    rooms.create({ id: 'room-b', epoch: 'e', createdBy: 'm1', createKey: null });
    chat = new ChatService(new ChatRepo(db));
  });

  afterEach(() => db.close());

  it('assigns a gapless per-room seq, independent across rooms', () => {
    expect(chat.post('room-a', post(1)).message.seq).toBe(1);
    expect(chat.post('room-a', post(2)).message.seq).toBe(2);
    expect(chat.post('room-b', post(3)).message.seq).toBe(1);
    expect(chat.getLatestSeq('room-a')).toBe(2);
  });

  it('stores the author snapshot and text', () => {
    const { message, created } = chat.post('room-a', post(1, 'hello <b>world</b>'));
    expect(created).toBe(true);
    expect(message).toMatchObject({
      roomId: 'room-a',
      clientMsgId: uuid(1),
      memberId: 'm1',
      name: 'Alice',
      colorIndex: 3,
      text: 'hello <b>world</b>',
    });
  });

  it('treats a resend with the same clientMsgId as a no-op', () => {
    const first = chat.post('room-a', post(1));
    const again = chat.post('room-a', post(1, 'different text'));
    expect(again.created).toBe(false);
    expect(again.message).toEqual(first.message);
    expect(chat.getLatestSeq('room-a')).toBe(1);
  });

  it('continues the seq from the database after a restart', () => {
    chat.post('room-a', post(1));
    chat.post('room-a', post(2));
    const restarted = new ChatService(new ChatRepo(db));
    expect(restarted.post('room-a', post(3)).message.seq).toBe(3);
  });

  it('pages before (newest first) and after (oldest first)', () => {
    for (let i = 1; i <= 5; i++) chat.post('room-a', post(i));
    expect(chat.getBefore('room-a', undefined, 2).map((m) => m.seq)).toEqual([5, 4]);
    expect(chat.getBefore('room-a', 4, 10).map((m) => m.seq)).toEqual([3, 2, 1]);
    expect(chat.getAfter('room-a', 2, 2).map((m) => m.seq)).toEqual([3, 4]);
    expect(chat.getAfter('room-a', 0, 1000)).toHaveLength(5);
  });
});
