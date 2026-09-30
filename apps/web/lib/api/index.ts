import { fakeApi } from '../fake/api';
import { fetchApi } from './fetch-client';
import type { Api } from './types';

export * from './types';

export const api: Api =
  process.env.NEXT_PUBLIC_SYNC_MODE === 'server' ? fetchApi : fakeApi;

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
