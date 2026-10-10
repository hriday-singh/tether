import {
  type Api,
  type CreateRoomInput,
  type JoinRoomInput,
  type RoomInfo,
  type JoinResult,
  type EventsQuery,
  type EventsPage,
  type ChatPage,
  type AdmissionStatus,
  type ApiErrorCode,
  ApiError,
} from './types';

function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  if (typeof window === 'undefined' && process.env.SERVER_URL) {
    return process.env.SERVER_URL.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') {
    return '';
  }
  return 'http://localhost:4000';
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, options);
  } catch (err) {
    throw new ApiError(0, 'network', (err as Error).message || 'Network request failed');
  }

  if (!res.ok) {
    let errorData: { error?: { code?: string; message?: string; suggestion?: string; details?: unknown } } = {};
    try {
      errorData = await res.json();
    } catch {
      // Non-JSON response
    }

    const serverCode = errorData.error?.code;
    const message = errorData.error?.message || `HTTP ${res.status}`;
    let code: ApiErrorCode = 'network';

    if (res.status === 404) {
      code = 'not_found';
    } else if (res.status === 409) {
      code = 'room_taken';
    } else if (res.status === 401) {
      code = serverCode === 'invalid_passcode' || serverCode === 'passcode_required' ? 'bad_passcode' : 'unauthorized';
    } else if (res.status === 403) {
      code = serverCode === 'banned' || serverCode === 'locked' || serverCode === 'full' ? serverCode : 'unauthorized';
    } else if (res.status === 429) {
      code = 'rate_limited';
    } else if (res.status === 400) {
      code = 'invalid';
    }

    const details: Record<string, unknown> = {};
    if (errorData.error?.suggestion) {
      details.suggestion = errorData.error.suggestion;
    }
    if (errorData.error?.details) {
      details.details = errorData.error.details;
    }

    throw new ApiError(res.status, code, message, details);
  }

  return (await res.json()) as T;
}

export const fetchApi: Api = {
  async createRoom(input: CreateRoomInput, idempotencyKey: string): Promise<JoinResult> {
    return request<JoinResult>('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        roomId: input.roomId,
        passcode: input.passcode,
        name: input.name,
        language: input.language,
      }),
    });
  },

  async getRoom(roomId: string): Promise<RoomInfo> {
    return request<RoomInfo>(`/api/rooms/${encodeURIComponent(roomId.toLowerCase())}`);
  },

  async joinRoom(roomId: string, input: JoinRoomInput): Promise<JoinResult> {
    return request<JoinResult>(`/api/rooms/${encodeURIComponent(roomId.toLowerCase())}/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: input.name,
        passcode: input.passcode,
        memberId: input.memberId,
      }),
    });
  },

  async events(roomId: string, token: string, query: EventsQuery): Promise<EventsPage> {
    const params = new URLSearchParams();
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.limit !== undefined) params.set('limit', String(query.limit));

    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<EventsPage>(`/api/rooms/${encodeURIComponent(roomId.toLowerCase())}/events${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async chat(roomId: string, token: string, query: EventsQuery): Promise<ChatPage> {
    const params = new URLSearchParams();
    if (query.before !== undefined) params.set('before', String(query.before));
    if (query.after !== undefined) params.set('after', String(query.after));
    if (query.limit !== undefined) params.set('limit', String(query.limit));

    const qs = params.toString() ? `?${params.toString()}` : '';
    return request<ChatPage>(`/api/rooms/${encodeURIComponent(roomId.toLowerCase())}/chat${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  },

  async admission(roomId: string, token: string): Promise<AdmissionStatus> {
    const res = await request<{ status: AdmissionStatus }>(
      `/api/rooms/${encodeURIComponent(roomId.toLowerCase())}/admission`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    return res.status;
  },
};
