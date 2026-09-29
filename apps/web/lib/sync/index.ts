import { FakeSyncClient, type FakeSyncOptions } from '../fake/fake-sync-client';
import type { SyncClient } from './types';

export * from './types';

// TODO(M3): return the real packages/sync-client SyncClient when NEXT_PUBLIC_SYNC_MODE=server.
export function createSyncClient(opts: FakeSyncOptions): SyncClient {
  return new FakeSyncClient(opts);
}
