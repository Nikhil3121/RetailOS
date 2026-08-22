/** Formatting helpers for money. All values arrive as strings (Decimal on the backend). */

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inr(value: string | number | null | undefined): string {
  if (value == null || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return INR.format(n);
}

/** Round like the backend does — two decimals, banker's rounding not required. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
