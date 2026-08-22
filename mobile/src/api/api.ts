/**
 * Fetch wrapper for the RetailOS backend — mobile edition.
 *
 * Same design as the desktop client (desktop/src/lib/api.ts):
 * - Bearer token injected from the auth store when auth: true
 * - Proactive refresh: if the access token expires within 30s, refresh
 *   before firing the request so we never see a red 401 in flight
 * - Reactive fallback: on 401, one refresh + retry
 * - Errors surface as ApiError with the standard { code, message, details }
 *   envelope so screens can branch on `.code`
 *
 * Difference from desktop: no waitForAuthHydration() — Zustand's persist
 * middleware on RN hydrates before the first render (see auth-store.ts),
 * and screens are auth-gated by RootNavigator anyway.
 */

import { API_V1 } from '@/constants/env';
import { useAuthStore } from '@/stores/auth-store';

const REFRESH_SKEW_SECONDS = 30;

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

/** Decode the `exp` claim (seconds since epoch) from a JWT without verifying it. */
function jwtExpiresAt(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // RN has `atob` on newer runtimes (Hermes ≥ 0.71). Base64URL → Base64 first.
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    // Hermes (RN's default JS engine since 0.71) ships atob globally. If a
    // hypothetical future runtime drops it, we'll add a base64 shim then.
    const payload = JSON.parse(atob(padded)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// Coalesce concurrent refreshes onto a single /auth/refresh network call.
let inFlightRefresh: Promise<boolean> | null = null;

async function attempt<T>({
  path,
  body,
  headers,
  auth = true,
  ...init
}: RequestOptions): Promise<T> {
  if (auth) {
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

  const token = auth ? useAuthStore.getState().accessToken : null;

  const response = await fetch(`${API_V1}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false;
  const payload = isJson ? await response.json() : undefined;

  if (!response.ok) {
    const envelope: ApiErrorEnvelope =
      payload?.error ?? {
        code: 'HTTP_ERROR',
        message: `${response.status}`,
        details: payload ?? {},
      };
    throw new ApiError(response.status, envelope);
  }

  return payload as T;
}

/** Public request wrapper — handles the reactive 401 → refresh → retry fallback. */
export async function apiRequest<T>(opts: RequestOptions): Promise<T> {
  try {
    return await attempt<T>(opts);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401 || opts.auth === false) {
      throw err;
    }
    const state = useAuthStore.getState();
    if (!state.refreshToken) throw err;

    inFlightRefresh ??= state.refresh().finally(() => {
      inFlightRefresh = null;
    });
    const ok = await inFlightRefresh;
    if (!ok) throw err;

    return await attempt<T>(opts);
  }
}
