import type { StatusSnapshot } from '@/lib/sync';
import { describeStatus } from './sync-status-model';

const base: StatusSnapshot = {
  connection: 'online',
  pending: 0,
  verifiedAt: 1_000,
  checksum: 'deadbeef',
  attempt: 0,
  retryAt: null,
  throttled: false,
  unsavedAtClose: 0,
};

describe('describeStatus', () => {
  it('shows Verified only when online, nothing pending and verified', () => {
    expect(describeStatus(base, 4_000)).toMatchObject({ tone: 'success', label: 'Verified in sync' });
    expect(describeStatus(base, 4_000).detail).toContain('3s ago');
  });

  it('never claims Verified while changes are pending or offline', () => {
    expect(describeStatus({ ...base, pending: 2 }, 0).label).toBe('Saving (2)');
    expect(describeStatus({ ...base, connection: 'offline', pending: 3 }, 0).label).toBe('Offline · 3 unsent');
    expect(describeStatus({ ...base, verifiedAt: null }, 0).label).toBe('Syncing…');
  });

  it('counts down the reconnect', () => {
    const v = describeStatus({ ...base, connection: 'reconnecting', attempt: 3, retryAt: 2_500 }, 0);
    expect(v.label).toBe('Connection lost · retry in 3s');
    expect(v.detail).toContain('Attempt 3');
  });
});
