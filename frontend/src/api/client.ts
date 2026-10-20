import type { ErrorBody } from './types';

const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number; // 0 = the server couldn't be reached
  readonly body: ErrorBody | null;

  constructor(status: number, message: string, body: ErrorBody | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// Called on any 401 (session missing, expired or revoked) so the app can
// return to the login screen. Registered by the auth store.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string';
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      // The session is an httpOnly cookie (§1), so it must be sent explicitly.
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body (e.g. a proxy error page); handled below.
  }

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    const message = isErrorBody(data) ? data.error : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, isErrorBody(data) ? data : null);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

// A message suitable for showing the user.
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return 'Something went wrong. Please try again.';
}
