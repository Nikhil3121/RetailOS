/**
 * Proof that the person at the keyboard just re-entered their password.
 *
 * The server is the thing that actually enforces this (`require_elevation` in
 * `app/api/deps.py`). Everything here is the convenience half: hold the token
 * the server issued, know when it has expired, and attach it to outgoing
 * requests so a manager deleting four rows types their password once rather
 * than four times.
 *
 * DELIBERATELY IN MEMORY ONLY. Not localStorage, not the auth store's persisted
 * slice. The whole point of a five-minute window is that it dies with the
 * session — a token that survived a reload would leave the till unlocked
 * exactly when nobody is watching it, which is the case the gate exists for.
 */

/*
 * No imports on purpose. `api.ts` reads `elevationHeader()` on every request,
 * so anything imported here would sit in a cycle with the request client.
 * The call that actually asks the server lives in `auth-api.ts`, next to the
 * other endpoint wrappers.
 */

export const ELEVATION_HEADER = 'X-Elevation-Token';

interface Elevation {
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

let current: Elevation | null = null;

/**
 * Treat the token as dead slightly before the server does.
 *
 * A request sent at 4:59.9 can easily arrive after five minutes have passed,
 * and the failure mode is a destructive action rejected halfway through a
 * batch. Better to ask again a few seconds early.
 */
const EXPIRY_SKEW_MS = 15_000;

export function hasLiveElevation(): boolean {
  return current !== null && Date.now() < current.expiresAt - EXPIRY_SKEW_MS;
}

/** Seconds remaining, for a UI that wants to say so. 0 when expired. */
export function elevationSecondsLeft(): number {
  if (!hasLiveElevation() || !current) return 0;
  return Math.max(0, Math.floor((current.expiresAt - EXPIRY_SKEW_MS - Date.now()) / 1000));
}

/** The header to send, or nothing when we hold no live token. */
export function elevationHeader(): Record<string, string> {
  return hasLiveElevation() && current ? { [ELEVATION_HEADER]: current.token } : {};
}

/** Drop the token. Called on sign-out, and after anything that should re-lock. */
export function clearElevation(): void {
  current = null;
}

/** Record a token the server just issued. Called by `auth-api.confirmPassword`. */
export function storeElevation(token: string, expiresInSeconds: number): void {
  current = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
}
