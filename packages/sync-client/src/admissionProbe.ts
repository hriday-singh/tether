export type AdmissionProbeResult =
  | { status: 'ok' }
  | { status: 'reauth'; reason?: string }
  | { status: 'banned' }
  | { status: 'not_found' }
  | { status: 'locked' }
  | { status: 'full' }
  | { status: 'network_error'; error: Error };

export async function probeAdmission(
  apiUrl: string,
  roomId: string,
  token: string,
  fetchFn: typeof fetch = fetch
): Promise<AdmissionProbeResult> {
  const normalizedApiUrl = apiUrl.replace(/\/+$/, '');
  const targetUrl = `${normalizedApiUrl}/api/rooms/${encodeURIComponent(roomId)}/admission`;

  try {
    const res = await fetchFn(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (res.status === 404) {
      return { status: 'not_found' };
    }

    const data = (await res.json()) as { status?: string; reason?: string };

    switch (data.status) {
      case 'ok':
        return { status: 'ok' };
      case 'reauth':
        return { status: 'reauth', reason: data.reason };
      case 'banned':
        return { status: 'banned' };
      case 'locked':
        return { status: 'locked' };
      case 'full':
        return { status: 'full' };
      case 'not_found':
        return { status: 'not_found' };
      default:
        return { status: 'reauth', reason: 'unknown_admission_status' };
    }
  } catch (err) {
    return {
      status: 'network_error',
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
