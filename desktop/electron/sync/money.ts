/**
 * Exact integer-to-decimal conversion for the API boundary.
 *
 * The whole point of storing money as integer paise is that no rounding can
 * happen while it sits in the database. That guarantee is worth nothing if it
 * is thrown away on the way out, so NOTHING here divides.
 *
 *   paise / 100  is a floating-point operation. For most values it looks
 *   right, and then one day 8_675_309 paise formats as 86753.08999999999 and
 *   a bill is wrong by a paisa that nobody can explain.
 *
 * Instead the integer is turned into its digits and a decimal point is
 * inserted. That is exact by construction for every value, with no reliance
 * on IEEE-754 behaviour at all.
 */

/** Guard: a value that cannot be represented exactly must never be silently
 *  formatted as though it could. */
function assertExactInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer, received ${String(value)}.`);
  }
}

/**
 * Integer paise to the decimal string FastAPI expects.
 *
 *      0 -> "0.00"        5 -> "0.05"      24000 -> "240.00"
 *   -250 -> "-2.50"      99 -> "0.99"
 *
 * Pydantic parses this into a Decimal, so a STRING is the correct wire form.
 * Sending a JSON number would reintroduce the float we just avoided.
 */
export function paiseToDecimalString(paise: number): string {
  assertExactInteger(paise, 'paise');

  const negative = paise < 0;
  // Digits only. padStart guarantees at least "0dd" so the slices below are
  // always well-defined, including for 0 and single-digit paise.
  const digits = String(Math.abs(paise)).padStart(3, '0');
  const rupees = digits.slice(0, -2);
  const fraction = digits.slice(-2);

  return `${negative ? '-' : ''}${rupees}.${fraction}`;
}

/**
 * Basis points to a percentage string.
 *
 *   3000 -> "30.00"    1250 -> "12.50"    0 -> "0.00"
 *
 * Same technique, same reason. `SaleLineInput.discount_pct` allows 2 decimal
 * places, which is exactly what a basis point is.
 */
export function basisPointsToDecimalString(bp: number): string {
  assertExactInteger(bp, 'basis points');
  return paiseToDecimalString(bp);
}

/**
 * Quantity to a decimal string with 3 places, matching the backend's
 * `decimal_places=3`.
 *
 * Quantity is the ONE value stored as REAL rather than an integer — fabric
 * genuinely sells in fractional metres. It is not money: it is never summed
 * into a total here, and the backend multiplies it against a Decimal price on
 * its own side. `toFixed(3)` is deterministic and matches the declared
 * precision, so the rounding happens once, visibly, at the boundary.
 */
export function quantityToDecimalString(quantity: number): string {
  if (!Number.isFinite(quantity)) {
    throw new Error(`Quantity must be finite, received ${String(quantity)}.`);
  }
  return quantity.toFixed(3);
}

/**
 * Parse a decimal string from the server back into integer paise.
 *
 * Used ONLY to record what the server computed for comparison — never to
 * overwrite a local value. Parsed digit-wise for the same reason as above:
 * `Math.round(parseFloat(x) * 100)` is exactly the bug this module exists to
 * avoid.
 *
 * Returns null for anything unparseable rather than guessing, so a surprising
 * server response shows up as "unknown" instead of a fabricated number.
 */
export function decimalStringToPaise(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{0,}))?$/.exec(text);
  if (!match) return null;

  const [, sign, whole, rawFraction = ''] = match;
  // Pad to two places, then take exactly two. A server that ever sends more
  // precision than paise is truncated rather than rounded, because inventing
  // a rounding rule for money we did not compute would be a guess.
  const fraction = rawFraction.padEnd(2, '0').slice(0, 2);

  const paise = Number(`${whole}${fraction}`);
  if (!Number.isSafeInteger(paise)) return null;

  return sign === '-' ? -paise : paise;
}
