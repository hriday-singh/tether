import { FakeSyncClient, type FakeSyncOptions } from '../fake/fake-sync-client';
import { ServerSyncClient, type ServerSyncOptions } from './server-sync-client';
import type { SyncClient } from './types';

export * from './types';

export function createSyncClient(opts: FakeSyncOptions & ServerSyncOptions): SyncClient {
  if (process.env.NEXT_PUBLIC_SYNC_MODE === 'server') {
    return new ServerSyncClient(opts);
  }
  return new FakeSyncClient(opts);
}
