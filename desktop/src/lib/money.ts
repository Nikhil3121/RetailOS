/**
 * Money for the screen.
 *
 * The server sends money as a JSON string from a `Numeric` column — "180.00",
 * but also "180.00000" and "1234.5", because the scale that comes back depends
 * on the expression that produced it. Interpolating that straight into JSX is
 * why the dashboard has been showing `₹180.00000`.
 *
 * EVERYTHING HERE IS STRING ARITHMETIC. Not because a float would visibly
 * break on a shop's numbers today, but because `Number()` is exactly how money
 * bugs get in: once a value has been through a float, the rounding is already
 * done and no amount of care downstream undoes it. This codebase's rule is that
 * money is Decimal on the server and integer paise on the terminal, and the
 * display layer does not get an exemption from it.
 *
 * Grouping is Indian — 12,34,567.89, not 1,234,567.89. Intl would do this, but
 * only by taking a Number first, which is the thing being avoided.
 */

/** Split a decimal string into sign, integer digits and fraction digits. */
function parts(input: string): { neg: boolean; int: string; frac: string } | null {
  const trimmed = input.trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) return null;
  return { neg: m[1] === '-', int: m[2] === '' ? '0' : m[2], frac: m[3] ?? '' };
}

/** Round a fraction to `dp` places, half-up, carrying into the integer part. */
function roundTo(int: string, frac: string, dp: number): { int: string; frac: string } {
  if (frac.length <= dp) return { int, frac: frac.padEnd(dp, '0') };

  const keep = frac.slice(0, dp);
  const roundUp = frac.charCodeAt(dp) >= 53; // '5'
  if (!roundUp) return { int, frac: keep };

  // Increment the kept digits as an integer, then carry the overflow.
  const bumped = (BigInt(keep === '' ? '0' : keep) + 1n).toString();
  if (bumped.length > dp) {
    // 99 -> 100: the fraction wrapped, so the rupee count goes up by one.
    return { int: (BigInt(int) + 1n).toString(), frac: '0'.repeat(dp) };
  }
  return { int, frac: bumped.padStart(dp, '0') };
}

/**
 * Group digits the Indian way: the last three, then pairs.
 *
 * 1234567 becomes 12,34,567. A shop reading "12,34,567" knows instantly it is
 * twelve lakh; the same figure grouped in threes has to be counted.
 */
export function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const last3 = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${pairs},${last3}`;
}

export interface MoneyOptions {
  /** Decimal places. 2 everywhere money is shown; 0 suits a headline count. */
  decimals?: number;
  /** Shown when the value is missing or unparseable. */
  fallback?: string;
  /** Prefix the ₹ symbol. */
  symbol?: boolean;
}

/**
 * Format a server decimal string as rupees.
 *
 * Returns `fallback` rather than throwing on junk: a dashboard tile that shows
 * an em dash is a small confusion, and one that white-screens the page over a
 * malformed KPI is an outage.
 */
export function formatMoney(
  value: string | number | null | undefined,
  options: MoneyOptions = {},
): string {
  const { decimals = 2, fallback = '—', symbol = true } = options;
  if (value === null || value === undefined || value === '') return fallback;

  const p = parts(String(value));
  if (!p) return fallback;

  const { int, frac } = roundTo(p.int, p.frac, decimals);
  const body = decimals > 0
    ? `${groupIndian(int.replace(/^0+(?=\d)/, ''))}.${frac}`
    : groupIndian(int.replace(/^0+(?=\d)/, ''));

  // "-0.00" is arithmetically correct and reads as a mistake on a till.
  const isZero = /^[0.,]*$/.test(body.replace(/[^\d.,]/g, '')) && !/[1-9]/.test(body);
  const sign = p.neg && !isZero ? '-' : '';

  return `${sign}${symbol ? '₹' : ''}${body}`;
}

/**
 * Add server decimal strings exactly.
 *
 * The dashboard's payment mix was summed with `Number(cash) + Number(card) +
 * …` and printed with `.toFixed(0)`, which is a float sum of money rounded to
 * whole rupees — so the "Collected" figure could disagree with the four rows of
 * the legend directly beneath it. Scaling to integers and adding as BigInt
 * makes the total the exact sum of its parts, which is the only version of that
 * number worth showing.
 *
 * Returns a decimal string, so it composes with `formatMoney`.
 */
export function sumDecimals(values: (string | number | null | undefined)[]): string {
  const SCALE = 4; // paise plus headroom for rates that arrive at 4 dp
  let total = 0n;

  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const p = parts(String(v));
    if (!p) continue;
    const scaled = BigInt(p.int + p.frac.slice(0, SCALE).padEnd(SCALE, '0'));
    total += p.neg ? -scaled : scaled;
  }

  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(SCALE + 1, '0');
  const int = digits.slice(0, -SCALE);
  const frac = digits.slice(-SCALE);
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** A percentage from a server decimal string, e.g. "18.5000" -> "18.5%". */
export function formatPercent(
  value: string | number | null | undefined,
  options: { decimals?: number; fallback?: string } = {},
): string {
  const { decimals = 1, fallback = '—' } = options;
  if (value === null || value === undefined || value === '') return fallback;

  const p = parts(String(value));
  if (!p) return fallback;

  const { int, frac } = roundTo(p.int, p.frac, decimals);
  const whole = int.replace(/^0+(?=\d)/, '');
  const body = decimals > 0 ? `${whole}.${frac}` : whole;
  const sign = p.neg && /[1-9]/.test(body) ? '-' : '';
  return `${sign}${body}%`;
}
