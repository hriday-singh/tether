import { fakeApi } from '../fake/api';
import type { Api } from './types';

export * from './types';

// TODO(server M2): add the fetch-based client and select it with NEXT_PUBLIC_SYNC_MODE=server.
export const api: Api = fakeApi;

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
