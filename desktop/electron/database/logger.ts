/**
 * Structured logging for the main process and database layer.
 *
 * Renderer logs go through the browser console; this covers everything that
 * happens before or outside a window — database init, migrations, IPC
 * failures. Output is one JSON object per line so it can be grepped or piped
 * into a log shipper later without reformatting.
 *
 * REDACTION: `scrub()` strips anything that looks like a credential, token,
 * or payment detail before it reaches the transport. Never bypass it by
 * calling console directly from the database layer.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Field names whose values are replaced with a placeholder, matched case-insensitively
 *  as a substring — so `access_token`, `cardNumber` and `customer_phone` all match. */
const REDACT_PATTERNS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'card',
  'cvv',
  'pan',
  'upi_id',
  'phone',
  'email',
];

const REDACTED = '[redacted]';

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  return REDACT_PATTERNS.some((p) => k.includes(p));
}

/** Deep-clone `value`, replacing sensitive fields. Depth-capped so a cyclic or
 *  very deep object can never hang the logger. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = shouldRedact(k) ? REDACTED : scrub(v, depth + 1);
  }
  return out;
}

function emit(level: Level, event: string, context?: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? (scrub(context) as Record<string, unknown>) : {}),
  };
  const serialised = JSON.stringify(line);

  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

/**
 * Normalise a thrown value into something safe to log. Keeps the message and
 * error name; drops the stack in production builds where it would only add
 * noise to a shop's log file.
 */
export function describeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      error_name: err.name,
      error_message: err.message,
      // SQLite errors carry a `code` (e.g. SQLITE_BUSY) that is the single most
      // useful field when diagnosing a failure on a shop machine. It is not on
      // the Error type, so read it through unknown rather than asserting.
      ...(typeof (err as unknown as { code?: unknown }).code === 'string'
        ? { error_code: (err as unknown as { code: string }).code }
        : {}),
    };
  }
  return { error_message: String(err) };
}

export const log = {
  debug: (event: string, ctx?: Record<string, unknown>) => emit('debug', event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit('info', event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit('warn', event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => emit('error', event, ctx),
};
