import { ServerSyncClient, type ServerSyncOptions } from './server-sync-client';
import type { SyncClient } from './types';

export * from './types';

export function createSyncClient(opts: ServerSyncOptions): SyncClient {
  return new ServerSyncClient(opts);
}
