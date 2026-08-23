/**
 * A tiny in-app arithmetic CAPTCHA. Mirror of desktop/src/lib/math-captcha.ts
 * so the two clients enforce identical rules and share test coverage in the
 * future. See the desktop file for the full rationale — one-line summary:
 * a per-attempt cognitive delay that human users don't feel but scripts do.
 */

export interface MathCaptcha {
  a: number;
  b: number;
  op: '+' | '-';
  expected: number;
  /** Human-readable prompt, e.g. "7 + 4". */
  prompt: string;
}

export function generateMathCaptcha(): MathCaptcha {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const op: '+' | '-' = Math.random() < 0.5 ? '+' : '-';
  const [big, small] = a >= b ? [a, b] : [b, a];
  const expected = op === '+' ? a + b : big - small;
  const displayA = op === '+' ? a : big;
  const displayB = op === '+' ? b : small;
  return {
    a: displayA,
    b: displayB,
    op,
    expected,
    prompt: `${displayA} ${op} ${displayB}`,
  };
}

export function verifyMathCaptcha(captcha: MathCaptcha, input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
  return n === captcha.expected;
}
