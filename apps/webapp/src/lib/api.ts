import type { ApiErrorBody } from '@church/shared';
import { initDataRaw } from './telegram';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Fetch wrapper: adds the Telegram auth header and turns error bodies into ApiError. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `tma ${initDataRaw()}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  const res = await fetch(`/api${path}`, { ...init, headers });
  if (!res.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error (e.g. network proxy); fall through.
    }
    throw new ApiError(
      res.status,
      body?.error.code ?? 'http_error',
      body?.error.message ?? res.statusText,
    );
  }
  return (await res.json()) as T;
}
