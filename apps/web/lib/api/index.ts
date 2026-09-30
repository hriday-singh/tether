import { fetchApi } from './fetch-client';
import type { Api } from './types';

export * from './types';

export const api: Api = fetchApi;

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';
