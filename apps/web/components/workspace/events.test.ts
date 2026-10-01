import type { AuditEvent } from '@tether/shared';
import { describeEvent } from './events';

const ev = (type: string, payload: Record<string, unknown> = {}, actorName: string | null = 'Laasya'): AuditEvent => ({
  id: 1,
  seq: 1,
  roomId: 'r',
  type,
  actorMemberId: 'm',
  actorName,
  payload,
  createdAt: '',
});

describe('describeEvent', () => {
  it('formats edit summaries with line ranges', () => {
    expect(describeEvent(ev('edit.summary', { inserted: 34, deleted: 5, lines: [12, 18] })).text).toBe('Laasya edited L12-18 (+34 -5)');
    expect(describeEvent(ev('edit.summary', { inserted: 1, deleted: 0, lines: [3, 3] })).text).toBe('Laasya edited L3 (+1 -0)');
  });

  it('distinguishes leave reasons and never trusts payload types blindly', () => {
    expect(describeEvent(ev('member.left', { reason: 'kicked', name: 'Hriday' })).text).toBe('Hriday was removed by the host');
    expect(describeEvent(ev('member.left', { reason: 'timeout', name: 42 })).text).toBe('Laasya timed out');
  });

  it('names the new host and never shows raw ids or close codes', () => {
    expect(describeEvent(ev('host.changed', { to: 'f3a9c2e1-uuid', toName: 'Hriday' })).text).toBe('Hriday is now host');
    expect(describeEvent(ev('host.changed', { to: 'f3a9c2e1-uuid' })).text).toBe('Someone is now host');
    expect(describeEvent(ev('security.flood', { code: 4008 })).text).toBe('Laasya was disconnected for sending too much, too fast');
    expect(describeEvent(ev('security.protocol', { code: 4002 })).text).not.toMatch(/\d/);
  });

  it('renders unknown types instead of crashing', () => {
    expect(describeEvent(ev('future.thing', {}, null)).text).toBe('Someone: future.thing');
  });
});
