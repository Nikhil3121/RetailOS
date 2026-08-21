/**
 * Thin fetch wrapper for the RetailOS backend.
 *
 * - Base URL comes from VITE_API_BASE_URL, defaulting to the local dev server.
 * - Auth headers are injected automatically from the auth store when a bearer
 *   token is present.
 * - Access-token expiry is checked BEFORE every authenticated request; if the
 *   token expires within REFRESH_SKEW_SECONDS, refresh runs first so the
 *   real request never sees a 401 on the happy path. A reactive 401→refresh
 *   retry still guards the edge case where the token was revoked server-side.
 * - If refresh fails, the store is cleared and the error propagates.
 * - Errors always surface as an `ApiError` carrying the standard envelope so
 *   call sites can branch on `.code` without reparsing bodies.
 */

import { useAuthStore } from '@/stores/auth-store';

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8000';

export const API_V1 = `${API_BASE_URL}/api/v1`;

// If the access token expires within this many seconds, refresh it before
// firing the request. Keeps the token dance invisible to the console (no 401,
// no red "Failed to load resource" line in DevTools).
const REFRESH_SKEW_SECONDS = 30;

/** Decode the `exp` claim (seconds since epoch) from a JWT without verifying it. */
function jwtExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // atob only handles the base64 alphabet; JWT uses base64url. Convert.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = envelope.code;
    this.details = envelope.details;
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  path: string;
  auth?: boolean;
}

async function rawFetch(
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(url, init);
}

/**
 * Wait until Zustand persist has hydrated.
 */
async function waitForAuthHydration(timeoutMs = 3000): Promise<void> {
  const store = useAuthStore.persist;

  if (!store || store.hasHydrated()) return;

  await new Promise<void>((resolve) => {
    const unsub = store.onFinishHydration(() => {
      unsub();
      resolve();
    });

    setTimeout(() => {
      unsub();
      resolve();
    }, timeoutMs);
  });
}

// Shared between proactive-refresh (in attempt) and reactive-refresh (in
// apiRequest). Set to the in-flight refresh Promise so concurrent callers
// coalesce onto a single /auth/refresh network call.
let inFlightRefresh: Promise<boolean> | null = null;

async function attempt<T>({
  path,
  body,
  headers,
  auth = true,
  ...init
}: RequestOptions): Promise<T> {
  if (auth) {
    await waitForAuthHydration();
    // Proactively refresh if the current access token is about to expire.
    // Without this, every authenticated request that races the 30-min expiry
    // window logs a red 401 in DevTools before the retry succeeds — even
    // though the recovery is transparent to the app.
    const state = useAuthStore.getState();
    const currentToken = state.accessToken;
    const exp = currentToken ? jwtExpiresAt(currentToken) : null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (
      currentToken &&
      exp !== null &&
      exp - nowSec < REFRESH_SKEW_SECONDS &&
      state.refreshToken
    ) {
      inFlightRefresh ??= state.refresh().finally(() => {
        inFlightRefresh = null;
      });
      await inFlightRefresh;
    }
  }

  const token = auth
    ? useAuthStore.getState().accessToken
    : null;

  const url = `${API_V1}${path}`;

  // ====================================================
  // REQUEST DEBUG
  // ====================================================

  console.groupCollapsed(
    `%cAPI REQUEST`,
    'color:#00d4ff;font-weight:bold;',
  );

  console.log('URL:', url);
  console.log('METHOD:', init.method ?? 'GET');
  console.log('BODY:', body);

  console.groupEnd();

  const response = await rawFetch(url, {
    ...init,

    headers: {
      Accept: 'application/json',

      ...(body !== undefined
        ? {
            'Content-Type': 'application/json',
          }
        : {}),

      ...(token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {}),

      ...headers,
    },

    body:
      body !== undefined
        ? JSON.stringify(body)
        : undefined,
  });

  if (response.status === 204) {
    console.groupCollapsed(
      '%cAPI RESPONSE',
      'color:#22c55e;font-weight:bold;',
    );
    console.log('STATUS:', 204);
    console.log('No Content');
    console.groupEnd();

    return undefined as T;
  }

  const isJson =
    response.headers
      .get('content-type')
      ?.includes('application/json') ?? false;

  const payload = isJson
    ? await response.json()
    : undefined;

  // ====================================================
  // RESPONSE DEBUG
  // ====================================================

  console.groupCollapsed(
    `%cAPI RESPONSE`,
    response.ok
      ? 'color:#22c55e;font-weight:bold;'
      : 'color:#ef4444;font-weight:bold;',
  );

  console.log('STATUS:', response.status);
  console.log('PAYLOAD:', payload);

  console.groupEnd();

  if (!response.ok) {
    const envelope: ApiErrorEnvelope =
      payload?.error ?? {
        code: 'HTTP_ERROR',
        message: `${response.status} ${response.statusText}`,
        details: payload ?? {},
      };

    throw new ApiError(
      response.status,
      envelope,
    );
  }

  return payload as T;
}

/**
 * Public request wrapper. `inFlightRefresh` is declared above `attempt` so
 * both proactive and reactive refreshes share the same coalescing slot.
 */
export async function apiRequest<T>(
  opts: RequestOptions,
): Promise<T> {
  try {
    return await attempt<T>(opts);
  } catch (err) {
    if (
      !(err instanceof ApiError) ||
      err.status !== 401 ||
      opts.auth === false
    ) {
      throw err;
    }

    const state = useAuthStore.getState();

    if (!state.refreshToken) {
      throw err;
    }

    inFlightRefresh ??=
      state.refresh().finally(() => {
        inFlightRefresh = null;
      });

    const ok = await inFlightRefresh;

    if (!ok) {
      throw err;
    }

    return await attempt<T>(opts);
  }
}

// ---------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  timestamp: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiRequest<HealthResponse>({
    path: '/health',
    method: 'GET',
    auth: false,
  });
}