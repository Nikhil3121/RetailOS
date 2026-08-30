/**
 * IPC input validation.
 *
 * Everything arriving over IPC is untrusted. The renderer is sandboxed but it
 * still runs code we ship, and a bug — or a compromised page — must not be
 * able to reach the database with a malformed or hostile payload.
 *
 * These validators are deliberately hand-written rather than schema-library
 * based: the main process should pull in as little as possible, and the shapes
 * here are small enough that a dependency would cost more than it saves.
 *
 * Every validator THROWS on failure. The IPC wrapper converts the throw into a
 * structured error response, so the renderer sees a clean rejection and the
 * main process logs the reason.
 */

export class IpcValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcValidationError';
  }
}

function fail(message: string): never {
  throw new IpcValidationError(message);
}

export function requireString(value: unknown, field: string, maxLength = 255): string {
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length === 0) fail(`${field} must not be empty`);
  if (trimmed.length > maxLength) fail(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

export function optionalString(
  value: unknown,
  field: string,
  maxLength = 255,
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') fail(`${field} must be a string or null`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > maxLength) fail(`${field} exceeds ${maxLength} characters`);
  return trimmed;
}

/** Whole number within bounds. Rejects NaN, Infinity and fractional input —
 *  every integer field in this schema is a count or a paise amount. */
export function requireInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(`${field} must be an integer`);
  }
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = opts;
  if (value < min || value > max) fail(`${field} must be between ${min} and ${max}`);
  return value;
}

/** Finite number. Used for quantity, which is fractional for fabric. */
export function requireNumber(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${field} must be a finite number`);
  }
  const { min = -Number.MAX_VALUE, max = Number.MAX_VALUE } = opts;
  if (value < min || value > max) fail(`${field} must be between ${min} and ${max}`);
  return value;
}

export function requireOneOf<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const s = requireString(value, field);
  if (!(allowed as readonly string[]).includes(s)) {
    fail(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return s as T;
}

export function requireArray<T>(
  value: unknown,
  field: string,
  itemValidator: (item: unknown, index: number) => T,
  opts: { min?: number; max?: number } = {},
): T[] {
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  const { min = 0, max = 500 } = opts;
  if (value.length < min) fail(`${field} must contain at least ${min} item(s)`);
  if (value.length > max) fail(`${field} must contain at most ${max} item(s)`);
  return value.map((item, i) => itemValidator(item, i));
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * UUID v4 shape check. Not a security boundary on its own — it just stops
 * obviously wrong values reaching a query and keeps identifiers uniform.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(value: unknown, field: string): string {
  const s = requireString(value, field, 36);
  if (!UUID_RE.test(s)) fail(`${field} must be a UUID`);
  return s;
}

export function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  return requireUuid(value, field);
}
