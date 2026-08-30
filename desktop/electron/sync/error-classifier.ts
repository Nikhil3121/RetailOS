/**
 * Decide what a failed sync attempt MEANS.
 *
 * This is the difference between a POS that recovers on its own and one that
 * either hammers a doomed request forever or quietly abandons real money.
 * Three outcomes, three completely different behaviours:
 *
 *   RETRYABLE  The request never got a verdict — the network died, the server
 *              was briefly unwell, we were rate limited. Back off and retry.
 *
 *   PERMANENT  The server understood the request and rejected it on its
 *              merits. VARIANT_NOT_FOUND will still be not-found in an hour.
 *              Stop and surface it; a human has to fix the data.
 *
 *   BLOCKED    The sale is VALID but the server is not in a state to accept
 *              it yet — practically always NO_OPEN_DAY_SESSION, an offline
 *              bill syncing after the day was closed. This is an operational
 *              condition, not a defect in the bill, so it must keep waiting
 *              WITHOUT burning retry attempts. Marking a good sale permanently
 *              failed because nobody had opened the till yet would be exactly
 *              the silent data loss this phase exists to prevent.
 *
 * The mapping is driven by the backend's real error envelope, verified in
 * backend/app/core/exceptions.py:
 *
 *     { "error": { "code": "...", "message": "...", "details": {...} } }
 */

export type FailureKind = 'RETRYABLE' | 'PERMANENT' | 'BLOCKED';

export interface Classification {
  kind: FailureKind;
  /** Backend error code when one was parsed, else a synthetic label. */
  code: string;
  message: string;
}

/**
 * Business conditions that will clear on their own once the shop or the
 * server is ready. These must never exhaust their retries.
 */
const BLOCKED_CODES = new Set(['NO_OPEN_DAY_SESSION']);

/**
 * Rejections of the request's CONTENT. Retrying identical bytes produces an
 * identical rejection, so retrying is pure noise.
 */
const PERMANENT_CODES = new Set([
  'VARIANT_NOT_FOUND',
  'STORE_NOT_FOUND',
  'CUSTOMER_NOT_FOUND',
  'VALIDATION_ERROR',
  'FORBIDDEN',
  // ---- Phase 5E attribution failures ------------------------------------
  // The sale names a session that does not exist, or one belonging to another
  // store. Neither changes by waiting, and neither may be "fixed" by
  // retargeting the sale at whatever session is open now — that would book
  // the money into the wrong shift, which is the exact defect this phase
  // removed. These stop and wait for a human.
  'DAY_SESSION_NOT_FOUND',
  'DAY_SESSION_STORE_MISMATCH',
  // The idempotency key was reused for materially different data.
  'CLIENT_UUID_PAYLOAD_MISMATCH',
]);

/** Extract `error.code` / `error.message` from the backend envelope. */
function readEnvelope(body: unknown): { code: string | null; message: string | null } {
  if (typeof body !== 'object' || body === null) return { code: null, message: null };
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return { code: null, message: null };

  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return {
    code: typeof code === 'string' ? code : null,
    message: typeof message === 'string' ? message : null,
  };
}

/**
 * Classify an HTTP response that was not a success.
 *
 * Status is decided FIRST for the cases where the body cannot be trusted (a
 * 502 from a proxy is HTML, not our envelope), then refined by error code.
 */
export function classifyHttpFailure(status: number, body: unknown): Classification {
  const { code, message } = readEnvelope(body);
  const label = message ?? `HTTP ${status}`;

  // 5xx — the server failed to answer, not a verdict on the request.
  if (status >= 500) {
    return { kind: 'RETRYABLE', code: code ?? `HTTP_${status}`, message: label };
  }

  // 429 — explicitly "try again later".
  if (status === 429) {
    return { kind: 'RETRYABLE', code: code ?? 'RATE_LIMITED', message: label };
  }

  // 401/403 — the token expired or lacks the role. The BILL is fine; a fresh
  // login fixes it, so this must not be permanent. A permanently-failed sale
  // because a shift token timed out overnight would lose real revenue.
  if (status === 401 || status === 403) {
    return { kind: 'RETRYABLE', code: code ?? 'UNAUTHENTICATED', message: label };
  }

  if (code && BLOCKED_CODES.has(code)) {
    return { kind: 'BLOCKED', code, message: label };
  }
  if (code && PERMANENT_CODES.has(code)) {
    return { kind: 'PERMANENT', code, message: label };
  }

  // 409 with an unrecognised code: a conflict is a business state, and the
  // safe assumption for an UNKNOWN business state is that it may clear.
  // Blocking keeps the sale alive and visible; permanent would bury it.
  if (status === 409) {
    return { kind: 'BLOCKED', code: code ?? 'CONFLICT', message: label };
  }

  // 422 and other 4xx — the server understood and refused. Retrying the same
  // payload cannot change the answer.
  if (status >= 400) {
    return { kind: 'PERMANENT', code: code ?? `HTTP_${status}`, message: label };
  }

  return { kind: 'RETRYABLE', code: code ?? `HTTP_${status}`, message: label };
}

/**
 * Classify a thrown transport error — the request never completed, so the
 * server's verdict is unknown.
 *
 * ALWAYS retryable. Critically, a timeout may mean the server COMMITTED the
 * sale and we simply never heard back. That is precisely why the retry
 * carries the same client_uuid: the server's idempotency check collapses the
 * replay onto the existing row instead of ringing the bill up twice.
 */
export function classifyTransportError(err: unknown): Classification {
  const message = err instanceof Error ? err.message : 'Network request failed.';
  const name = err instanceof Error ? err.name : '';

  if (name === 'AbortError' || /timeout|timed out/i.test(message)) {
    return { kind: 'RETRYABLE', code: 'TIMEOUT', message: 'Request timed out.' };
  }
  return { kind: 'RETRYABLE', code: 'NETWORK', message };
}
