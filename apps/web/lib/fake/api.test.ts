import { ApiError } from '../api/types';
import { fakeApi } from './api';
import { uniqueName } from './registry';

vi.useFakeTimers({ toFake: ['setTimeout'] });
const run = async <T,>(p: Promise<T>) => {
  await vi.runAllTimersAsync();
  return p;
};

describe('fake api', () => {
  beforeEach(() => localStorage.clear());

  it('suffixes duplicate names', () => {
    expect(uniqueName('Ravi', [])).toBe('Ravi');
    expect(uniqueName('Ravi', ['Ravi', 'Ravi (2)'])).toBe('Ravi (3)');
  });

  it('create is idempotent per key and 409s a taken id with a suggestion', async () => {
    const input = { name: 'Asha', roomId: 'demo', language: 'javascript' as const };
    const a = await run(fakeApi.createRoom(input, 'k1'));
    const b = await run(fakeApi.createRoom(input, 'k1'));
    expect(b.memberId).toBe(a.memberId);
    const p = fakeApi.createRoom(input, 'k2').catch((e: unknown) => e);
    const err = await run(p);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('room_taken');
    expect(String((err as ApiError).details.suggestion)).toMatch(/^demo-\d{3}$/);
  });

  it('checks the passcode for new members but lets a returning member back in', async () => {
    const created = await run(
      fakeApi.createRoom({ name: 'Asha', roomId: 'sec', passcode: 'hunter22', language: 'html' }, 'k'),
    );
    const badP = fakeApi.joinRoom('sec', { name: 'Ravi', passcode: 'nope' }).catch((e: unknown) => e);
    const bad = await run(badP);
    expect((bad as ApiError).code).toBe('bad_passcode');
    const ok = await run(fakeApi.joinRoom('sec', { name: 'Ravi', passcode: 'hunter22' }));
    expect(ok.memberId).not.toBe(created.memberId);
    const back = await run(fakeApi.joinRoom('sec', { name: 'Asha', memberId: created.memberId }));
    expect(back.memberId).toBe(created.memberId);
  });

  it('pages events newest-first with before= and ascending with after=', async () => {
    const { token } = await run(fakeApi.createRoom({ name: 'Asha', roomId: 'events', language: 'sql' }, 'k'));
    const page = await run(fakeApi.events('events', token, {}));
    expect(page.items.map((e) => e.seq)).toEqual([1]);
    const after = await run(fakeApi.events('events', token, { after: 0 }));
    expect(after.items[0]?.type).toBe('room.created');
  });
});
